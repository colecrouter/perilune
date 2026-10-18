import { createHash } from 'node:crypto';
import { pidParameters, type PidTelemetry } from '#lib/domain/pid.js';
import {
	discoverMacros,
	cleanConsoleText,
	type PrinterMacro,
	type ConsoleLine
} from '#lib/domain/console.js';
import { emptyBedMesh, normalizeBedMesh, type BedMeshState } from '#lib/domain/bed-mesh.js';
import { temperatureFields, type TemperatureSensor } from '#lib/domain/temperature.js';
import { axes, emptyMotion, type MotionSnapshot } from '#lib/domain/motion.js';
import { liveMeshPlan, type LiveMeshPlan } from '#lib/domain/live-mesh.js';
import { Context, Data, Effect, Layer, SubscriptionRef } from 'effect';

export interface MoonrakerSettings {
	url: string;
	apiKey?: string;
	requestTimeoutMs?: number;
	heartbeatMs?: number;
	reconnectMinMs?: number;
	reconnectMaxMs?: number;
	discoverWebcams?: boolean;
	liveMeshEnabled?: boolean;
	liveControlsEnabled?: boolean;
	pidCalibrationEnabled?: boolean;
}
export class MoonrakerConfig extends Context.Service<MoonrakerConfig, MoonrakerSettings>()(
	'perilune/MoonrakerConfig'
) {}
export type KlippyState = 'unknown' | 'ready' | 'startup' | 'shutdown' | 'error' | 'disconnected';
export interface MoonrakerSnapshot {
	/** Latest successfully queried history identity; null means an empty history. */
	historyCursor?: string | null;
	pidTelemetry?: PidTelemetry;
	zProbe?: import('#lib/domain/live-z.js').ZProbeCapability;
	filament?: import('#lib/domain/printer.js').PrinterSnapshot['filament'];
	/** Operator-only data; never forwarded into PrinterSnapshot/dashboard. */
	heaterLimits?: Partial<Record<'bed' | 'nozzle', { min: number; max: number }>>;
	console?: { macros: PrinterMacro[]; responses: ConsoleLine[] };
	connection: 'connecting' | 'connected' | 'reconnecting';
	klippy: KlippyState;
	generation: number;
	updatedAt: number | null;
	telemetryReady: boolean;
	availableObjects: string[];
	webcams: unknown[];
	additionalTemperatures: TemperatureSensor[];
	motion: MotionSnapshot;
	bedMesh: BedMeshState;
	liveMesh: { enabled: boolean; plan: LiveMeshPlan | null; pendingConfig: boolean };
	probeResponses: Array<{ sequence: number; x: number; y: number; space?: 'probe' | 'nozzle' }>;
	job: {
		runId?: string;
		historyKey?: string;
		filename: string;
		state: 'unknown' | 'standby' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error';
		progress: number | null;
		layer: number | null;
		totalLayers: number | null;
		remainingMinutes: number | null;
	};
	heaters: {
		nozzle: { current: number | null; target: number | null };
		bed: { current: number | null; target: number | null };
	};
}
export class MoonrakerCommandError extends Data.TaggedError('MoonrakerCommandError')<{
	sent: boolean;
}> {}
export type MeshOperation =
	| { type: 'home' }
	| { type: 'probe'; name: string }
	| { type: 'restore'; name: string | null; remove: string }
	| { type: 'keep'; remove: string }
	| { type: 'save'; name: string; remove: string };
