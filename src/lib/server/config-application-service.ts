import { filamentChangeActive } from '#lib/domain/filament-change.js';
import {
	pendingManifest,
	pendingFingerprint,
	pendingConfigurationText
} from './pending-configuration.js';
import { liveZActive } from '#lib/domain/live-z.js';
import { safetyReason } from '#lib/domain/safety.js';
import { printerAdmission, printerInterlock } from './printer-admission.js';
import { extrusionActive } from '#lib/domain/extrusion.js';
import { calibrationActive } from '#lib/domain/calibration.js';
import { meshProbeActive } from '#lib/domain/mesh-probe.js';
import { createHash } from 'node:crypto';
import { Context, Effect, Layer, Schedule, SubscriptionRef } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import {
	ConfigurationError,
	ConfigurationService,
	ConfigurationSettings,
	type ConfigActor
} from './config-service.js';
import { PrinterService } from './printer-service.js';
import { migrate } from './migrations.js';
import { checkConfigChange, validConfigPath } from '#lib/domain/configuration.js';
import type {
	ApplyConfiguration,
	SavePendingConfiguration,
	PendingConfigurationReview,
	ConfigApplication,
	ConfigRecovery
} from '#lib/domain/config-application.js';
export class ConfigurationApplicationSettings extends Context.Service<
	ConfigurationApplicationSettings,
	{ enabled: boolean; discardEnabled?: boolean; verifyMs?: number; pollMs?: number }
>()('perilune/ConfigurationApplicationSettings') {}
export class ConfigurationApplicationService extends Context.Service<
	ConfigurationApplicationService,
	{
		reviewPending: (
			actor: ConfigActor
		) => Effect.Effect<PendingConfigurationReview, ConfigurationError>;
		status: (actor: ConfigActor) => Effect.Effect<ConfigRecovery, ConfigurationError>;
		submit: (
			request:
				| ApplyConfiguration
				| SavePendingConfiguration
				| { id: string; revertOf: string; confirmedRestart: true },
			actor: ConfigActor
		) => Effect.Effect<ConfigApplication, ConfigurationError>;
		snapshot: (
			id: string,
			side: 'before' | 'after',
			actor: ConfigActor
		) => Effect.Effect<string, ConfigurationError>;
		check: (id: string, actor: ConfigActor) => Effect.Effect<ConfigApplication, ConfigurationError>;
	}
