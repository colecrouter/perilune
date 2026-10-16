import { createHash, randomUUID } from 'node:crypto';
import { Context, Effect, Layer, Schedule, Semaphore, SubscriptionRef } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import type { SafetyAction, SafetyRequest } from '#lib/domain/safety.js';
import type { CalibrationActor } from '#lib/domain/calibration.js';
import { ActionRejected, PrinterService } from './printer-service.js';
import { MoonrakerConfig, MoonrakerService, type MoonrakerSnapshot } from './moonraker.js';
import { printerAdmission, printerInterlock } from './printer-admission.js';
export class SafetySettings extends Context.Service<
	SafetySettings,
	{ enabled: boolean; observationMs?: number; pollMs?: number }
>()('perilune/SafetySettings') {}
export class SafetyService extends Context.Service<
	SafetyService,
	{
		submit: (
			request: SafetyRequest,
			actor: CalibrationActor
		) => Effect.Effect<SafetyAction, ActionRejected>;
		receipt: (id: string, actor: CalibrationActor) => Effect.Effect<SafetyAction, ActionRejected>;
		review: (id: string, actor: CalibrationActor) => Effect.Effect<void, ActionRejected>;
	}
>()('perilune/SafetyService') {}
const rejected = (message: string) => new ActionRejected({ message });
export const SafetyDisabled = Layer.succeed(SafetyService, {
	receipt: () => Effect.fail(rejected('Safety receipt unavailable.')),
	submit: () => Effect.fail(rejected('Live safety actions are disabled.')),
	review: () => Effect.fail(rejected('No live safety outcome to review.'))
});
const authorized = (actor: CalibrationActor, owner = false) =>
	(owner ? actor.role === 'owner' : ['owner', 'operator'].includes(actor.role ?? '')) &&
	actor.authorized?.() === true;
const uncertain =
	'Outcome is unknown. Inspect the printer; this safety action will not be replayed.';
interface Row {
	id: string;
	target: string;
	actor: string;
	payload: string;
	record: string;
}
const label = (kind: SafetyAction['kind']) =>
	kind === 'abortProbe'
		? 'Abort current manual probe during recovery'
		: kind === 'emergency'
			? 'Emergency stop'
			: kind === 'stop'
				? 'Stop current job during recovery'
				: 'Turn off heaters during recovery';