export function meshScript(operation: MeshOperation): string {
	for (const name of [
		'name' in operation ? operation.name : null,
		'remove' in operation ? operation.remove : null
	])
		if (name !== null && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name))
			throw new Error('Invalid mesh profile identifier');
	switch (operation.type) {
		case 'home':
			return 'G28';
		case 'probe':
			return `BED_MESH_CALIBRATE PROFILE=${operation.name}`;
		case 'restore':
			return `${operation.name ? `BED_MESH_PROFILE LOAD=${operation.name}` : 'BED_MESH_CLEAR'}\nBED_MESH_PROFILE REMOVE=${operation.remove}`;
		case 'keep':
			return `BED_MESH_PROFILE REMOVE=${operation.remove}`;
		case 'save':
			return `BED_MESH_PROFILE SAVE=${operation.name}\nBED_MESH_PROFILE REMOVE=${operation.remove}\nSAVE_CONFIG`;
	}
}
export type ControlOperation =
	| { type: 'controlScript'; script: string }
	| { type: 'pidCalibrate'; heater: 'nozzle' | 'bed'; target: number }
	| { type: 'job'; method: 'start' | 'pause' | 'resume' | 'cancel'; filename?: string };
export class MoonrakerService extends Context.Service<
	MoonrakerService,
	{
		state: SubscriptionRef.SubscriptionRef<MoonrakerSnapshot>;
		command: (
			operation: MeshOperation,
			generation: number,
			permit?: () => boolean
		) => Effect.Effect<void, MoonrakerCommandError>;
		control?: (
			operation: ControlOperation,
			generation: number,
			permit?: () => boolean
		) => Effect.Effect<void, MoonrakerCommandError>;
		refresh: (generation: number) => Effect.Effect<MoonrakerSnapshot, MoonrakerCommandError>;
	}
>()('perilune/MoonrakerService') {}

