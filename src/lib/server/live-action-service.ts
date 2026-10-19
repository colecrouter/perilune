import {
	filamentChangeActive,
	interruptFilamentChange,
	defaultFilamentChangeSettings,
	type FilamentChangeSession,
	type FilamentChangeSettings,
	type FilamentChangeCommand
} from '#lib/domain/filament-change.js';
import { sameFilamentPosition } from './filament-change-assisted.js';
import { filamentChangePlan } from './filament-change-plan.js';
import { recordJobOwner } from './job-attribution.js';
import { pidActive, pidReason, samePid, type PidState } from '#lib/domain/pid.js';
import { liveConsoleScript, consoleReason } from '#lib/domain/console.js';
import { zProbePlan } from './live-z.js';
import { liveZActive, interruptLiveZ, type LiveZState } from '#lib/domain/live-z.js';
import { filamentPlan } from './live-filament.js';
import { extrusionActive, interruptExtrusion, type ExtrusionState } from '#lib/domain/extrusion.js';
import { safetyReason } from '#lib/domain/safety.js';
import { createHash } from 'node:crypto';
import { Context, Effect, Layer, Schedule, SubscriptionRef } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import {
	actionLabel,
	applyCommand,
	type ActionRecord,
	type ActionRequest,
	type PrinterSnapshot
} from '#lib/domain/printer.js';
import type { CalibrationActor } from '#lib/domain/calibration.js';
import { meshProbeActive } from '#lib/domain/mesh-probe.js';
import { ActionStore } from './action-store.js';
import { ActionRejected, PrinterService } from './printer-service.js';
import { MoonrakerService, type ControlOperation, type MoonrakerSnapshot } from './moonraker.js';
import { JobService } from './job-service.js';
import { printerAdmission, printerInterlock } from './printer-admission.js';

export class LiveActionSettings extends Context.Service<
	LiveActionSettings,
	{
		enabled: boolean;
		filamentEnabled?: boolean;
		zEnabled?: boolean;
		consoleEnabled?: boolean;
		pidEnabled?: boolean;
		target: string;
		observationMs?: number;
	}
>()('perilune/LiveActionSettings') {}
export class LiveActionService extends Context.Service<
	LiveActionService,
	{
		submit: (
			request: ActionRequest,
			actor: CalibrationActor
		) => Effect.Effect<ActionRecord, ActionRejected>;
		recover: (
			id: string,
			actor: CalibrationActor,
			pausedJob?: { filename: string; runId: string }
		) => Effect.Effect<void, ActionRejected>;
	}
>()('perilune/LiveActionService') {}
// Old run IDs are process-local. Paused recovery therefore requires explicit owner
// attestation plus a fresh view identity, rather than pretending an old ID proves continuity.
function resumeFilename(payload: string | undefined): string | undefined {
	try {
		const command = JSON.parse(payload ?? 'null');
		if (
			(command?.type === 'resume' || command?.type?.startsWith('filamentChange')) &&
			typeof command.expectedJob?.runId === 'string' &&
			command.expectedJob.runId &&
			typeof command.expectedJob.filename === 'string' &&
			command.expectedJob.filename
		)
			return command.expectedJob.filename;
	} catch {
		/* A missing/corrupt command is never a paused-recovery candidate. */
	}
	return undefined;
}
export const LiveActionDisabled = Layer.succeed(LiveActionService, {
	submit: () => Effect.fail(new ActionRejected({ message: 'No live printer is configured.' })),
	recover: () => Effect.fail(new ActionRejected({ message: 'No live printer is configured.' }))
});
const reject = (message: string) => new ActionRejected({ message });
const check = <A>(f: () => A) =>
	Effect.try({
		try: f,
		catch: (cause) => reject(cause instanceof Error ? cause.message : 'Action validation failed.')
	});
const authorized = (actor: CalibrationActor) => {
	try {
		return ['owner', 'operator'].includes(actor.role ?? '') && actor.authorized?.() === true;
	} catch {
		return false;
	}
};
const recoveryMessage =
	'A live action has an unknown outcome. Inspect the printer, then review recovery in Controls. No command was replayed.';
const supported = new Set([
	'filamentChangePark',
	'filamentChangeFeed',
	'filamentChangeBegin',
	'filamentChangeResume',
	'filamentChangeEnd',
	'filamentChangeRecover',
	'pidCalibrate',
	'console',
	'zProbeBegin',
	'zProbeAdjust',
	'zProbeAccept',
	'zProbeAbort',
	'extrusionBegin',
	'extrusionFeed',
	'extrusionMeasure',
	'extrusionFinish',
	'extrusionCancel',
	'move',
	'home',
	'releaseMotors',
	'temperature',
	'cooldown',
	'start',
	'pause',
	'resume',
	'cancel'
]);