export function observedHeatersOff(state: MoonrakerSnapshot): boolean {
	const targets: Array<number | null> = state.additionalTemperatures
		.filter((t) => t.heater)
		.map((t) => t.target);
	if (state.availableObjects.includes('heater_bed')) targets.push(state.heaters.bed.target);
	if (state.availableObjects.includes('extruder')) targets.push(state.heaters.nozzle.target);
	return targets.length > 0 && targets.every((t) => t === 0);
}
export const SafetyServiceLive = Layer.effect(
	SafetyService,
	Effect.gen(function* () {
		const printer = yield* PrinterService,
			transport = yield* MoonrakerService,
			config = yield* MoonrakerConfig,
			settings = yield* SafetySettings,
			sql = yield* SqlClient;
		const interlock = printerInterlock(printer.state),
			admission = printerAdmission(printer.state),
			emergencyGate = yield* Semaphore.make(1);
		const target = createHash('sha256').update(config.url).digest('hex');
		const base = new URL(config.url);
		base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:';
		base.pathname = '/';
		base.search = '';
		base.hash = '';
		const rows = () =>
			sql<Row>`SELECT * FROM safety_actions WHERE target=${target} AND ((json_extract(record,'$.status') IN ('queued','sending','unknown') AND json_extract(record,'$.reviewedAt') IS NULL) OR id IN (SELECT id FROM safety_actions WHERE target=${target} ORDER BY rowid DESC LIMIT 20)) ORDER BY rowid DESC`;
		const save = (record: SafetyAction) =>
			sql`UPDATE safety_actions SET record=${JSON.stringify(record)} WHERE target=${target} AND id=${record.id}`.pipe(
				Effect.asVoid
			);
		yield* sql`INSERT OR IGNORE INTO printer_safety_state(target,token,halted) VALUES(${target},${randomUUID()},0)`;
		const stored = yield* sql<{
			token: string;
			halted: number;
		}>`SELECT token,halted FROM printer_safety_state WHERE target=${target}`;
		if (stored[0].halted) interlock.interrupt();
		const history: SafetyAction[] = [];
		for (const row of yield* rows()) {
			let record = JSON.parse(row.record) as SafetyAction;
			if (['queued', 'sending'].includes(record.status)) {
				record = { ...record, status: 'unknown', message: 'Backend restarted. ' + uncertain };
				yield* save(record);
			}
			history.push(record);
		}
		const publish = (record?: SafetyAction) =>
			SubscriptionRef.update(printer.state, (s) => {
				const previous = s.safety?.actions ?? history;
				const all = record
					? [record, ...previous.filter((a) => a.id !== record.id)].sort(
							(a, b) => b.createdAt - a.createdAt
						)
					: previous;
				const unresolved = (a: SafetyAction) =>
					['queued', 'sending', 'unknown'].includes(a.status) && a.reviewedAt === null;
				const actions = [
					...all.filter(unresolved),
					...all.filter((a) => !unresolved(a)).slice(0, 20)
				].sort((a, b) => b.createdAt - a.createdAt);
				return {
					...s,
					safety: { enabled: settings.enabled, halted: interlock.halted, actions },
					revision: s.revision + 1,
					updatedAt: Date.now()
				};
			});
		yield* publish();
		type Work = {
			request: SafetyRequest;
			actor: CalibrationActor;
			record: SafetyAction;
			epoch: number;
			generation: number;
		};
		let ordinary: Work | undefined, emergency: Work | undefined;
		const failedAdmissions = new Map<
			string,
			{ actor: string; payload: string; record: SafetyAction }
		>();
		const request = (
			path:
				| '/printer/print/cancel'
				| '/printer/gcode/script'
				| '/printer/emergency_stop'
				| '/printer/info',
			method: 'POST' | 'GET',
			job: Work,
			body?: unknown
		) =>
			Effect.tryPromise({
				try: async (signal) => {
					if (method === 'POST') {
						if (job.request.operation.type !== 'emergency') {
							const latest = await Effect.runPromise(SubscriptionRef.get(transport.state));
							if (
								latest.generation !== job.generation ||
								latest.klippy !== 'ready' ||
								!latest.telemetryReady
							)
								throw rejected('Printer connection changed before safety dispatch.');
							if (
								job.request.operation.type === 'stop' &&
								(latest.job.filename !== job.request.operation.expectedJob.filename ||
									latest.job.runId !== job.request.operation.expectedJob.runId ||
									!['printing', 'paused'].includes(latest.job.state))
							)
								throw rejected('The current job changed before stopping.');
						}
						if (!authorized(job.actor, job.request.operation.type !== 'emergency'))
							throw rejected('Safety action authorization expired.');
						if (Date.now() - job.record.createdAt >= 30000)
							throw rejected('Safety action expired before dispatch.');
						if (
							interlock.epoch !== job.epoch ||
							(job.request.operation.type !== 'emergency' && interlock.halted)
						)
							throw rejected('A newer emergency stop interrupted this safety action.');
					}
					const headers = new Headers();
					if (config.apiKey) headers.set('X-Api-Key', config.apiKey);
					if (body) headers.set('Content-Type', 'application/json');
					const response = await fetch(new URL(path, base), {
						method,
						headers,
						...(method === 'POST' && body ? { body: JSON.stringify(body) } : {}),
						redirect: 'error',
						cache: 'no-store',
						signal: AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs ?? 10000)])
					});
					const reader = response.body?.getReader();
					let size = 0;
					const chunks: Uint8Array[] = [];
					try {
						if (reader)
							while (true) {
								const chunk = await reader.read();
								if (chunk.done) break;
								size += chunk.value.length;
								if (size > 65536)
									throw rejected('Printer response exceeded the safety diagnostic limit.');
								chunks.push(chunk.value);
							}
					} finally {
						await reader?.cancel().catch(() => {});
						reader?.releaseLock();
					}
					if (!response.ok)
						throw rejected(
							'The printer refused the safety request. Inspect its state before taking another action.'
						);
					return JSON.parse(Buffer.concat(chunks).toString('utf8')).result;
				},
				catch: (cause) =>
					cause instanceof ActionRejected
						? cause
						: rejected('The safety request or its acknowledgement was lost.')
			});
		const freshFor = (job: Work) =>
			Effect.gen(function* () {
				const fresh = yield* transport.refresh(job.generation);
				const snapshot = yield* SubscriptionRef.get(printer.state);
				if (!authorized(job.actor, true))
					return yield* Effect.fail(rejected('An authorized owner is required.'));
				if (job.request.operation.type === 'emergency') return fresh;
				if (snapshot.liveRecovery?.id !== job.request.operation.recoveryOf)
					return yield* Effect.fail(
						rejected('The original recovery changed. Review the current printer state.')
					);
				if (interlock.halted || interlock.epoch !== job.epoch)
					return yield* Effect.fail(rejected('Emergency stop interlock is active.'));
				if (fresh.connection !== 'connected' || fresh.klippy !== 'ready' || !fresh.telemetryReady)
					return yield* Effect.fail(
						rejected(
							'Fresh ready printer state is unavailable. Emergency stop remains independent.'
						)
					);
				if (
					job.request.operation.type === 'abortProbe' &&
					(!fresh.motion.calibration || !fresh.availableObjects.includes('manual_probe'))
				)
					return yield* Effect.fail(rejected('No current manual probe was observed.'));
				if (job.request.operation.type === 'stop') {
					const expected = job.request.operation.expectedJob;
					if (
						!['printing', 'paused'].includes(fresh.job.state) ||
						fresh.job.filename !== expected.filename ||
						fresh.job.runId !== expected.runId
					)
						return yield* Effect.fail(
							rejected('The active job changed. Review it before stopping.')
						);
				}
				return fresh;
			});
		const run = (job: Work) =>
			Effect.gen(function* () {
				let attempted = false;
				const result = yield* Effect.gen(function* () {
					if (
						!settings.enabled ||
						!authorized(job.actor, job.request.operation.type !== 'emergency')
					)
						return yield* Effect.fail(rejected('Safety action authorization expired.'));
					if (Date.now() - job.record.createdAt >= 30000)
						return yield* Effect.fail(rejected('Safety action expired before dispatch.'));
					if (job.request.operation.type !== 'emergency') yield* freshFor(job);
					job.record = {
						...job.record,
						status: 'sending',
						message: 'Sending once; waiting for acknowledgement and observed printer state.'
					};
					yield* save(job.record);
					yield* publish(job.record);
					// Recheck current transport identity after persistence, immediately before HTTP dispatch.
					if (job.request.operation.type !== 'emergency') yield* freshFor(job);
					if (
						!authorized(job.actor, job.request.operation.type !== 'emergency') ||
						interlock.epoch !== job.epoch ||
						Date.now() - job.record.createdAt >= 30000
					)
						return yield* Effect.fail(
							rejected('Safety action expired or was interrupted before dispatch.')
						);
					attempted = true;
					if (job.request.operation.type === 'emergency')
						yield* request('/printer/emergency_stop', 'POST', job);
					else if (job.request.operation.type === 'stop')
						yield* request('/printer/print/cancel', 'POST', job);
					else
						yield* request('/printer/gcode/script', 'POST', job, {
							script: job.request.operation.type === 'abortProbe' ? 'ABORT' : 'TURN_OFF_HEATERS'
						});
					job.record = {
						...job.record,
						acknowledged: true,
						message: 'Acknowledged. Verifying the observed result.'
					};
					yield* save(job.record);
					yield* publish(job.record);
					const deadline = Date.now() + (settings.observationMs ?? 10000);
					while (true) {
						if (interlock.epoch !== job.epoch)
							return yield* Effect.fail(
								rejected('A newer emergency stop interrupted verification.')
							);
						let matched = false;
						if (job.request.operation.type === 'emergency')
							matched = (yield* request('/printer/info', 'GET', job)).state === 'shutdown';
						else {
							const observed = yield* transport.refresh(job.generation);
							matched =
								job.request.operation.type === 'abortProbe'
									? observed.motion.calibration === false
									: job.request.operation.type === 'cooldown'
										? observedHeatersOff(observed)
										: ['cancelled', 'standby', 'complete'].includes(observed.job.state) &&
											observed.job.filename === job.request.operation.expectedJob.filename &&
											observed.job.runId === job.request.operation.expectedJob.runId;
						}
						if (matched) {
							job.record = { ...job.record, observed: true };
							return;
						}
						if (Date.now() >= deadline)
							return yield* Effect.fail(
								rejected('Acknowledged safety action could not be verified from printer state.')
							);
						yield* Effect.sleep(settings.pollMs ?? 250);
					}
				}).pipe(Effect.result);
				job.record = {
					...job.record,
					status: result._tag === 'Success' ? 'completed' : attempted ? 'unknown' : 'failed',
					message:
						result._tag === 'Success'
							? job.request.operation.type === 'emergency'
								? 'Klipper shutdown observed. Resolve the hazard, restart Klipper, then review safety.'
								: 'Result observed. The original unknown action remains locked until explicitly reviewed.'
							: attempted
								? uncertain
								: result.failure instanceof ActionRejected
									? result.failure.message
									: 'Safety action was not dispatched.'
				};
				const persisted = yield* save(job.record).pipe(Effect.result);
				if (persisted._tag === 'Failure')
					job.record = {
						...job.record,
						status: 'unknown',
						message: 'Safety outcome storage failed. ' + uncertain
					};
				yield* publish(job.record);
			});
		const worker = (lane: 'ordinary' | 'emergency') =>
			Effect.gen(function* () {
				const job = lane === 'emergency' ? emergency : ordinary;
				if (!job) return;
				yield* run(job).pipe(
					Effect.catchCause(() =>
						Effect.gen(function* () {
							job.record = { ...job.record, status: 'unknown', message: uncertain };
							yield* save(job.record).pipe(Effect.ignore);
							yield* publish(job.record);
						})
					),
					Effect.ensuring(
						Effect.sync(() => {
							if (lane === 'emergency') emergency = undefined;
							else ordinary = undefined;
						})
					)
				);
			}).pipe(Effect.repeat(Schedule.spaced('20 millis')), Effect.forkScoped);
		yield* worker('ordinary');
		yield* worker('emergency');
		const admit = (request: SafetyRequest, actor: CalibrationActor) =>
			Effect.gen(function* () {
				if (!settings.enabled || !authorized(actor, request.operation.type !== 'emergency'))
					return yield* Effect.fail(
						rejected(
							'An authorized ' +
								(request.operation.type === 'emergency' ? 'operator' : 'owner') +
								' is required for this safety action.'
						)
					);
				const payload = JSON.stringify(request),
					failed = failedAdmissions.get(request.id);
				if (failed) {
					if (failed.actor !== actor.id || failed.payload !== payload)
						return yield* Effect.fail(
							rejected('Safety action ID belongs to another request or account.')
						);
					return failed.record;
				}
				const duplicates = yield* sql<Row>`SELECT * FROM safety_actions WHERE id=${request.id}`;
				const duplicate = duplicates[0];
				if (duplicate) {
					if (
						duplicate.target !== target ||
						duplicate.actor !== actor.id ||
						duplicate.payload !== payload
					)
						return yield* Effect.fail(
							rejected('Safety action ID belongs to another request or account.')
						);
					return JSON.parse(duplicate.record) as SafetyAction;
				}
				const isEmergency = request.operation.type === 'emergency';
				if (isEmergency ? Boolean(emergency) : Boolean(ordinary))
					return yield* Effect.fail(
						rejected(
							'Another ' +
								(isEmergency ? 'emergency stop' : 'recovery safety action') +
								' is pending.'
						)
					);
				const snapshot = yield* SubscriptionRef.get(printer.state);
				if (!isEmergency) {
					if (
						interlock.halted ||
						snapshot.liveRecovery?.id !==
							(request.operation as Exclude<SafetyRequest['operation'], { type: 'emergency' }>)
								.recoveryOf
					)
						return yield* Effect.fail(
							rejected('Review the current recovery state before submitting.')
						);
					if (snapshot.actions.some((a) => ['queued', 'sending'].includes(a.status)))
						return yield* Effect.fail(
							rejected('Wait for the ordinary action to settle, or use emergency stop.')
						);
				}
				const telemetry = yield* SubscriptionRef.get(transport.state);
				const record: SafetyAction = {
					id: request.id,
					kind: request.operation.type,
					label: label(request.operation.type),
					status: 'queued',
					createdAt: Date.now(),
					message: null,
					acknowledged: false,
					observed: false,
					reviewedAt: null
				};
				const epoch = isEmergency ? interlock.interrupt() : interlock.epoch;
				if (isEmergency) yield* publish();
				const persisted = yield* sql
					.withTransaction(
						Effect.gen(function* () {
							yield* sql`INSERT INTO safety_actions(id,target,actor,payload,record) VALUES(${request.id},${target},${actor.id},${payload},${JSON.stringify(record)})`;
							if (isEmergency)
								yield* sql`UPDATE printer_safety_state SET token=${request.id},halted=1 WHERE target=${target}`;
						})
					)
					.pipe(Effect.result);
				if (persisted._tag === 'Failure') {
					const failure = {
						...record,
						status: 'failed' as const,
						message:
							'Safety request could not be recorded; nothing was dispatched. Use the physical stop if needed.'
					};
					if (failedAdmissions.size < 32)
						failedAdmissions.set(request.id, { actor: actor.id, payload, record: failure });
					yield* publish(failure);
					return failure;
				}
				yield* publish(record);
				const job = { request, actor, record, epoch, generation: telemetry.generation };
				if (isEmergency) emergency = job;
				else ordinary = job;
				return record;
			});
		return {
			submit: (request, actor) =>
				(request.operation.type === 'emergency' ? emergencyGate : admission).withPermits(1)(
					admit(request, actor).pipe(
						Effect.uninterruptible,
						Effect.mapError((cause) =>
							cause instanceof ActionRejected
								? cause
								: rejected('Safety admission failed. Nothing was dispatched.')
						)
					)
				),
			receipt: (id, actor) =>
				Effect.gen(function* () {
					if (!authorized(actor)) return yield* Effect.fail(rejected('Authorization expired.'));
					const found =
						yield* sql<Row>`SELECT * FROM safety_actions WHERE id=${id} AND target=${target}`;
					const row = found[0];
					if (!row || (row.actor !== actor.id && actor.role !== 'owner'))
						return yield* Effect.fail(rejected('Safety receipt unavailable.'));
					return JSON.parse(row.record) as SafetyAction;
				}).pipe(
					Effect.mapError((cause) =>
						cause instanceof ActionRejected ? cause : rejected('Safety receipt unavailable.')
					)
				),

			review: (id, actor) =>
				admission.withPermits(1)(
					Effect.gen(function* () {
						if (!authorized(actor, true))
							return yield* Effect.fail(rejected('An authorized owner must review safety.'));
						if (ordinary || emergency)
							return yield* Effect.fail(rejected('Wait for the safety action to settle.'));
						const epoch = interlock.epoch;
						const latch = (yield* sql<{
							token: string;
						}>`SELECT token FROM printer_safety_state WHERE target=${target}`)[0];
						const snapshot = yield* SubscriptionRef.get(printer.state);
						if (snapshot.safety?.actions[0]?.id !== id)
							return yield* Effect.fail(
								rejected('Safety state changed. Review the latest outcome.')
							);
						const initial = yield* SubscriptionRef.get(transport.state),
							fresh = yield* transport.refresh(initial.generation);
						if (
							fresh.connection !== 'connected' ||
							fresh.klippy !== 'ready' ||
							!fresh.telemetryReady ||
							fresh.motion.busy !== false ||
							fresh.motion.calibration ||
							!['standby', 'complete', 'cancelled', 'error'].includes(fresh.job.state) ||
							!observedHeatersOff(fresh)
						)
							return yield* Effect.fail(
								rejected(
									'Safety review needs a ready, idle printer with heater targets off. After emergency stop, restart Klipper only once the hazard is resolved.'
								)
							);
						if (!authorized(actor, true) || interlock.epoch !== epoch || ordinary || emergency)
							return yield* Effect.fail(
								rejected('Safety state or authorization changed during review.')
							);
						const reviewedAt = Date.now();
						yield* sql.withTransaction(
							Effect.gen(function* () {
								for (const action of snapshot.safety?.actions ?? [])
									if (action.status === 'unknown' && action.reviewedAt === null)
										yield* save({ ...action, reviewedAt });
								yield* sql`UPDATE printer_safety_state SET halted=0 WHERE target=${target} AND token=${latch.token}`;
							})
						);
						interlock.clear(epoch);
						yield* SubscriptionRef.update(printer.state, (s) => ({
							...s,
							safety: s.safety
								? {
										...s.safety,
										halted: interlock.halted,
										actions: s.safety.actions.map((a) =>
											snapshot.safety?.actions.some((old) => old.id === a.id) &&
											a.status === 'unknown'
												? { ...a, reviewedAt }
												: a
										)
									}
								: undefined,
							revision: s.revision + 1,
							updatedAt: Date.now()
						}));
					}).pipe(
						Effect.uninterruptible,
						Effect.mapError((cause) =>
							cause instanceof ActionRejected
								? cause
								: rejected('Safety review could not be persisted. No physical action was repeated.')
						)
					)
				)
		};
	})
);