type ObjectStatus = Record<string, Record<string, unknown>>;
const wanted: Record<string, string[]> = {
	configfile: ['config', 'save_config_pending', 'save_config_pending_items'],
	bed_mesh: ['profile_name', 'mesh_min', 'mesh_max', 'probed_matrix', 'profiles'],
	webhooks: ['state'],
	toolhead: ['position', 'axis_minimum', 'axis_maximum', 'homed_axes', 'extruder'],
	idle_timeout: ['state'],
	manual_probe: ['is_active', 'z_position', 'z_position_lower', 'z_position_upper'],
	print_stats: ['filename', 'state', 'print_duration', 'info'],
	virtual_sdcard: ['progress'],
	extruder: ['temperature', 'target', 'can_extrude'],
	heater_bed: ['temperature', 'target']
};
const record = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const number = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : null;
export const emptyMoonrakerSnapshot = (): MoonrakerSnapshot => ({
	connection: 'connecting',
	klippy: 'unknown',
	generation: 0,
	updatedAt: null,
	telemetryReady: false,
	availableObjects: [],
	webcams: [],
	additionalTemperatures: [],
	motion: emptyMotion(),
	bedMesh: emptyBedMesh(),
	liveMesh: { enabled: false, plan: null, pendingConfig: false },
	probeResponses: [],
	console: { macros: [], responses: [] },
	job: {
		filename: '',
		state: 'standby',
		progress: null,
		layer: null,
		totalLayers: null,
		remainingMinutes: null
	},
	heaters: { nozzle: { current: null, target: null }, bed: { current: null, target: null } }
});
export function normalizeMoonrakerStatus(
	status: ObjectStatus,
	previous: MoonrakerSnapshot
): MoonrakerSnapshot {
	const print = status.print_stats ?? {};
	const info = record(print.info);
	const progress = number(status.virtual_sdcard?.progress);
	const duration = number(print.print_duration);
	const state = ['standby', 'printing', 'paused', 'complete', 'cancelled', 'error'].includes(
		String(print.state)
	)
		? (print.state as MoonrakerSnapshot['job']['state'])
		: 'unknown';
	const runId = ['printing', 'paused'].includes(state)
		? previous.telemetryReady &&
			['printing', 'paused'].includes(previous.job.state) &&
			previous.job.filename === print.filename
			? previous.job.runId
			: crypto.randomUUID()
		: previous.job.runId;
	const heaterLimits = Object.fromEntries(
		(['bed', 'nozzle'] as const).flatMap((heater) => {
			const config = record(
				record(status.configfile?.config)[heater === 'bed' ? 'heater_bed' : 'extruder']
			);
			const min = Number(config.min_temp),
				max = Number(config.max_temp);
			return Number.isFinite(min) && Number.isFinite(max) && min < max
				? [[heater, { min, max }]]
				: [];
		})
	);

	return {
		...previous,
		updatedAt: Date.now(),
		telemetryReady: true,
		motion: normalizeMotion(status),
		heaterLimits,
		pidTelemetry: {
			available: previous.pidTelemetry?.available === true,
			limits: heaterLimits,
			pending: Object.fromEntries(
				(['nozzle', 'bed'] as const).flatMap((heater) => {
					const parameters = pidParameters(
						record(status.configfile?.save_config_pending_items)[
							heater === 'bed' ? 'heater_bed' : 'extruder'
						]
					);
					return parameters ? [[heater, parameters]] : [];
				})
			)
		},
		zProbe: normalizeZProbe(status),

		filament: {
			canExtrude: status.extruder?.can_extrude === true,
			position: Array.isArray(status.toolhead?.position)
				? number(status.toolhead.position[3])
				: null,
			active: typeof status.toolhead?.extruder === 'string' ? status.toolhead.extruder : null,
			maxDistance: number(
				Number(record(record(status.configfile?.config).extruder).max_extrude_only_distance ?? 50)
			),
			minTemp: number(
				Number(record(record(status.configfile?.config).extruder).min_extrude_temp ?? 170)
			)
		},

		liveMesh: {
			enabled: previous.liveMesh.enabled,
			plan: liveMeshPlan(status.configfile?.config),
			pendingConfig: status.configfile?.save_config_pending === true
		},
		bedMesh: normalizeBedMesh(status.bed_mesh, previous.availableObjects.includes('bed_mesh')),
		additionalTemperatures: previous.availableObjects
			.filter((name) => name !== 'extruder' && name !== 'heater_bed' && temperatureFields(name))
			.slice(0, 30)
			.map((name) => ({
				id: name,
				label: name
					.replace(/^(temperature_sensor|temperature_fan|heater_generic) /, '')
					.replaceAll('_', ' '),
				current: number(status[name]?.temperature),
				target: number(status[name]?.target),
				heater: temperatureFields(name)?.includes('target') ?? false
			})),
		job: {
			runId,
			historyKey: runId === previous.job.runId ? previous.job.historyKey : undefined,
			filename: typeof print.filename === 'string' ? print.filename : '',
			state,
			progress: progress === null ? null : Math.max(0, Math.min(100, progress * 100)),
			layer: number(info.current_layer),
			totalLayers: number(info.total_layer),
			remainingMinutes:
				state === 'printing' &&
				progress !== null &&
				progress > 0 &&
				progress < 1 &&
				duration !== null
					? Math.max(0, Math.ceil((duration * (1 - progress)) / progress / 60))
					: null
		},
		heaters: {
			nozzle: {
				current: number(status.extruder?.temperature),
				target: number(status.extruder?.target)
			},
			bed: {
				current: number(status.heater_bed?.temperature),
				target: number(status.heater_bed?.target)
			}
		}
	};
}
const klippyState = (value: unknown): KlippyState =>
	['ready', 'startup', 'shutdown', 'error', 'disconnected'].includes(String(value))
		? (value as KlippyState)
		: 'unknown';