>()('perilune/ConfigurationApplicationService') {}
interface Row {
	id: string;
	actor_id: string;
	fingerprint: string;
	record: string;
	before_text: string;
	after_text: string;
	expires_at: number;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const failure = (message: string) => new ConfigurationError({ message });
const authorize = (actor: ConfigActor) => {
	if (!actor.authorized()) throw failure('An authorized owner account is required.');
};
const pending = (record: ConfigApplication) =>
	['queued', 'writing', 'restarting'].includes(record.phase);
const pendingCleared = (config: {
	save_config_pending?: unknown;
	save_config_pending_items?: unknown;
}) =>
	config.save_config_pending === false &&
	config.save_config_pending_items !== null &&
	typeof config.save_config_pending_items === 'object' &&
	!Array.isArray(config.save_config_pending_items) &&
	Object.keys(config.save_config_pending_items).length === 0;
const convert = (cause: unknown) =>
	cause instanceof ConfigurationError
		? cause
		: failure(
				'Configuration recovery storage or connection failed. Keep your draft; check the recorded outcome before retrying.'
			);
export const ConfigurationApplicationServiceLive = Layer.effect(
	ConfigurationApplicationService,
	Effect.gen(function* () {
		const sql = yield* SqlClient,
			files = yield* ConfigurationService,
			settings = yield* ConfigurationSettings,
			options = yield* ConfigurationApplicationSettings,
			printer = yield* PrinterService;
		yield* migrate;
		const gate = printerAdmission(printer.state);
		const interlock = printerInterlock(printer.state);
		const enabled = options.enabled && Boolean(settings.moonrakerUrl);
		const discardEnabled =
			(options.discardEnabled ?? options.enabled) && Boolean(settings.moonrakerUrl);
		const base = settings.moonrakerUrl ? new URL(settings.moonrakerUrl) : null;
		if (base) {
			base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:';
			base.pathname = '/';
			base.search = '';
			base.hash = '';
		}
		const readRows = () =>
			Effect.runPromise(sql<Row>`SELECT * FROM config_applications ORDER BY rowid DESC LIMIT 20`);
		const write = (record: ConfigApplication) =>
			Effect.runPromise(
				sql`UPDATE config_applications SET record=${JSON.stringify(record)} WHERE id=${record.id}`
			);
		const busy = (value: boolean) =>
			Effect.runPromise(
				SubscriptionRef.update(printer.state, (s) => ({
					...s,
					configurationBusy: value,
					revision: s.revision + 1,
					updatedAt: Date.now()
				}))
			);
		const call = async (
			path: string,
			signal: AbortSignal,
			init?: RequestInit,
			permit?: () => boolean
		) => {
			if (!base) throw failure('No live printer is configured.');
			const headers = new Headers(init?.headers);
			if (settings.apiKey) headers.set('X-Api-Key', settings.apiKey);
			if (init?.method && init.method !== 'GET' && !permit?.())
				throw failure('Safety interruption prevented this configuration write or restart.');
			const response = await fetch(new URL(path, base), {
				...init,
				redirect: 'error',
				cache: 'no-store',
				headers,
				signal: AbortSignal.any([signal, AbortSignal.timeout(settings.requestTimeoutMs ?? 10000)])
			});
			const reader = response.body?.getReader();
			let size = 0;
			const chunks: Uint8Array[] = [];
			try {
				if (reader)
					while (true) {
						const part = await reader.read();
						if (part.done) break;
						size += part.value.length;
						if (size > 64 * 1024)
							throw failure('Printer response exceeds the recovery diagnostic limit.');
						chunks.push(part.value);
					}
			} finally {
				await reader?.cancel().catch(() => {});
				reader?.releaseLock();
			}
			if (!response.ok)
				throw failure(
					'Moonraker refused the configuration operation. Check the recorded outcome before retrying.'
				);
			return JSON.parse(Buffer.concat(chunks).toString('utf8')).result;
		};
		const info = (signal: AbortSignal) =>
			call('/printer/info', signal) as Promise<{ state: string; state_message: string }>;
		const idle = async (signal: AbortSignal, reverting: boolean, allowPending = false) => {
			const state = await info(signal);
			if (state.state !== 'ready') {
				if (reverting && ['error', 'shutdown'].includes(state.state)) return null;
				throw failure('Wait for a ready, idle printer before applying a configuration.');
			}
			const result = await call(
				'/printer/objects/query?print_stats&idle_timeout&configfile&heaters&manual_probe',
				signal
			);
			const inventory = result?.status?.heaters?.available_heaters;
			if (
				!Array.isArray(inventory) ||
				inventory.length > 64 ||
				inventory.some(
					(name: unknown) => typeof name !== 'string' || !/^[a-zA-Z0-9_ ]+$/.test(name)
				) ||
				result?.status?.manual_probe?.is_active !== false
			)
				throw failure(
					'Cannot verify all heaters and manual-probe activity. No configuration operation was sent.'
				);
			const heaters = inventory.length
				? await call(
						'/printer/objects/query?' +
							inventory.map((name: string) => encodeURIComponent(name)).join('&'),
						signal
					)
				: { status: {} };
			if (inventory.some((name: string) => heaters?.status?.[name]?.target !== 0))
				throw failure('Turn off all configured heaters before changing configuration.');
			if (
				!['standby', 'complete', 'cancelled', 'error'].includes(
					result?.status?.print_stats?.state
				) ||
				!['Ready', 'Idle'].includes(result?.status?.idle_timeout?.state)
			)
				throw failure('Stop printing, motion, and heating activity before changing configuration.');
			if (result?.status?.configfile?.save_config_pending && !allowPending)
				throw failure(
					'Klipper has pending SAVE_CONFIG changes. Resolve or export them before restarting.'
				);
			return result.status.configfile ?? {};
		};
		const target = hash(settings.moonrakerUrl);
		const recordOf = (row: Row) =>
			JSON.parse(row.record) as ConfigApplication & {
				target?: string;
				sources?: ApplyConfiguration['sources'];
				pending?: string;
			};
		const matchesTarget = (row: Row) => recordOf(row).target === target;
		const starting = yield* Effect.tryPromise({ try: readRows, catch: convert });
		for (const row of starting) {
			const record = recordOf(row);
			if (pending(record)) {
				record.phase = 'unknown';
				record.message =
					'Perilune restarted during this operation. No upload or restart was replayed. Check the saved bytes and printer state before recovery.';
				record.updatedAt = Date.now();
				yield* Effect.tryPromise({ try: () => write(record), catch: convert });
			}
		}
		if (
			starting[0] &&
			matchesTarget(starting[0]) &&
			(pending(recordOf(starting[0])) || recordOf(starting[0]).phase === 'unknown')
		)
			yield* Effect.tryPromise({ try: () => busy(true), catch: convert });
		let work: { row: Row; actor: ConfigActor; epoch: number } | null = null;
		const execute = (job: NonNullable<typeof work>, signal: AbortSignal) =>
			(async () => {
				const record = recordOf(job.row);
				let attempted = false;
				const update = async (phase: ConfigApplication['phase'], message: string) => {
					record.phase = phase;
					record.message = message;
					record.updatedAt = Date.now();
					await write(record);
				};
				try {
					authorize(job.actor);
					if (Date.now() >= job.row.expires_at)
						throw failure('This operation expired before dispatch. Review a fresh request.');
					const freshPending = await idle(
						signal,
						record.mode === 'revert',
						record.mode === 'calibration' || record.mode === 'discard'
					);
					if (
						(record.mode === 'calibration' || record.mode === 'discard') &&
						pendingFingerprint(pendingManifest(freshPending?.save_config_pending_items)) !==
							record.pending
					)
						throw failure('Pending calibration settings changed after review. No save was sent.');
					if (record.sources) {
						const sources = await Effect.runPromise(
							files.sources(
								record.mode === 'calibration' || record.mode === 'discard'
									? '@main'
									: record.sources.root,
								job.actor
							),
							{
								signal
							}
						);
						if (
							sources.root !== record.sources.root ||
							sources.fingerprint !== record.sources.fingerprint
						)
							throw failure(
								'Included configuration sources changed after review. No upload was sent.'
							);
					}
					const current = await Effect.runPromise(files.read(record.path, job.actor));
					if (current.text !== job.row.before_text)
						throw failure(
							'The saved file changed after review. No upload was sent; compare the current file before trying again.'
						);
					await update(
						'writing',
						record.mode === 'discard'
							? 'Snapshot stored. Saved configuration will not be written.'
							: 'Snapshot stored. Uploading the reviewed file; an acknowledgement loss will not trigger a retry.'
					);
					authorize(job.actor);
					if (record.mode === 'discard') {
						await update(
							'restarting',
							'Discarding reviewed pending settings with one Klipper restart. Saved configuration is unchanged.'
						);
						const latest = await idle(signal, false, true);
						if (
							Date.now() >= job.row.expires_at ||
							pendingFingerprint(pendingManifest(latest?.save_config_pending_items)) !==
								record.pending
						)
							throw failure('Pending settings changed or the review expired. No restart was sent.');
						authorize(job.actor);
						attempted = true;
						await call(
							'/printer/restart',
							signal,
							{ method: 'POST' },
							() => interlock.allows(job.epoch) && job.actor.authorized()
						);
					} else if (record.mode === 'calibration') {
						await update(
							'restarting',
							'Reviewed pending settings snapshotted. Requesting SAVE_CONFIG once and verifying saved bytes and fresh startup.'
						);
						const latest = await idle(signal, false, true);
						if (
							Date.now() >= job.row.expires_at ||
							pendingFingerprint(pendingManifest(latest?.save_config_pending_items)) !==
								record.pending
						)
							throw failure(
								'Pending settings changed or the review expired before dispatch. No save was sent.'
							);
						attempted = true;
						await call(
							'/printer/gcode/script',
							signal,
							{
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ script: 'SAVE_CONFIG' })
							},
							() => interlock.allows(job.epoch) && job.actor.authorized()
						);
					} else {
						const form = new FormData();
						form.set('root', 'config');
						const parts = record.path.split('/');
						const name = parts.pop()!;
						if (parts.length) form.set('path', parts.join('/'));
						form.set('file', new Blob([job.row.after_text], { type: 'text/plain' }), name);
						if (job.row.before_text !== job.row.after_text) {
							attempted = true;
							await call(
								'/server/files/upload',
								signal,
								{ method: 'POST', body: form },
								() => interlock.allows(job.epoch) && job.actor.authorized()
							);
						}
						const saved = await Effect.runPromise(files.read(record.path, job.actor));
						if (saved.text !== job.row.after_text)
							throw failure('Uploaded bytes could not be verified. No restart was sent.');
						record.writeVerified = true;
						await update(
							'restarting',
							'File bytes verified. Requesting Klipper restart and waiting for a fresh startup.'
						);
						authorize(job.actor);
						await idle(signal, record.mode === 'revert');
						attempted = true;
						await call(
							'/printer/restart',
							signal,
							{ method: 'POST' },
							() => interlock.allows(job.epoch) && job.actor.authorized()
						);
					}
					let transitioned = false;
					const deadline = Date.now() + (options.verifyMs ?? 45000);
					while (Date.now() < deadline && !signal.aborted) {
						try {
							const server = await call('/server/info', signal);
							if (['startup', 'disconnected'].includes(server?.klippy_state)) transitioned = true;
							const state = await info(signal);
							if (
								['error', 'shutdown'].includes(state.state) &&
								['error', 'shutdown'].includes(server?.klippy_state) &&
								(transitioned || record.mode !== 'revert')
							) {
								record.diagnostic = String(
									state.state_message ?? 'Klipper reported a startup error.'
								).slice(0, 32768);
								await update(
									'error',
									record.mode === 'discard'
										? 'Klipper reported a startup error after discarding. The saved file was not changed; inspect the diagnostic.'
										: 'File saved, but Klipper reported an error. Review the diagnostic or restore the previous file.'
								);
								await busy(false);
								return;
							}
							if (state.state === 'startup') transitioned = true;
							if (state.state === 'ready' && server?.klippy_state === 'ready' && transitioned) {
								const current = await Effect.runPromise(files.read(record.path, job.actor));
								if (current.text !== job.row.after_text)
									throw failure(
										'The file changed during restart. Startup cannot verify this operation.'
									);
								if (record.mode === 'discard') {
									const cleared = await idle(signal, false, true);
									if (!pendingCleared(cleared))
										throw failure('Pending settings remain after restart.');
								}
								record.writeVerified = record.mode !== 'discard';
								await update(
									'ready',
									record.mode === 'discard'
										? 'Pending settings discarded; saved configuration unchanged and fresh Klipper startup verified.'
										: record.mode === 'revert'
											? 'Previous file restored and fresh Klipper startup verified.'
											: 'Reviewed file saved and fresh Klipper startup verified.'
								);
								await busy(false);
								return;
							}
						} catch {
							/* Transport failure does not prove a fresh startup. */
						}
						await new Promise<void>((resolve) => {
							const timer = setTimeout(done, options.pollMs ?? 500);
							function done() {
								clearTimeout(timer);
								signal.removeEventListener('abort', done);
								resolve();
							}
							signal.addEventListener('abort', done, { once: true });
							if (signal.aborted) done();
						});
					}
					throw failure(
						'The restart outcome could not be verified. The operation will not be replayed. Check printer state and saved bytes before recovery.'
					);
				} catch (cause) {
					await update(
						attempted ? 'unknown' : 'error',
						cause instanceof Error
							? cause.message
							: 'Configuration operation failed. Check its recorded outcome.'
					);
					if (!attempted) await busy(false);
				}
			})();
		yield* Effect.tryPromise({
			try: async (signal) => {
				const job = work;
				if (!job) return;
				work = null;
				await execute(job, signal);
			},
			catch: convert
		}).pipe(
			Effect.catch(() => Effect.void),
			Effect.repeat(Schedule.spaced('100 millis')),
			Effect.forkScoped
		);
		return {
			reviewPending: (actor) =>
				Effect.tryPromise({
					try: async (signal) => {
						authorize(actor);
						if (!base) throw failure('No live printer is configured.');
						const config = await idle(signal, false, true);
						const manifest = pendingManifest(config?.save_config_pending_items);
						const sources = await Effect.runPromise(files.sources('@main', actor), { signal });
						const current = await Effect.runPromise(files.read(sources.root, actor), { signal });
						if (enabled) pendingConfigurationText(current.text, sources, manifest);
						authorize(actor);
						return {
							path: sources.root,
							manifest,
							fingerprint: pendingFingerprint(manifest),
							sources: { root: sources.root, fingerprint: sources.fingerprint }
						};
					},
					catch: convert
				}),
			status: (actor) =>
				Effect.tryPromise({
					try: async () => {
						authorize(actor);
						const rows = await readRows();
						authorize(actor);
						return { enabled, discardEnabled, application: rows[0] ? recordOf(rows[0]) : null };
					},
					catch: convert
				}),
			submit: (request, actor) =>
				gate.withPermits(1)(
					Effect.tryPromise({
						try: async (signal) => {
							authorize(actor);
							if ('discard' in request && request.discard ? !discardEnabled : !enabled)
								throw failure('This configuration operation is disabled on this server.');
							if (!/^[a-f0-9-]{36}$/i.test(request.id) || request.confirmedRestart !== true)
								throw failure('Supply a unique operation ID and explicitly confirm restart.');
							const fingerprint = hash(JSON.stringify(request));
							const rows = await readRows();
							const duplicate = rows.find((row) => row.id === request.id);
							if (duplicate) {
								if (!matchesTarget(duplicate))
									throw failure(
										'This operation belongs to another printer connection. Export its snapshots for manual review.'
									);
								if (duplicate.actor_id !== actor.id || duplicate.fingerprint !== fingerprint)
									throw failure('This operation ID belongs to another request.');
								return recordOf(duplicate);
							}
							if (work || rows.some((row) => matchesTarget(row) && pending(recordOf(row))))
								throw failure(
									'Another configuration operation is pending. There is no waiting queue.'
								);
							if (rows[0] && matchesTarget(rows[0]) && recordOf(rows[0]).phase === 'unknown')
								throw failure('Check the unknown outcome before submitting another operation.');
							let path: string,
								before: string,
								after: string,
								revertOf: string | null = null,
								calibrationRun: string | undefined;
							if ('revertOf' in request) {
								const original = rows.find((row) => row.id === request.revertOf);
								if (
									!original ||
									!matchesTarget(original) ||
									rows[0]?.id !== original.id ||
									(!recordOf(original).writeVerified && recordOf(original).mode !== 'revert') ||
									(recordOf(original).mode === 'revert' && recordOf(original).phase === 'ready')
								)
									throw failure(
										'Only the latest verified write can be reverted. Check its outcome first.'
									);
								path = recordOf(original).path;
								before = original.after_text;
								after = original.before_text;
								if (recordOf(original).mode === 'revert') {
									const current = await Effect.runPromise(files.read(path, actor));
									if (![original.before_text, original.after_text].includes(current.text))
										throw failure(
											'External edits prevent a safe restore retry. Export snapshots and compare manually.'
										);
									before = current.text;
									after = original.after_text;
								}
								revertOf = original.id;
								calibrationRun = recordOf(original).calibrationRun;
							} else if ('pending' in request) {
								const config = await idle(signal, false, true);
								const manifest = pendingManifest(config?.save_config_pending_items);
								if (pendingFingerprint(manifest) !== request.pending)
									throw failure('Pending settings changed. Review them again.');
								const sources = await Effect.runPromise(files.sources('@main', actor), { signal });
								if (
									sources.root !== request.sources?.root ||
									sources.fingerprint !== request.sources.fingerprint
								)
									throw failure('Configuration sources changed. Review pending settings again.');
								path = sources.root;
								const current = await Effect.runPromise(files.read(path, actor), { signal });
								before = current.text;
								after = request.discard
									? before
									: pendingConfigurationText(before, sources, manifest);
								const session = (await Effect.runPromise(SubscriptionRef.get(printer.state))).liveZ
									?.session;
								if (session?.stage === 'staged' && session.setting && session.candidate !== null) {
									const separator = session.setting.lastIndexOf('.');
									const value =
										manifest[session.setting.slice(0, separator)]?.[
											session.setting.slice(separator + 1)
										];
									if (value !== undefined && Number(value) === session.candidate)
										calibrationRun = session.id;
								}
							} else {
								path = request.path;
								if (
									typeof path !== 'string' ||
									!validConfigPath(path) ||
									!/\.(cfg|conf|ini)$/i.test(path)
								)
									throw failure('Choose an existing Klipper configuration file.');
								const current = await Effect.runPromise(files.read(path, actor));
								if (current.version !== request.expectedVersion)
									throw failure(
										'The saved file changed. Review the current source before applying.'
									);
								checkConfigChange(current.text, request.text);
								before = current.text;
								after = request.text;
								if (before === after) throw failure('There are no changes to apply.');
							}
							const failedStartup =
								(await idle(signal, Boolean(revertOf), 'pending' in request)) === null;
							const reserved = await Effect.runPromise(
								SubscriptionRef.modify(printer.state, (state) => {
									const blocked =
										interlock.halted ||
										Boolean(safetyReason(state.safety)) ||
										state.configurationBusy ||
										state.liveRecovery != null ||
										liveZActive(state.liveZ) ||
										(!failedStartup && state.motion.calibration) ||
										extrusionActive(state.extrusion) ||
										filamentChangeActive(state.filamentChange) ||
										calibrationActive(state.calibration) ||
										meshProbeActive(state.meshProbe) ||
										(!failedStartup && state.motion.busy === true) ||
										(!failedStartup && ['printing', 'paused'].includes(state.job.state)) ||
										state.actions.some((action) => ['queued', 'sending'].includes(action.status)) ||
										(state.meshProbe.session &&
											['preparing', 'probing', 'review', 'saving', 'uncertain'].includes(
												state.meshProbe.session.stage
											));
									return blocked
										? [false, state]
										: [
												true,
												{
													...state,
													configurationBusy: true,
													revision: state.revision + 1,
													updatedAt: Date.now()
												}
											];
								})
							);
							if (!reserved)
								throw failure(
									'Printer activity or configuration recovery is pending. Wait before applying.'
								);
							const record: ConfigApplication & {
								target: string;
								sources?: ApplyConfiguration['sources'];
								pending?: string;
							} = {
								target,
								sources: 'sources' in request ? request.sources : undefined,
								id: request.id,
								path,
								mode: revertOf
									? 'revert'
									: 'pending' in request
										? request.discard
											? 'discard'
											: 'calibration'
										: 'apply',
								pending: 'pending' in request ? request.pending : undefined,
								phase: 'queued',
								message: 'Reviewed operation admitted. Snapshot stored before any printer write.',
								diagnostic: null,
								createdAt: Date.now(),
								updatedAt: Date.now(),
								writeVerified: false,
								revertOf,
								calibrationRun
							};
							const row: Row = {
								id: request.id,
								actor_id: actor.id,
								fingerprint,
								record: JSON.stringify(record),
								before_text: before,
								after_text: after,
								expires_at: Date.now() + 30000
							};
							try {
								authorize(actor);
								await Effect.runPromise(
									sql.withTransaction(
										Effect.gen(function* () {
											yield* sql`INSERT INTO config_applications(id,actor_id,fingerprint,record,before_text,after_text,expires_at) VALUES(${row.id},${row.actor_id},${row.fingerprint},${row.record},${before},${after},${row.expires_at})`;
											yield* sql`DELETE FROM config_applications WHERE id NOT IN (SELECT id FROM config_applications ORDER BY rowid DESC LIMIT 20)`;
										})
									)
								);
								work = { row, actor, epoch: interlock.epoch };
							} catch (cause) {
								await busy(false);
								throw cause;
							}
							return record;
						},
						catch: convert
					}).pipe(Effect.uninterruptible)
				),

			snapshot: (id, side, actor) =>
				Effect.tryPromise({
					try: async () => {
						authorize(actor);
						const row = (await readRows()).find((r) => r.id === id);
						if (!row) throw failure('Snapshot is no longer available.');
						authorize(actor);
						return side === 'before' ? row.before_text : row.after_text;
					},
					catch: convert
				}),
			check: (id, actor) =>
				gate.withPermits(1)(
					Effect.tryPromise({
						try: async (signal) => {
							authorize(actor);
							const rows = await readRows(),
								row = rows[0];
							if (!row || row.id !== id || !matchesTarget(row))
								throw failure('Choose the latest recovery operation.');
							const record = recordOf(row);
							if (pending(record) || work)
								throw failure('Wait for the active operation to finish.');
							const current = await Effect.runPromise(files.read(record.path, actor));
							const state = await info(signal);
							authorize(actor);
							record.diagnostic = ['error', 'shutdown'].includes(state.state)
								? String(state.state_message ?? '').slice(0, 32768)
								: record.diagnostic;
							if (record.mode === 'discard' && current.text === row.before_text) {
								const latest = await idle(signal, false, true);
								record.phase = pendingCleared(latest) ? 'ready' : 'unknown';
								record.writeVerified = false;
								record.message = pendingCleared(latest)
									? 'No pending settings remain and the saved file is unchanged. No restart was replayed.'
									: 'Pending settings are not verified clear. No restart was replayed; inspect the printer before continuing.';
							} else if (current.text === row.after_text) {
								record.writeVerified = true;
								record.phase = 'error';
								record.message =
									'Saved bytes match this operation. A fresh successful restart has not been verified. You can restore the previous file.';
							} else if (current.text === row.before_text) {
								record.phase = 'error';
								record.message =
									'The previous file is currently on disk. No command was replayed. Review printer state before continuing.';
							} else {
								record.phase = 'unknown';
								record.message =
									'The file differs from both snapshots. Recovery will not overwrite external edits. Export the snapshots and compare manually.';
							}
							record.updatedAt = Date.now();
							await write(record);
							await busy(record.phase === 'unknown');
							return record;
						},
						catch: convert
					})
				)
		};
	})
);