/** Relative distances preserve offsets; restore modal state without moving back. */
export function movementScript(
	command: Extract<ActionRequest['command'], { type: 'move' }>
): string {
	const words = (['x', 'y', 'z'] as const).flatMap((axis) =>
		command.target[axis] === undefined
			? []
			: [
					`${axis.toUpperCase()}${(command.target[axis]! - command.expectedPosition[axis]).toFixed(3)}`
				]
	);
	return `SAVE_GCODE_STATE NAME=perilune_manual_move\nG91\nG1 ${words.join(' ')} F${command.target.z === undefined ? 3000 : 300}\nM400\nRESTORE_GCODE_STATE NAME=perilune_manual_move`;
}
function checked(snapshot: PrinterSnapshot, fresh: MoonrakerSnapshot): PrinterSnapshot {
	return {
		...snapshot,
		connection: fresh.connection,
		klippy: fresh.klippy,
		telemetryReady: fresh.telemetryReady,
		motion: fresh.motion,
		heaters: fresh.heaters,
		job: fresh.job,
		bedMesh: fresh.bedMesh,
		filament: fresh.filament,
		zProbe: fresh.zProbe,
		pidTelemetry: fresh.pidTelemetry
	};
}
export const LiveActionServiceLive = Layer.effect(
	LiveActionService,
	Effect.gen(function* () {
		const printer = yield* PrinterService,
			transport = yield* MoonrakerService,
			store = yield* ActionStore,
			jobs = yield* JobService,
			sql = yield* SqlClient,
			settings = yield* LiveActionSettings;
		const gate = printerAdmission(printer.state);
		const interlock = printerInterlock(printer.state);
		const target = createHash('sha256').update(settings.target).digest('hex');

		const update = (f: (s: PrinterSnapshot) => PrinterSnapshot) =>
			Effect.gen(function* () {
				const hardware = yield* SubscriptionRef.get(transport.state);
				yield* SubscriptionRef.update(printer.state, (s) => {
					const next = f(s);
					return {
						...next,
						motion: {
							...next.motion,
							calibration:
								hardware.motion.calibration ||
								liveZActive(next.liveZ) ||
								meshProbeActive(next.meshProbe) ||
								extrusionActive(next.extrusion) ||
								pidActive(next.pid)
						},
						revision: s.revision + 1,
						updatedAt: Date.now()
					};
				});
			});

		const history = yield* store.list;
		const saved = yield* sql<{
			action_id: string;
		}>`SELECT action_id FROM live_action_reservation WHERE target=${target}`;
		const restoredAction = saved[0] ? yield* store.find(saved[0].action_id) : undefined;
		yield* update((s) => ({
			...s,
			liveControls: settings.enabled,
			liveConsole: settings.enabled && settings.consoleEnabled === true,
			liveFilament: settings.enabled && settings.filamentEnabled === true,
			liveZEnabled: settings.enabled && settings.zEnabled === true,
			actions: history,
			liveRecovery: saved[0]
				? {
						id: saved[0].action_id,
						message: recoveryMessage,
						resumeFilename: resumeFilename(restoredAction?.payload)
					}
				: null
		}));
		const savedSwap = yield* sql<{
			state: string;
		}>`SELECT state FROM filament_change_sessions WHERE target=${target}`;
		const restoredSwap = savedSwap[0]
			? interruptFilamentChange(
					JSON.parse(savedSwap[0].state),
					'Backend restarted. Inspect the paused print and explicitly review guidance. No command was replayed.'
				)
			: null;
		const writeSwap = (state: FilamentChangeSession) =>
			sql`INSERT INTO filament_change_sessions(target,state) VALUES(${target},${JSON.stringify(state)}) ON CONFLICT(target) DO UPDATE SET state=excluded.state`.pipe(
				Effect.asVoid
			);
		const readSwapSetup = () =>
			sql<{
				value: string;
				revision: number;
			}>`SELECT value,revision FROM filament_change_settings WHERE target=${target}`.pipe(
				Effect.map((rows) =>
					rows[0]
						? ({
								...JSON.parse(rows[0].value),
								revision: rows[0].revision
							} as FilamentChangeSettings)
						: defaultFilamentChangeSettings
				)
			);
		yield* update((s) => ({ ...s, filamentChange: restoredSwap }));
		if (restoredSwap) yield* writeSwap(restoredSwap);
		let swapActor: CalibrationActor | undefined;
		let swapCheckpoint: FilamentChangeSession | undefined;
		const persistedFilament = yield* sql<{
			state: string;
		}>`SELECT state FROM live_filament_state WHERE target=${target}`;
		const restoredFilament = persistedFilament[0]
			? interruptExtrusion(
					JSON.parse(persistedFilament[0].state) as ExtrusionState,
					'Backend restarted. No filament movement was replayed; inspect the printer before a new test.'
				)
			: { session: null };
		const writeFilament = (state: ExtrusionState) =>
			sql`INSERT INTO live_filament_state(target,state) VALUES(${target},${JSON.stringify(state)}) ON CONFLICT(target) DO UPDATE SET state=excluded.state`.pipe(
				Effect.asVoid
			);
		yield* writeFilament(restoredFilament);
		yield* update((s) => ({ ...s, extrusion: restoredFilament }));
		const persistedZ = yield* sql<{
			state: string;
		}>`SELECT state FROM live_z_state WHERE target=${target}`;
		const restoredZ = persistedZ[0]
			? interruptLiveZ(
					JSON.parse(persistedZ[0].state) as LiveZState,
					'Backend restarted. The helper was not resumed. Inspect the printer and abort any remaining manual probe.'
				)
			: { session: null };
		const writeZ = (state: LiveZState) =>
			sql`INSERT INTO live_z_state(target,state) VALUES(${target},${JSON.stringify(state)}) ON CONFLICT(target) DO UPDATE SET state=excluded.state`.pipe(
				Effect.asVoid
			);
		yield* writeZ(restoredZ);
		yield* update((s) => ({ ...s, liveZ: restoredZ }));
		const pidRows = yield* sql<{
			state: string;
		}>`SELECT state FROM pid_state WHERE target=${target}`;
		const priorPid = pidRows[0]
			? (JSON.parse(pidRows[0].state) as PidState)
			: { enabled: false, run: null };
		const restoredPid: PidState = {
			enabled: settings.enabled && settings.pidEnabled === true,
			run:
				priorPid.run?.stage === 'running'
					? {
							...priorPid.run,
							stage: 'interrupted',
							parameters: null,
							message:
								'Backend restarted. PID calibration was not replayed. Inspect the printer and review recovery.'
						}
					: priorPid.run
		};
		const writePid = (state: PidState) =>
			sql`INSERT INTO pid_state(target,state) VALUES(${target},${JSON.stringify(state)}) ON CONFLICT(target) DO UPDATE SET state=excluded.state`.pipe(
				Effect.asVoid
			);
		yield* writePid(restoredPid);
		yield* update((s) => ({ ...s, pid: restoredPid }));
		let zActor: CalibrationActor | undefined, zCheckpoint: LiveZState | undefined;

		let filamentActor: CalibrationActor | undefined;
		let filamentCheckpoint: ExtrusionState | undefined;

		let work:
			| {
					request: ActionRequest;
					actor: CalibrationActor;
					action: ActionRecord;
					generation: number;
					epoch: number;
			  }
			| undefined;
		let working = false;
		const validate = (s: PrinterSnapshot, request: ActionRequest, actor: CalibrationActor) => {
			if (
				filamentChangeActive(s.filamentChange) &&
				!request.command.type.startsWith('filamentChange') &&
				!['cancel', 'temperature', 'cooldown'].includes(request.command.type)
			)
				throw reject(
					'Filament-change guidance owns this print. Continue or end it in Filament changes.'
				);
			if (
				filamentChangeActive(s.filamentChange) &&
				['temperature', 'cooldown'].includes(request.command.type) &&
				s.filamentChange?.ownerId !== actor.id
			)
				throw reject(
					'The operator handling this filament change controls its heater targets. An owner can explicitly take over guidance.'
				);
			if (request.command.type.startsWith('filamentChange') && extrusionActive(s.extrusion))
				throw reject('Finish or recover extrusion calibration before starting filament guidance.');
			if (pidActive(s.pid))
				throw reject(
					'PID calibration owns the printer. Use the independent emergency control to stop it.'
				);
			if (request.command.type === 'pidCalibrate') {
				if (!settings.pidEnabled || actor.role !== 'owner')
					throw reject('An owner and explicit PID calibration opt-in are required.');
				const reason = pidReason(s, request.command.heater, request.command.target, true, false);
				if (reason) throw reject(reason);
			}
			if (interlock.halted || safetyReason(s.safety))
				throw reject(safetyReason(s.safety) ?? 'Emergency stop interlock is active.');
			if (!settings.enabled) throw reject('Live controls are disabled on this server.');
			if (request.command.type === 'console' && !settings.consoleEnabled)
				throw reject('Live console is disabled on this server.');
			if (request.command.type.startsWith('zProbe') && !settings.zEnabled)
				throw reject('Live Z calibration is disabled on this server.');
			if (
				(request.command.type.startsWith('extrusion') ||
					request.command.type === 'filamentChangeFeed' ||
					request.command.type === 'filamentChangePark') &&
				!settings.filamentEnabled
			)
				throw reject('Live filament controls are disabled on this server.');
			if (!authorized(actor)) throw reject('An authorized operator is required.');
			if (!supported.has(request.command.type))
				throw reject('This live workflow is not enabled yet.');
			if (s.liveRecovery) throw reject(recoveryMessage);
			if (request.command.type === 'resume' && !request.command.expectedJob?.runId)
				throw reject('Refresh the current print before resuming; its run identity is unavailable.');
			if (liveZActive(s.liveZ) && !request.command.type.startsWith('zProbe'))
				throw reject('Z calibration owns the printer.');
			if (
				s.configurationBusy ||
				(s.motion.calibration &&
					!request.command.type.startsWith('zProbe') &&
					!(request.command.type.startsWith('extrusion') && extrusionActive(s.extrusion))) ||
				meshProbeActive(s.meshProbe)
			)
				throw reject('Another workflow owns the printer. Finish or recover it first.');
			if (
				!['toolhead', 'idle_timeout', 'print_stats'].every((name) =>
					s.availableObjects.includes(name)
				) ||
				s.job.state === 'unknown'
			)
				throw reject('Required printer status is unavailable.');
			if (s.storage !== 'healthy') throw reject('Action storage is recovering.');
			if (s.connection !== 'connected' || s.klippy !== 'ready' || !s.telemetryReady)
				throw reject('Wait for fresh, ready printer telemetry.');
		};
		const plan = (request: ActionRequest, s: PrinterSnapshot, fresh: MoonrakerSnapshot) =>
			Effect.gen(function* () {
				const c = request.command;
				if (c.type === 'pidCalibrate') {
					const reason = pidReason(s, c.heater, c.target, true, false);
					if (reason) return yield* Effect.fail(reject(reason));
					return [
						{ type: 'pidCalibrate', heater: c.heater, target: c.target }
					] satisfies ControlOperation[];
				}
				if (c.type === 'console') {
					const reason = consoleReason({
						...s,
						actions: s.actions.filter((a) => a.id !== request.id)
					});
					if (reason) return yield* Effect.fail(reject(reason));
					const script = yield* check(() => liveConsoleScript(c.script));
					return [
						{ type: 'controlScript', script: `${script}\nM400` }
					] satisfies ControlOperation[];
				}
				if (c.type === 'start') {
					if (!s.availableObjects.includes('virtual_sdcard'))
						return yield* Effect.fail(reject('Virtual SD printing is unavailable.'));
					if (!jobs.refresh)
						return yield* Effect.fail(reject('Live catalog refresh is unavailable.'));
					const file = (yield* SubscriptionRef.get(jobs.state)).files.find(
						(f) => f.id === c.fileId
					);
					if (!file || file.source !== 'moonraker')
						return yield* Effect.fail(
							reject('The selected live file changed or is unavailable. Review it again.')
						);
					// Reuse domain readiness validation, with the already verified live catalog identity.
					yield* check(() =>
						applyCommand({ ...s, mode: 'simulator' }, c, { ...file, source: 'local' })
					);
					return [
						{ type: 'job', method: 'start', filename: file.name }
					] satisfies ControlOperation[];
				}
				yield* check(() => applyCommand(s, c));
				if (c.type === 'move')
					return [
						{ type: 'controlScript', script: movementScript(c) }
					] satisfies ControlOperation[];
				if (c.type === 'home')
					return [
						{
							type: 'controlScript',
							script: `G28${c.axes === 'xy' ? ' X Y' : c.axes === 'z' ? ' Z' : ''}\nM400`
						}
					] satisfies ControlOperation[];
				if (c.type === 'releaseMotors') {
					if (c.axes !== 'all')
						return yield* Effect.fail(reject('Klipper releases all motors together.'));
					return [{ type: 'controlScript', script: 'M84' }] satisfies ControlOperation[];
				}
				if (c.type === 'temperature') {
					const limits = fresh.heaterLimits?.[c.heater];
					if (!fresh.availableObjects.includes(c.heater === 'bed' ? 'heater_bed' : 'extruder'))
						return yield* Effect.fail(reject('The requested heater is unavailable.'));
					if (!limits || (c.target !== 0 && (c.target <= limits.min || c.target >= limits.max)))
						return yield* Effect.fail(
							reject(
								'The requested target is outside the configured heater limits, or those limits are unavailable.'
							)
						);
					return [
						{
							type: 'controlScript',
							script: `SET_HEATER_TEMPERATURE HEATER=${c.heater === 'bed' ? 'heater_bed' : 'extruder'} TARGET=${c.target}`
						}
					] satisfies ControlOperation[];
				}
				if (c.type === 'cooldown')
					return [
						{ type: 'controlScript', script: 'TURN_OFF_HEATERS' }
					] satisfies ControlOperation[];
				if (c.type === 'pause' || c.type === 'resume' || c.type === 'cancel') {
					if (!c.expectedJob)
						return yield* Effect.fail(
							reject('Review the current job before submitting this action.')
						);
					if (
						c.type === 'cancel' &&
						(s.heaters.bed.target === null || s.heaters.nozzle.target === null)
					)
						return yield* Effect.fail(
							reject('Heater targets must be known before stopping with cooldown choices.')
						);
					const ops: ControlOperation[] = [{ type: 'job', method: c.type }];
					if (c.type === 'cancel')
						ops.push({
							type: 'controlScript',
							script: `SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=${c.coolBed ? 0 : s.heaters.bed.target}\nSET_HEATER_TEMPERATURE HEATER=extruder TARGET=${c.coolNozzle ? 0 : s.heaters.nozzle.target}`
						});
					return ops;
				}
				return yield* Effect.fail(reject('Unsupported live command.'));
			});
		const run = (job: NonNullable<typeof work>) =>
			Effect.gen(function* () {
				let swapResult: FilamentChangeSession | undefined,
					swapBefore: FilamentChangeSession | null | undefined;
				let sent = false;
				let remainsPaused = false;
				let startRun: string | undefined, startHistory: string | undefined;
				let pidResult: PidState | undefined;
				let zResult: LiveZState | undefined,
					zBefore: LiveZState | undefined,
					zExpected: number | undefined;
				let filamentResult: ExtrusionState | undefined, filamentBefore: ExtrusionState | undefined;
				const result = yield* Effect.gen(function* () {
					if (Date.now() - job.action.createdAt >= 30000)
						return yield* Effect.fail(reject('Action expired before dispatch.'));
					if (job.request.command.type === 'start') {
						if (!jobs.refresh)
							return yield* Effect.fail(reject('Live catalog refresh is unavailable.'));
						yield* jobs.refresh;
					}
					const fresh = yield* transport.refresh(job.generation);
					const s = checked(yield* SubscriptionRef.get(printer.state), fresh);
					yield* check(() => validate(s, job.request, job.actor));
					const filament = job.request.command.type.startsWith('extrusion')
						? yield* check(() => filamentPlan(job.request, s, fresh, job.actor))
						: null;
					const z = job.request.command.type.startsWith('zProbe')
						? yield* check(() => zProbePlan(job.request, s, fresh, job.actor))
						: null;
					const swapSetup = job.request.command.type.startsWith('filamentChange')
						? yield* readSwapSetup()
						: null;
					const swap = job.request.command.type.startsWith('filamentChange')
						? yield* check(() =>
								filamentChangePlan(
									job.request.command as FilamentChangeCommand,
									job.action.id,
									s.filamentChange,
									swapSetup!,
									fresh,
									job.actor
								)
							)
						: null;
					const operations =
						swap?.operations ??
						z?.operations ??
						filament?.operations ??
						(yield* plan(job.request, s, fresh));
					if (swap) {
						swapResult = swap.session;
						swapBefore = s.filamentChange;
					}
					if (z) {
						zResult = z.state;
						zBefore = s.liveZ ?? { session: null };
						zExpected = z.expectedZ;
					}

					if (filament) {
						filamentResult = filament.state;
						filamentBefore = s.extrusion;
					}

					if (!authorized(job.actor))
						return yield* Effect.fail(reject('The operator account is no longer authorized.'));
					if (Date.now() - job.action.createdAt >= 30000)
						return yield* Effect.fail(reject('Action expired before dispatch.'));
					if (job.request.command.type === 'pidCalibrate') {
						const c = job.request.command;
						pidResult = {
							enabled: true,
							run: {
								id: job.action.id,
								ownerId: job.actor.id,
								heater: c.heater,
								target: c.target,
								startedAt: Date.now(),
								stage: 'running',
								parameters: null,
								message:
									'Klipper is heating and cycling this heater. Stay with the printer; leaving this page does not stop calibration.'
							}
						};
						yield* writePid(pidResult);
						yield* update((s) => ({ ...s, pid: pidResult! }));
					}
					yield* store.setStatus(job.action.id, 'sending', null);
					yield* update((s) => ({
						...s,
						actions: s.actions.map((a) =>
							a.id === job.action.id ? { ...a, status: 'sending' } : a
						)
					}));
					if (
						filamentResult &&
						['extrusionBegin', 'extrusionFeed'].includes(job.request.command.type)
					) {
						yield* writeFilament(filamentResult);
						yield* update((s) => ({ ...s, extrusion: filamentResult! }));
					}
					if (zResult) {
						const pendingZ = {
							session: {
								...zResult.session!,
								stage: 'active' as const,
								message: 'Waiting for printer acknowledgement and fresh helper state.'
							}
						};
						yield* writeZ(pendingZ);
						yield* update((s) => ({ ...s, liveZ: pendingZ }));
					}
					if (swapResult) {
						yield* writeSwap(swapResult);
						yield* update((s) => ({ ...s, filamentChange: swapResult }));
					}
					for (const [index, op] of operations.entries()) {
						if (index === 0 && Date.now() - job.action.createdAt >= 30000)
							return yield* Effect.fail(reject('Action expired before dispatch.'));
						if (index > 0 && job.request.command.type === 'cancel') {
							const stopped = yield* transport.refresh(job.generation);
							if (
								!['cancelled', 'standby', 'complete'].includes(stopped.job.state) ||
								stopped.job.filename !== s.job.filename ||
								stopped.job.runId !== s.job.runId
							)
								return yield* Effect.fail(
									reject('The job changed or did not stop. Heater restoration was not sent.')
								);
						}
						if (!authorized(job.actor))
							return yield* Effect.fail(reject('The operator account is no longer authorized.'));
						if (!transport.control)
							return yield* Effect.fail(reject('Live transport controls are unavailable.'));
						const dispatched = yield* transport
							.control(
								op,
								job.generation,
								() => interlock.allows(job.epoch) && authorized(job.actor)
							)
							.pipe(Effect.result);
						if (dispatched._tag === 'Failure') {
							sent ||= dispatched.failure.sent;
							return yield* Effect.fail(
								reject('Printer command failed or its acknowledgement was lost.')
							);
						}
						sent = true;
					}
					// Ack is insufficient: observe the intended state through a fresh query.
					const deadline =
						Date.now() +
						(settings.observationMs ??
							(job.request.command.type === 'resume' || swapResult ? 120000 : 10000));
					while (true) {
						if (!interlock.allows(job.epoch))
							return yield* Effect.fail(reject('Emergency stop interrupted action verification.'));
						const observed = yield* transport.refresh(job.generation);
						if (!interlock.allows(job.epoch))
							return yield* Effect.fail(reject('Emergency stop interrupted action verification.'));
						const c = job.request.command;
						if (swapResult) {
							const command = c as FilamentChangeCommand;
							if (
								observed.job.filename !== command.expectedJob.filename ||
								(observed.job.runId ?? '') !== command.expectedJob.runId
							)
								return yield* Effect.fail(
									reject('Print identity changed during filament verification.')
								);
							if (
								observed.connection !== 'connected' ||
								observed.klippy !== 'ready' ||
								!observed.telemetryReady
							)
								return yield* Effect.fail(
									reject('Printer continuity was lost during filament verification.')
								);
							if (
								command.type === 'filamentChangeEnd' &&
								observed.motion.busy === false &&
								observed.job.state !== 'printing'
							)
								return;
							if (
								command.type === 'filamentChangeResume' &&
								observed.job.state === 'printing' &&
								observed.paused === false
							) {
								swapResult = {
									...swapResult,
									stage: 'finished',
									message: 'The same print is running again. Filament guidance is complete.'
								};
								return;
							}
							if (!observed.motion.calibration && observed.motion.busy === false) {
								if (observed.job.state === 'paused' && observed.paused === true) {
									const move = swapResult.pendingMove;
									if (move) {
										const xyz =
											move.kind === 'park' ? move.position : swapResult.assisted?.position;
										const physical =
											move.kind === 'park'
												? move.physicalPosition
												: swapResult.assisted?.physicalPosition;
										if (
											!sameFilamentPosition(observed.gcodePosition, xyz) ||
											!sameFilamentPosition(
												observed.motion.position as { x: number; y: number; z: number },
												physical
											) ||
											(move.kind === 'feed' &&
												(!observed.gcodePosition ||
													Math.abs(observed.gcodePosition.e - move.startE - move.distance) >= 0.05))
										) {
											return yield* Effect.fail(
												reject(
													'The assisted move could not be verified. Inspect the printer; this move will not be repeated.'
												)
											);
										}
										swapResult = {
											...swapResult,
											pendingMove: undefined,
											assisted: { parked: true, position: xyz, physicalPosition: physical },
											message:
												move.kind === 'park'
													? 'Parking verified. Choose one attended unload, load or purge step.'
													: `${move.operation} movement verified. Inspect the filament before choosing another step or Resume.`
										};
									}
									swapResult = {
										...swapResult,
										stage: 'paused',
										message:
											command.type === 'filamentChangeResume'
												? 'Resume macro completed; this print remains paused. Follow the printer instructions and remove purged material before another deliberate Resume.'
												: command.type === 'filamentChangeRecover' ||
													  command.type === 'filamentChangePark' ||
													  command.type === 'filamentChangeFeed'
													? swapResult.message
													: swapResult.assisted
														? 'Print paused and stationary. Inspect the nozzle clearance and verify parking before extrusion. No unload or load was sent.'
														: 'Print paused and stationary. Follow your printer macro’s unload/load instructions. Perilune has not added any park or extrusion moves.'
									};
									return;
								}
							}
							if (Date.now() >= deadline)
								return yield* Effect.fail(
									reject(
										'The filament macro could not be matched to a stationary pause or resumed print.'
									)
								);
							yield* Effect.sleep('250 millis');
							continue;
						}
						if (c.type === 'pidCalibrate') {
							const parameters = observed.pidTelemetry?.pending[c.heater];
							if (
								parameters &&
								observed.liveMesh.pendingConfig &&
								observed.heaters.bed.target === 0 &&
								observed.heaters.nozzle.target === 0 &&
								observed.motion.busy === false &&
								['standby', 'complete', 'cancelled', 'error'].includes(observed.job.state)
							) {
								pidResult = {
									...pidResult!,
									run: {
										...pidResult!.run!,
										stage: 'staged',
										parameters,
										message:
											'Klipper completed tuning and staged these parameters. Review all pending settings before saving and restarting; the previous control settings remain active.'
									}
								};
								return;
							}
							if (Date.now() >= deadline)
								return yield* Effect.fail(
									reject(
										'PID completion could not be matched to pending parameters and heater targets off.'
									)
								);
							yield* Effect.sleep('250 millis');
							continue;
						}

						if (zResult) {
							const c = job.request.command,
								cap = observed.zProbe;
							const matched =
								c.type === 'zProbeAbort'
									? !cap?.active
									: c.type === 'zProbeAccept'
										? !cap?.active && cap?.pending && cap.pendingOffset !== null
										: cap?.active &&
											cap.z !== null &&
											(zExpected === undefined || Math.abs(cap.z - zExpected) < 0.005);
							if (matched && cap) {
								zResult = {
									session: {
										...zResult.session!,
										z: cap.z,
										candidate:
											c.type === 'zProbeAccept' ? cap.pendingOffset : zResult.session!.candidate,
										message:
											c.type === 'zProbeAccept'
												? 'Accepted by Klipper as a pending configuration change. It is not saved or active until reviewed save/restart.'
												: zResult.session!.message
									}
								};
								return;
							}
							if (Date.now() >= deadline)
								return yield* Effect.fail(
									reject(
										'The probe helper acknowledgement could not be reconciled with fresh state.'
									)
								);
							yield* Effect.sleep('250 millis');
							continue;
						}
						if (filamentResult) {
							const c = job.request.command;
							if (c.type === 'extrusionBegin' || c.type === 'extrusionFeed') {
								const distance = c.type === 'extrusionBegin' ? 50 : c.distance;
								if (
									observed.filament?.position === null ||
									observed.filament?.position === undefined ||
									fresh.filament?.position === null ||
									fresh.filament?.position === undefined ||
									Math.abs(observed.filament.position - fresh.filament.position - distance) > 0.05
								)
									return yield* Effect.fail(
										reject(
											'Extruder commanded position did not match. Inspect filament travel; no command was replayed.'
										)
									);
								filamentResult = {
									session: {
										...filamentResult.session!,
										stage: c.type === 'extrusionBegin' ? 'measure' : 'finished',
										completed: Math.abs(distance),
										message:
											'Movement acknowledged and commanded position observed. Measure real filament travel; this is not an encoder reading.'
									}
								};
							}
							if (
								(c.type === 'extrusionFinish' || c.type === 'extrusionCancel') &&
								c.coolNozzle &&
								observed.heaters.nozzle.target !== 0
							)
								return yield* Effect.fail(reject('Nozzle cooldown was not observed.'));
							return;
						}
						const matches =
							c.type === 'console'
								? observed.klippy === 'ready' &&
									!observed.motion.calibration &&
									observed.motion.busy === false
								: c.type === 'move'
									? Object.entries(c.target).every(
											([axis, value]) =>
												Math.abs(
													(observed.motion.position[axis as 'x' | 'y' | 'z'] ?? Infinity) - value!
												) < 0.05
										)
									: c.type === 'home'
										? (c.axes === 'all'
												? ['x', 'y', 'z']
												: c.axes === 'xy'
													? ['x', 'y']
													: ['z']
											).every((axis) => observed.motion.homed.includes(axis as 'x' | 'y' | 'z'))
										: c.type === 'releaseMotors'
											? observed.motion.homed.length === 0
											: c.type === 'temperature'
												? observed.heaters[c.heater].target === c.target
												: c.type === 'cooldown'
													? observed.heaters.bed.target === 0 &&
														observed.heaters.nozzle.target === 0
													: c.type === 'pause'
														? observed.job.state === 'paused'
														: c.type === 'resume'
															? observed.job.state === 'printing' &&
																Boolean(c.expectedJob?.runId) &&
																observed.job.runId === c.expectedJob?.runId &&
																observed.job.filename === c.expectedJob?.filename
															: c.type === 'cancel'
																? ['cancelled', 'standby', 'complete'].includes(
																		observed.job.state
																	) &&
																	observed.heaters.bed.target ===
																		(c.coolBed ? 0 : s.heaters.bed.target) &&
																	observed.heaters.nozzle.target ===
																		(c.coolNozzle ? 0 : s.heaters.nozzle.target)
																: c.type === 'start'
																	? observed.job.state === 'printing' &&
																		observed.job.filename ===
																			(operations[0] as Extract<ControlOperation, { type: 'job' }>)
																				.filename
																	: false;
						if (matches) {
							if (c.type === 'start') {
								if (!observed.job.runId || observed.job.runId === fresh.job.runId)
									return yield* Effect.fail(
										reject('The new print identity could not be verified.')
									);
								startRun = observed.job.runId;
								startHistory =
									fresh.historyCursor !== undefined &&
									observed.historyCursor === observed.job.historyKey &&
									observed.job.historyKey !== fresh.historyCursor
										? observed.job.historyKey
										: undefined;
							}
							return;
						}
						// A staged RESUME can acknowledge a purge and intentionally remain paused.
						// Only accept fresh same-run idle telemetry after acknowledgement; never resend.
						if (
							c.type === 'resume' &&
							c.expectedJob?.runId &&
							observed.connection === 'connected' &&
							observed.klippy === 'ready' &&
							observed.telemetryReady &&
							observed.job.state === 'paused' &&
							observed.job.runId === c.expectedJob.runId &&
							observed.job.filename === c.expectedJob.filename &&
							observed.motion.busy === false &&
							!observed.motion.calibration
						) {
							remainsPaused = true;
							return;
						}
						if (Date.now() >= deadline)
							return yield* Effect.fail(
								reject('The acknowledged action could not be verified from printer state.')
							);
						yield* Effect.sleep('250 millis');
					}
				}).pipe(Effect.result);
				const status = result._tag === 'Success' ? 'completed' : sent ? 'unknown' : 'failed';
				const message =
					status === 'unknown'
						? recoveryMessage
						: result._tag === 'Failure'
							? result.failure instanceof ActionRejected
								? result.failure.message
								: 'Action was not dispatched. Review readiness and submit a new action if needed.'
							: remainsPaused
								? 'Resume macro completed; the print remains paused. Check the printer messages and remove any purged material, then press Resume again when ready.'
								: job.request.command.type === 'console'
									? 'Klipper acknowledged the script and motion barrier; fresh ready state observed. Verify macro-specific effects in telemetry.'
									: null;
				const finalPid: PidState | undefined = pidResult
					? result._tag === 'Success'
						? pidResult
						: {
								...pidResult,
								run: {
									...pidResult.run!,
									stage: sent ? 'interrupted' : 'failed',
									parameters: null,
									message
								}
							}
					: undefined;
				const finalZ = zResult
					? result._tag === 'Success'
						? zResult
						: sent
							? interruptLiveZ(
									{ session: { ...zResult.session!, stage: 'active' } },
									recoveryMessage
								)
							: zBefore!
					: undefined;
				const finalFilament = filamentResult
					? result._tag === 'Success'
						? filamentResult
						: sent
							? interruptExtrusion(filamentResult, recoveryMessage)
							: filamentBefore!
					: undefined;
				const finalSwap = swapResult
					? result._tag === 'Success'
						? swapResult
						: sent
							? interruptFilamentChange(swapResult, recoveryMessage)
							: swapBefore
					: undefined;
				const persisted = yield* sql
					.withTransaction(
						Effect.gen(function* () {
							yield* store.setStatus(job.action.id, status, message);
							if (status === 'completed' && startRun)
								yield* recordJobOwner(startRun, job.action.id, job.actor.id, startHistory).pipe(
									Effect.provideService(SqlClient, sql)
								);
							if (finalSwap) yield* writeSwap(finalSwap);
							else if (swapResult)
								yield* sql`DELETE FROM filament_change_sessions WHERE target=${target}`;
							if (finalFilament) yield* writeFilament(finalFilament);
							if (finalZ) yield* writeZ(finalZ);
							if (finalPid) yield* writePid(finalPid);
							if (status !== 'unknown')
								yield* sql`DELETE FROM live_action_reservation WHERE target=${target} AND action_id=${job.action.id}`;
						})
					)
					.pipe(Effect.result);
				yield* update((s) => ({
					...s,
					filamentChange: swapResult
						? persisted._tag === 'Failure'
							? interruptFilamentChange(swapResult, recoveryMessage)
							: (finalSwap ?? null)
						: s.filamentChange,
					pid: finalPid
						? persisted._tag === 'Failure'
							? {
									...finalPid,
									run: {
										...finalPid.run!,
										stage: 'interrupted',
										parameters: null,
										message: recoveryMessage
									}
								}
							: finalPid
						: s.pid,
					liveZ: finalZ
						? persisted._tag === 'Failure'
							? interruptLiveZ(finalZ, recoveryMessage)
							: finalZ
						: s.liveZ,
					extrusion: finalFilament
						? persisted._tag === 'Failure'
							? interruptExtrusion(finalFilament, recoveryMessage)
							: finalFilament
						: s.extrusion,
					storage: persisted._tag === 'Failure' ? 'degraded' : s.storage,
					liveRecovery:
						status === 'unknown' || persisted._tag === 'Failure'
							? {
									id: job.action.id,
									message: recoveryMessage,
									resumeFilename: resumeFilename(JSON.stringify(job.request.command))
								}
							: null,
					actions: s.actions.map((a) =>
						a.id === job.action.id
							? {
									...a,
									status: persisted._tag === 'Failure' ? 'unknown' : status,
									message: persisted._tag === 'Failure' ? recoveryMessage : message
								}
							: a
					)
				}));
				if (result._tag === 'Success' && swapResult) swapActor = job.actor;
				if (result._tag === 'Success' && filamentResult) filamentActor = job.actor;
				if (result._tag === 'Success' && zResult) zActor = job.actor;
			});
		const monitorSwap = gate.withPermits(1)(
			Effect.gen(function* () {
				if (work || working) return;
				if (swapCheckpoint) {
					const saved = yield* writeSwap(swapCheckpoint).pipe(Effect.result);
					if (saved._tag === 'Success') {
						swapCheckpoint = undefined;
						yield* update((s) => ({ ...s, storage: s.liveRecovery ? s.storage : 'healthy' }));
					}
					return;
				}
				const swapSnapshot = yield* SubscriptionRef.get(printer.state);
				const activeSwap = swapSnapshot.filamentChange;
				if (filamentChangeActive(activeSwap) && activeSwap?.stage !== 'review') {
					const hardware = yield* SubscriptionRef.get(transport.state);
					const interrupted =
						!swapActor ||
						!authorized(swapActor) ||
						swapSnapshot.liveRecovery ||
						interlock.halted ||
						safetyReason(swapSnapshot.safety) ||
						hardware.connection !== 'connected' ||
						hardware.klippy !== 'ready' ||
						!hardware.telemetryReady ||
						hardware.generation !== activeSwap!.generation ||
						hardware.filamentChange?.fingerprint !== activeSwap!.fingerprint ||
						hardware.job.runId !== activeSwap!.runId ||
						hardware.job.filename !== activeSwap!.filename ||
						Date.now() >= activeSwap!.expiresAt ||
						(!!activeSwap!.assisted?.parked &&
							(!sameFilamentPosition(hardware.gcodePosition, activeSwap!.assisted.position) ||
								!sameFilamentPosition(
									hardware.motion.position as { x: number; y: number; z: number },
									activeSwap!.assisted.physicalPosition
								)));
					const ended =
						!interrupted &&
						(['complete', 'cancelled', 'standby', 'error'].includes(hardware.job.state) ||
							(hardware.job.state === 'printing' && hardware.paused === false));
					if (interrupted || ended || hardware.job.state !== 'paused' || hardware.paused !== true) {
						const next = ended
							? {
									...activeSwap!,
									stage: 'finished' as const,
									message: 'Filament guidance ended. No further filament command was sent.'
								}
							: interruptFilamentChange(
									activeSwap!,
									'Filament guidance was interrupted or printer continuity changed. An owner must inspect the current print. No command was replayed.'
								);
						const saved = yield* writeSwap(next).pipe(Effect.result);
						if (saved._tag === 'Failure') swapCheckpoint = next;
						yield* update((s) => ({
							...s,
							filamentChange: next,
							storage: saved._tag === 'Failure' ? 'degraded' : s.storage
						}));
					}
				}
			})
		);
		yield* Effect.gen(function* () {
			if (!work && !working) {
				yield* monitorSwap;
				if (zCheckpoint) {
					const saved = yield* writeZ(zCheckpoint).pipe(Effect.result);
					if (saved._tag === 'Success') {
						zCheckpoint = undefined;
						yield* update((s) => ({ ...s, storage: s.liveRecovery ? s.storage : 'healthy' }));
					}
					return;
				}
				const zs = yield* SubscriptionRef.get(printer.state);
				if (
					zs.pid?.run?.stage === 'staged' &&
					zs.telemetryReady &&
					zs.connection === 'connected' &&
					zs.klippy === 'ready' &&
					!samePid(zs.pid.run.parameters, zs.pidTelemetry?.pending[zs.pid.run.heater])
				) {
					const next: PidState = {
						...zs.pid,
						run: {
							...zs.pid.run,
							stage: 'resolved',
							message:
								'Pending parameters changed or were cleared. They may have been saved or discarded externally; inspect active configuration before another test.'
						}
					};
					const saved = yield* writePid(next).pipe(Effect.result);
					yield* update((s) => ({
						...s,
						pid: next,
						storage: saved._tag === 'Failure' ? 'degraded' : s.storage
					}));
				}
				if (
					zs.liveZ?.session?.stage === 'staged' &&
					zs.zProbe &&
					!zs.zProbe.pending &&
					zs.telemetryReady &&
					zs.connection === 'connected' &&
					zs.klippy === 'ready'
				) {
					const state: LiveZState = {
						session: {
							...zs.liveZ.session,
							stage: 'resolved',
							message:
								'No pending calibration remains. The result may have been saved or discarded externally; review active configuration before another test.'
						}
					};
					const saved = yield* writeZ(state).pipe(Effect.result);
					if (saved._tag === 'Failure') zCheckpoint = state;
					yield* update((s) => ({
						...s,
						liveZ: state,
						storage: saved._tag === 'Failure' ? 'degraded' : s.storage
					}));
				}

				if (
					liveZActive(zs.liveZ) &&
					(zs.liveZ!.session!.expiresAt <= Date.now() ||
						zs.liveRecovery ||
						!zActor ||
						!authorized(zActor) ||
						zs.zProbe?.active !== true ||
						['printing', 'paused'].includes(zs.job.state) ||
						zs.connection !== 'connected' ||
						zs.klippy !== 'ready' ||
						interlock.halted)
				) {
					const state = interruptLiveZ(
						zs.liveZ!,
						'Session interrupted. No command was replayed. Abort the current manual probe before starting again.'
					);
					const saved = yield* writeZ(state).pipe(Effect.result);
					if (saved._tag === 'Failure') zCheckpoint = state;
					yield* update((s) => ({
						...s,
						liveZ: state,
						storage: saved._tag === 'Failure' ? 'degraded' : s.storage
					}));
				}

				if (filamentCheckpoint) {
					const checkpoint = yield* writeFilament(filamentCheckpoint).pipe(Effect.result);
					if (checkpoint._tag === 'Success') {
						filamentCheckpoint = undefined;
						yield* update((s) => ({ ...s, storage: s.liveRecovery ? s.storage : 'healthy' }));
					}
					return;
				}
				const s = yield* SubscriptionRef.get(printer.state);
				if (
					extrusionActive(s.extrusion) &&
					(s.extrusion.session!.expiresAt <= Date.now() ||
						s.liveRecovery ||
						!filamentActor ||
						!authorized(filamentActor) ||
						s.connection !== 'connected' ||
						s.klippy !== 'ready' ||
						interlock.halted ||
						['printing', 'paused'].includes(s.job.state))
				) {
					const state = interruptExtrusion(
						s.extrusion,
						'Filament workflow interrupted. No movement was replayed. Inspect the printer before starting again.'
					);
					const checkpoint = yield* writeFilament(state).pipe(Effect.result);
					if (checkpoint._tag === 'Failure') filamentCheckpoint = state;
					yield* update((s) => ({
						...s,
						extrusion: state,
						storage: checkpoint._tag === 'Failure' ? 'degraded' : s.storage
					}));
				}
				return;
			}
			if (!work || working) return;
			working = true;
			const job = work;
			yield* run(job).pipe(
				Effect.catchCause(() =>
					Effect.gen(function* () {
						const snapshot = yield* SubscriptionRef.get(printer.state);
						const interruptedPid: PidState | undefined =
							job.request.command.type === 'pidCalibrate' && snapshot.pid?.run?.id === job.action.id
								? {
										...snapshot.pid,
										run: {
											...snapshot.pid.run,
											stage: 'interrupted',
											parameters: null,
											message: recoveryMessage
										}
									}
								: undefined;
						const persisted = yield* sql
							.withTransaction(
								Effect.gen(function* () {
									if (interruptedPid) yield* writePid(interruptedPid);
									yield* store.setStatus(job.action.id, 'unknown', recoveryMessage);
								})
							)
							.pipe(Effect.result);
						yield* update((s) => ({
							...s,
							pid: interruptedPid ?? s.pid,
							storage: persisted._tag === 'Failure' ? 'degraded' : s.storage,
							liveRecovery: {
								id: job.action.id,
								message: recoveryMessage,
								resumeFilename: resumeFilename(JSON.stringify(job.request.command))
							},
							actions: s.actions.map((a) =>
								a.id === job.action.id ? { ...a, status: 'unknown', message: recoveryMessage } : a
							)
						}));
					})
				),
				Effect.ensuring(
					Effect.sync(() => {
						work = undefined;
						working = false;
					})
				)
			);
		}).pipe(Effect.repeat(Schedule.spaced('100 millis')), Effect.forkScoped);
		return {
			submit: (request, actor) =>
				gate.withPermits(1)(
					Effect.gen(function* () {
						const existing = yield* store.find(request.id);
						if (!authorized(actor))
							return yield* Effect.fail(reject('An authorized operator is required.'));
						if (existing) {
							if (
								existing.actorId !== actor.id ||
								existing.payload !== JSON.stringify(request.command)
							)
								return yield* Effect.fail(
									reject('Action ID belongs to another command or account.')
								);
							return existing.action;
						}
						const s = yield* SubscriptionRef.get(printer.state);
						if (request.command.type === 'filamentChangeEnd' && actor.role === 'owner') {
							const c = request.command,
								session = s.filamentChange;
							if (
								!c.confirmed ||
								!session ||
								!filamentChangeActive(session) ||
								c.sessionId !== session.id ||
								c.expectedStep !== session.step
							)
								return yield* Effect.fail(
									reject('Review the current filament session and confirm ending guidance.')
								);
							if (
								work ||
								working ||
								swapCheckpoint ||
								s.storage !== 'healthy' ||
								s.actions.some((a) => ['queued', 'sending'].includes(a.status))
							)
								return yield* Effect.fail(
									reject('Wait for pending work and state persistence before ending guidance.')
								);
							const finished: FilamentChangeSession = {
								...session,
								step: session.step + 1,
								stage: 'finished',
								message:
									'Owner ended guidance. The printer was not stopped or resumed, and its position was not verified. Any safety or unknown-action recovery still needs review.'
							};
							const action: ActionRecord = {
								id: request.id,
								label: actionLabel(c),
								status: 'completed',
								createdAt: Date.now(),
								message: finished.message
							};
							yield* sql.withTransaction(
								Effect.gen(function* () {
									if (!authorized(actor))
										return yield* Effect.fail(reject('Owner authorization expired.'));
									yield* store.insert(action, c, actor.id);
									yield* writeSwap(finished);
								})
							);
							yield* update((current) => ({
								...current,
								filamentChange: finished,
								actions: [action, ...current.actions].slice(0, 20)
							}));
							return action;
						}
						yield* check(() => validate(s, request, actor));
						if (work || s.actions.some((a) => ['queued', 'sending'].includes(a.status)))
							return yield* Effect.fail(reject('Another action is pending.'));
						const telemetry = yield* SubscriptionRef.get(transport.state);
						const action: ActionRecord = {
							id: request.id,
							label: actionLabel(request.command),
							status: 'queued',
							createdAt: Date.now(),
							message: null
						};
						yield* sql.withTransaction(
							Effect.gen(function* () {
								yield* store.insert(action, request.command, actor.id);
								yield* sql`INSERT INTO live_action_reservation(target,action_id) VALUES(${target},${action.id})`;
							})
						);
						yield* update((s) => ({ ...s, actions: [action, ...s.actions].slice(0, 20) }));
						work = {
							request,
							actor,
							action,
							generation: telemetry.generation,
							epoch: interlock.epoch
						};
						return action;
					}).pipe(
						Effect.uninterruptible,
						Effect.mapError((cause) =>
							cause instanceof ActionRejected
								? cause
								: reject('Action storage failed. Nothing was dispatched.')
						)
					)
				),
			recover: (id, actor, pausedJob) =>
				gate.withPermits(1)(
					Effect.gen(function* () {
						if (actor.role !== 'owner' || !authorized(actor))
							return yield* Effect.fail(reject('An authorized owner must review recovery.'));
						const s = yield* SubscriptionRef.get(printer.state);
						if (interlock.halted || safetyReason(s.safety))
							return yield* Effect.fail(
								reject(safetyReason(s.safety) ?? 'Review the emergency stop interlock first.')
							);
						if (work || s.liveRecovery?.id !== id)
							return yield* Effect.fail(reject('The recovery state changed. Review it again.'));
						const telemetry = yield* SubscriptionRef.get(transport.state);
						const fresh = yield* transport.refresh(telemetry.generation);
						const original = yield* store.find(id);
						const pausedResumeReviewed = Boolean(
							pausedJob &&
							fresh.job.state === 'paused' &&
							resumeFilename(original?.payload) === fresh.job.filename &&
							pausedJob.filename === fresh.job.filename &&
							pausedJob.runId &&
							pausedJob.runId === fresh.job.runId
						);
						if (
							fresh.connection !== 'connected' ||
							fresh.klippy !== 'ready' ||
							!fresh.telemetryReady ||
							fresh.job.state === 'unknown' ||
							fresh.motion.busy !== false ||
							fresh.motion.calibration ||
							fresh.job.state === 'printing' ||
							(fresh.job.state === 'paused' && !pausedResumeReviewed)
						)
							return yield* Effect.fail(
								reject('Verify that the printer is stopped and idle before clearing recovery.')
							);
						if (!authorized(actor))
							return yield* Effect.fail(reject('Owner authorization expired.'));
						yield* sql.withTransaction(
							Effect.gen(function* () {
								yield* store.setStatus(
									id,
									'unknown',
									'Owner reviewed the printer and cleared the recovery lock. The previous action was not replayed.'
								);
								yield* sql`DELETE FROM live_action_reservation WHERE target=${target} AND action_id=${id}`;
							})
						);
						yield* update((s) => ({
							...s,
							liveRecovery: null,
							storage: 'healthy',
							actions: s.actions.map((a) =>
								a.id === id
									? {
											...a,
											status: 'unknown',
											message:
												'Owner reviewed the printer and cleared recovery. No command was replayed.'
										}
									: a
							)
						}));
					}).pipe(
						Effect.uninterruptible,
						Effect.mapError((cause) =>
							cause instanceof ActionRejected
								? cause
								: reject('Recovery could not be verified. No command was replayed.')
						)
					)
				)
		};
	})
);