/** Process-scoped transport with a narrow, generation-fenced mesh command API. */
export const MoonrakerServiceLive = Layer.effect(
	MoonrakerService,
	Effect.gen(function* () {
		const config = yield* MoonrakerConfig;
		const state = yield* SubscriptionRef.make(emptyMoonrakerSnapshot());
		const timeout = config.requestTimeoutMs ?? 10_000;
		const heartbeat = config.heartbeatMs ?? 15_000;
		const reconnectMin = config.reconnectMinMs ?? 500;
		const reconnectMax = config.reconnectMaxMs ?? 30_000;
		let dispatch:
			| ((
					operation: MeshOperation | ControlOperation,
					generation: number,
					permit?: () => boolean
			  ) => Promise<void>)
			| undefined;
		let refresh: ((generation: number) => Promise<MoonrakerSnapshot>) | undefined;
		let responseSequence = 0;
		const worker = Effect.promise(async (signal) => {
			let current = emptyMoonrakerSnapshot();
			const publish = async (next: MoonrakerSnapshot) => {
				current = next;
				await Effect.runPromise(SubscriptionRef.set(state, next));
			};
			let failures = 0;
			while (!signal.aborted) {
				let socket: WebSocket | undefined;
				const pending = new Map<
					number,
					{
						resolve: (value: unknown) => void;
						reject: () => void;
						timer: ReturnType<typeof setTimeout>;
					}
				>();
				let nextId = 0;
				let status: ObjectStatus = {};
				let subscribed = false;
				let historyEnabled = false;
				const historyRuns = new Map<string, string>();
				let readinessVersion = 0;
				let subscribing = false;
				let refreshing: Array<{ delta: Record<string, unknown>; time: number | null }> | undefined;
				let buffered: Array<{ delta: Record<string, unknown>; time: number | null }> = [];
				let wake: (() => void) | undefined;
				let cancelOpen: (() => void) | undefined;
				let closed = false;
				const close = () => {
					closed = true;
					for (const request of pending.values()) {
						clearTimeout(request.timer);
						request.reject();
					}
					pending.clear();
					cancelOpen?.();
					wake?.();
					socket?.close();
				};
				signal.addEventListener('abort', close, { once: true });
				try {
					await publish({
						...current,
						connection: current.generation === 0 ? 'connecting' : 'reconnecting',
						klippy: 'unknown',
						telemetryReady: false,
						generation: current.generation + 1,
						liveMesh: { ...current.liveMesh, enabled: config.liveMeshEnabled === true },
						probeResponses: []
					});
					if (signal.aborted) break;
					socket = new WebSocket(config.url);
					const ws = socket;
					const request = (
						method: string,
						params?: unknown,
						requestTimeout = timeout,
						closeOnTimeout = true
					) =>
						new Promise<unknown>((resolve, reject) => {
							if (closed || ws.readyState !== WebSocket.OPEN) {
								reject(new Error('Connection unavailable'));
								return;
							}
							const id = ++nextId;
							const timer = setTimeout(() => {
								pending.delete(id);
								reject(new Error('Request timed out'));
								if (closeOnTimeout) close();
							}, requestTimeout);
							pending.set(id, {
								resolve,
								reject: () => reject(new Error('Request failed')),
								timer
							});
							ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
						});
					// History reads are optional and never determine whether a physical command is sent.
					const refreshHistory = async () => {
						if (!historyEnabled || !current.telemetryReady) return;
						await publish({ ...current, historyCursor: undefined });
						const run = current.job.runId;
						const version = readinessVersion;
						const generation = current.generation;
						try {
							const result = record(
								await request(
									'server.history.list',
									{ limit: 1, order: 'desc' },
									Math.min(timeout, 2000),
									false
								)
							);
							if (
								closed ||
								signal.aborted ||
								generation !== current.generation ||
								version !== readinessVersion ||
								run !== current.job.runId ||
								!current.telemetryReady
							)
								return;
							if (!Array.isArray(result.jobs)) return;
							if (result.jobs.length === 0) {
								await publish({ ...current, historyCursor: null });
								return;
							}
							const latest = record(result.jobs[0]);
							if (
								typeof latest.job_id !== 'string' ||
								latest.job_id.length > 200 ||
								number(latest.start_time) === null
							)
								return;
							const key = createHash('sha256')
								.update(JSON.stringify([config.url, latest.job_id, latest.start_time]))
								.digest('hex');
							await publish({ ...current, historyCursor: key });
							const prior = historyRuns.get(key);
							if (prior !== undefined && prior !== (run ?? 'inactive')) return;
							historyRuns.set(key, run ?? 'inactive');
							if (historyRuns.size > 64) historyRuns.delete(historyRuns.keys().next().value!);
							if (
								!run ||
								!['printing', 'paused'].includes(current.job.state) ||
								latest.status !== 'in_progress' ||
								latest.filename !== current.job.filename
							)
								return;
							if (current.job.historyKey && current.job.historyKey !== key) return;
							await publish({ ...current, job: { ...current.job, historyKey: key } });
						} catch {
							/* Missing or unavailable history leaves attribution process-local. */
						}
					};
					ws.addEventListener('close', close);
					ws.addEventListener('error', close);
					ws.addEventListener('message', (event) => {
						if (closed || signal.aborted) return;
						let message: Record<string, unknown>;
						try {
							message = record(JSON.parse(String(event.data)));
						} catch {
							return;
						}
						if (typeof message.id === 'number') {
							const entry = pending.get(message.id);
							if (!entry) return;
							clearTimeout(entry.timer);
							pending.delete(message.id);
							if (message.error) entry.reject();
							else entry.resolve(message.result);
							return;
						}
						if (message.method === 'notify_gcode_response') {
							const response = Array.isArray(message.params) ? message.params[0] : null;
							if (typeof response === 'string') {
								const text = cleanConsoleText(response);
								void publish({
									...current,
									console: {
										macros: current.console?.macros ?? [],
										responses: [
											...(current.console?.responses ?? []),
											{
												id: crypto.randomUUID(),
												at: Date.now(),
												kind: text.startsWith('!!') ? ('error' as const) : ('response' as const),
												text
											}
										].slice(-200)
									}
								});
							}
						}
						if (message.method === 'notify_gcode_response' && config.liveMeshEnabled) {
							const line = String(Array.isArray(message.params) ? message.params[0] : '');
							const old = /probe at (-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?) is z=/.exec(line);
							const modern =
								/probe: at (-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?) bed will contact at z=/.exec(line);
							const match = modern ?? old;
							if (match)
								void publish({
									...current,
									probeResponses: [
										...current.probeResponses,
										{
											sequence: ++responseSequence,
											x: Number(match[1]),
											y: Number(match[2]),
											space: modern ? ('probe' as const) : ('nozzle' as const)
										}
									].slice(-256)
								});
						} else if (message.method === 'notify_status_update' && (subscribed || subscribing)) {
							const delta = record(Array.isArray(message.params) ? message.params[0] : undefined);
							if (subscribing) {
								buffered.push({
									delta,
									time: number(Array.isArray(message.params) ? message.params[1] : undefined)
								});
								return;
							}
							if (refreshing)
								refreshing.push({
									delta,
									time: number(Array.isArray(message.params) ? message.params[1] : undefined)
								});
							mergeStatus(status, delta);
							void publish(normalizeMoonrakerStatus(status, current));
						} else if (message.method === 'notify_webcams_changed') {
							wake?.();
						} else if (message.method === 'notify_klippy_ready') {
							readinessVersion++;
							current = { ...current, generation: current.generation + 1 };
							subscribed = false;
							void publish({ ...current, telemetryReady: false });
							wake?.();
						} else if (
							message.method === 'notify_klippy_shutdown' ||
							message.method === 'notify_klippy_disconnected'
						) {
							readinessVersion++;
							current = { ...current, generation: current.generation + 1 };
							subscribed = false;
							void publish({
								...current,
								telemetryReady: false,
								klippy: message.method === 'notify_klippy_shutdown' ? 'shutdown' : 'disconnected'
							});
							wake?.();
						}
					});
					await new Promise<void>((resolve, reject) => {
						const timer = setTimeout(() => {
							reject(new Error('Connection timed out'));
							close();
						}, timeout);
						cancelOpen = () => {
							clearTimeout(timer);
							reject(new Error('Connection closed'));
						};
						ws.addEventListener(
							'open',
							() => {
								clearTimeout(timer);
								resolve();
							},
							{ once: true }
						);
						ws.addEventListener(
							'close',
							() => {
								clearTimeout(timer);
								reject(new Error('Connection closed'));
							},
							{ once: true }
						);
						if (signal.aborted) close();
					});
					cancelOpen = undefined;
					await request('server.connection.identify', {
						client_name: 'Perilune',
						url: 'https://github.com/colecrouter/perilune',
						version: '0.0.1',
						type: 'web',
						...(config.apiKey ? { api_key: config.apiKey } : {})
					});
					while (!closed && !signal.aborted) {
						const version = readinessVersion;
						const server = record(await request('server.info'));
						historyEnabled =
							Array.isArray(server.components) && server.components.includes('history');
						if (closed || signal.aborted) break;
						if (version !== readinessVersion) continue;
						if (config.discoverWebcams) {
							const webcams = await request('server.webcams.list')
								.then((value) => record(value).webcams)
								.catch(() => undefined);
							if (closed || signal.aborted) break;
							if (Array.isArray(webcams)) await publish({ ...current, webcams });
							if (version !== readinessVersion) continue;
						}
						const klippy = klippyState(server.klippy_state);
						await publish({
							...current,
							connection: 'connected',
							klippy,
							telemetryReady: subscribed && klippy === 'ready'
						});
						if (klippy === 'ready' && !subscribed) {
							const list = record(await request('printer.objects.list'));
							if (closed || signal.aborted) break;
							if (version !== readinessVersion) continue;
							const objects = Array.isArray(list.objects)
								? list.objects.filter((name): name is string => typeof name === 'string')
								: [];
							const requested = Object.fromEntries([
								...objects
									.filter(
										(name) =>
											name in wanted &&
											(name !== 'configfile' ||
												config.liveMeshEnabled ||
												config.liveControlsEnabled)
									)
									.map((name) => [name, wanted[name]]),
								...objects
									.filter((name) => !(name in wanted) && temperatureFields(name))
									.slice(0, 30)
									.map((name) => [name, temperatureFields(name)])
							]);

							subscribing = true;
							buffered = [];
							const initial = record(
								await request('printer.objects.subscribe', { objects: requested })
							);
							subscribing = false;
							if (closed || signal.aborted) break;
							if (version !== readinessVersion) continue;
							status = {};
							for (const [name, value] of Object.entries(record(initial.status)))
								if (name in wanted || temperatureFields(name)) status[name] = record(value);
							const initialTime = number(initial.eventtime);
							for (const update of buffered)
								if (initialTime === null || update.time === null || update.time >= initialTime)
									mergeStatus(status, update.delta);
							buffered = [];
							subscribed = true;
							await publish(
								normalizeMoonrakerStatus(status, {
									...current,
									availableObjects: objects,
									pidTelemetry: { available: false, limits: {}, pending: {} },
									console: {
										macros: discoverMacros(objects, {}),
										responses: current.console?.responses ?? []
									}
								})
							);
							await refreshHistory();
							if (current.console?.macros.length || config.pidCalibrationEnabled)
								void request('printer.gcode.help', undefined, timeout, false)
									.then((help) => {
										if (closed || signal.aborted || version !== readinessVersion) return;
										return publish({
											...current,
											pidTelemetry: {
												limits: current.heaterLimits ?? {},
												pending: current.pidTelemetry?.pending ?? {},
												available:
													config.pidCalibrationEnabled === true &&
													Object.hasOwn(record(help), 'PID_CALIBRATE') &&
													Object.hasOwn(record(help), 'TURN_OFF_HEATERS') &&
													!objects.some((name) =>
														['GCODE_MACRO PID_CALIBRATE', 'GCODE_MACRO TURN_OFF_HEATERS'].includes(
															name.toUpperCase()
														)
													)
											},
											console: {
												macros: discoverMacros(objects, help),
												responses: current.console?.responses ?? []
											}
										});
									})
									.catch(() => {
										/* Optional descriptions never interrupt telemetry readiness. */
									});
						}
						const fence = (generation: number) => {
							if (
								(!config.liveMeshEnabled && !config.liveControlsEnabled) ||
								closed ||
								signal.aborted ||
								!subscribed ||
								current.klippy !== 'ready' ||
								!current.telemetryReady ||
								current.generation !== generation
							)
								throw new MoonrakerCommandError({ sent: false });
						};
						dispatch = async (operation, generation, permit) => {
							fence(generation);
							const basic =
								operation.type === 'controlScript' ||
								operation.type === 'job' ||
								operation.type === 'pidCalibrate';
							if (
								operation.type === 'pidCalibrate' &&
								(!config.pidCalibrationEnabled ||
									!current.pidTelemetry?.available ||
									!Number.isInteger(operation.target) ||
									operation.target < 30 ||
									operation.target > 300 ||
									!['nozzle', 'bed'].includes(operation.heater))
							)
								throw new MoonrakerCommandError({ sent: false });
							if (basic ? !config.liveControlsEnabled : !config.liveMeshEnabled)
								throw new MoonrakerCommandError({ sent: false });
							const method =
								operation.type === 'job'
									? `printer.print.${operation.method}`
									: 'printer.gcode.script';
							const params =
								operation.type === 'job'
									? operation.method === 'start'
										? { filename: operation.filename }
										: {}
									: {
											script:
												operation.type === 'controlScript'
													? operation.script
													: operation.type === 'pidCalibrate'
														? `PID_CALIBRATE HEATER=${operation.heater === 'bed' ? 'heater_bed' : 'extruder'} TARGET=${operation.target}\nTURN_OFF_HEATERS`
														: meshScript(operation)
										};
							if (permit && !permit()) throw new MoonrakerCommandError({ sent: false });
							try {
								await request(
									method,
									params,
									operation.type === 'pidCalibrate'
										? 30 * 60 * 1000
										: operation.type === 'save' || basic
											? 120_000
											: 10 * 60 * 1000
								);
							} catch {
								throw new MoonrakerCommandError({ sent: true });
							}
						};
						refresh = async (generation) => {
							fence(generation);
							if (refreshing) throw new MoonrakerCommandError({ sent: false });
							refreshing = [];
							try {
								const result = record(
									await request('printer.objects.query', {
										objects: Object.fromEntries(
											Object.entries(wanted).filter(([name]) =>
												current.availableObjects.includes(name)
											)
										)
									})
								);
								fence(generation);
								mergeStatus(status, record(result.status));
								const at = number(result.eventtime);
								for (const delta of refreshing)
									if (at === null || delta.time === null || delta.time >= at)
										mergeStatus(status, delta.delta);
								await publish(normalizeMoonrakerStatus(status, current));
								await refreshHistory();
								fence(generation);
								for (const delta of refreshing)
									if (at === null || delta.time === null || delta.time >= at)
										mergeStatus(status, delta.delta);
								await publish(normalizeMoonrakerStatus(status, current));
								return current;
							} catch {
								throw new MoonrakerCommandError({ sent: false });
							} finally {
								refreshing = undefined;
							}
						};
						if (klippy !== 'ready') subscribed = false;
						failures = 0;
						await new Promise<void>((resolve) => {
							const timer = setTimeout(resolve, heartbeat);
							wake = () => {
								clearTimeout(timer);
								resolve();
							};
							if (closed || signal.aborted) wake();
						});
						wake = undefined;
					}
				} catch {
					/* Public state deliberately excludes private URLs, credentials and server errors. */
				} finally {
					dispatch = undefined;
					refresh = undefined;
					close();
					signal.removeEventListener('abort', close);
				}
				if (signal.aborted) break;
				await publish({
					...current,
					connection: 'reconnecting',
					klippy: 'unknown',
					telemetryReady: false
				});
				const delay = Math.min(reconnectMax, reconnectMin * 2 ** Math.min(failures++, 10));
				await new Promise<void>((resolve) => {
					const done = () => {
						clearTimeout(timer);
						signal.removeEventListener('abort', done);
						resolve();
					};
					const timer = setTimeout(done, delay);
					signal.addEventListener('abort', done, { once: true });
					if (signal.aborted) done();
				});
			}
		});
		yield* worker.pipe(Effect.forkScoped);
		return {
			state,
			control: (operation, generation, permit) =>
				Effect.tryPromise({
					try: () =>
						dispatch
							? dispatch(operation, generation, permit)
							: Promise.reject(new MoonrakerCommandError({ sent: false })),
					catch: (cause) =>
						cause instanceof MoonrakerCommandError
							? cause
							: new MoonrakerCommandError({ sent: false })
				}),
			command: (operation, generation, permit) =>
				Effect.tryPromise({
					try: () =>
						dispatch
							? dispatch(operation, generation, permit)
							: Promise.reject(new MoonrakerCommandError({ sent: false })),
					catch: (cause) =>
						cause instanceof MoonrakerCommandError
							? cause
							: new MoonrakerCommandError({ sent: false })
				}),
			refresh: (generation) =>
				Effect.tryPromise({
					try: () =>
						refresh
							? refresh(generation)
							: Promise.reject(new MoonrakerCommandError({ sent: false })),
					catch: () => new MoonrakerCommandError({ sent: false })
				})
		};
	})
);

function mergeStatus(status: ObjectStatus, delta: Record<string, unknown>) {
	for (const [name, value] of Object.entries(delta)) {
		if (!(name in wanted) && !temperatureFields(name)) continue;
		const fields = record(value);
		const merged = { ...status[name], ...fields };
		if (name === 'print_stats' && 'info' in fields && fields.info !== null)
			merged.info = { ...record(status[name]?.info), ...record(fields.info) };
		status[name] = merged;
	}
}

function normalizeMotion(status: ObjectStatus): MotionSnapshot {
	const result = emptyMotion();
	const toolhead = status.toolhead;
	if (!toolhead) return result;
	const position = Array.isArray(toolhead.position) ? toolhead.position : [];
	const minimum = Array.isArray(toolhead.axis_minimum) ? toolhead.axis_minimum : [];
	const maximum = Array.isArray(toolhead.axis_maximum) ? toolhead.axis_maximum : [];
	for (const [index, axis] of axes.entries()) {
		result.position[axis] = number(position[index]);
		const min = number(minimum[index]);
		const max = number(maximum[index]);
		result.limits[axis] = min !== null && max !== null && min < max ? { min, max } : null;
	}
	result.calibration = status.manual_probe?.is_active === true;
	result.homed = axes.filter(
		(axis) => typeof toolhead.homed_axes === 'string' && toolhead.homed_axes.includes(axis)
	);
	const idle = status.idle_timeout?.state;
	result.busy =
		idle === 'Printing' ? true : ['Ready', 'Idle'].includes(String(idle)) ? false : null;
	return result;
}

function normalizeZProbe(status: ObjectStatus): import('#lib/domain/live-z.js').ZProbeCapability {
	const config = record(status.configfile?.config),
		pending = record(status.configfile?.save_config_pending_items);
	const probe = record(config.probe ?? config.bltouch),
		endstop = record(config.stepper_z);
	const method =
		config.probe || config.bltouch
			? 'probe'
			: typeof endstop.endstop_pin === 'string' && !endstop.endstop_pin.includes('virtual_endstop')
				? 'endstop'
				: null;
	const section = config.bltouch ? 'bltouch' : 'probe',
		option = method === 'probe' ? 'z_offset' : 'position_endstop';
	const offset: [number, number] = [Number(probe.x_offset ?? 0), Number(probe.y_offset ?? 0)];
	return {
		method,
		configuredOffset: number(Number((method === 'probe' ? probe : endstop)[option] ?? NaN)),
		setting: `${method === 'probe' ? section : 'stepper_z'}.${option}`,
		active: status.manual_probe?.is_active === true,
		z: number(status.manual_probe?.z_position),
		offset: offset.every(Number.isFinite) ? offset : null,
		pending: status.configfile?.save_config_pending === true,
		pendingKeys: Object.entries(pending)
			.flatMap(([section, values]) => Object.keys(record(values)).map((key) => `${section}.${key}`))
			.slice(0, 100),
		pendingOffset: number(
			Number(record(pending[method === 'probe' ? section : 'stepper_z'])[option] ?? NaN)
		)
	};
}
