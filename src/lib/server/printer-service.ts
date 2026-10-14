import {
	calibrationActive,
	calibrationReason,
	interruptCalibration,
	restartCalibration,
	type CalibrationActor
} from '#lib/domain/calibration.js';
import {
	appendTemperatureSample,
	temperatureReason,
	type TemperatureSample
} from '#lib/domain/temperature.js';
import { Context, Data, Effect, Layer, Schedule, Semaphore, Stream, SubscriptionRef } from 'effect';
import {
	CommandRejected,
	actionLabel,
	applyCommand,
	initialSnapshot,
	initialLiveSnapshot,
	type ActionRecord,
	type ActionRequest,
	type ActionStatus,
	type PrinterSnapshot
} from '#lib/domain/printer.js';
import { startReason } from '#lib/domain/jobs.js';
import { motionReason } from '#lib/domain/motion.js';
import { ActionStore } from './action-store.js';

export class ActionRejected extends Data.TaggedError('ActionRejected')<{
	message: string;
	cause?: unknown;
}> {}
export class PrinterService extends Context.Service<
	PrinterService,
	{
		state: SubscriptionRef.SubscriptionRef<PrinterSnapshot>;
		temperatureHistory: SubscriptionRef.SubscriptionRef<TemperatureSample[]>;
		submit: (
			request: ActionRequest,
			actor?: CalibrationActor
		) => Effect.Effect<ActionRecord, ActionRejected>;
		setConnection: (connected: boolean) => Effect.Effect<void>;
		reset: Effect.Effect<void>;
		ingest: (
			telemetry: Pick<
				PrinterSnapshot,
				'connection' | 'klippy' | 'telemetryAt' | 'availableObjects' | 'job' | 'heaters'
			> &
				Partial<Pick<PrinterSnapshot, 'motion' | 'additionalTemperatures'>>
		) => Effect.Effect<void>;
	}
>()('perilune/PrinterService') {}

const expired = (action: ActionRecord) => Date.now() - action.createdAt >= 30_000;
const expiryMessage = 'Action expired while waiting. Submit it again if still needed.';
const connectionMessage = 'Connection lost during sending. This action will not be retried.';
const storageMessage =
	'Action history storage failed. Outcome is unknown; this action will not be retried.';

export const makePrinterService = (mode: PrinterSnapshot['mode'] = 'simulator') =>
	Layer.effect(
		PrinterService,
		Effect.gen(function* () {
			const store = yield* ActionStore;
			const history = yield* store.list;
			const calibration =
				mode === 'simulator'
					? restartCalibration(yield* store.calibration)
					: initialLiveSnapshot().calibration;
			if (mode === 'simulator') yield* store.writeCalibration(calibration);
			const state = yield* SubscriptionRef.make({
				...(mode === 'moonraker' ? initialLiveSnapshot() : initialSnapshot()),
				actions: mode === 'moonraker' ? [] : history,
				calibration
			});
			const temperatureHistory = yield* SubscriptionRef.make<TemperatureSample[]>([]);
			yield* Effect.gen(function* () {
				const snapshot = yield* SubscriptionRef.get(state);
				yield* SubscriptionRef.update(temperatureHistory, (samples) =>
					appendTemperatureSample(samples, snapshot, Date.now())
				);
			}).pipe(Effect.repeat(Schedule.spaced('5 seconds')), Effect.forkScoped);

			let lastThermalReady: boolean | undefined;
			yield* SubscriptionRef.changes(state).pipe(
				Stream.runForEach((snapshot) =>
					Effect.gen(function* () {
						const ready = snapshot.connection === 'connected' && snapshot.klippy === 'ready';
						const changed = lastThermalReady !== undefined && ready !== lastThermalReady;
						lastThermalReady = ready;
						if (changed)
							yield* SubscriptionRef.update(temperatureHistory, (samples) =>
								appendTemperatureSample(
									samples,
									snapshot,
									Math.max(Date.now(), (samples.at(-1)?.at ?? 0) + 1)
								)
							);
					})
				),
				Effect.forkScoped
			);

			const lock = yield* Semaphore.make(1);
			const pending = new Map<string, ActionRequest & { actor?: CalibrationActor }>();
			let simulatedRunId: string | undefined;
			const unwritten = new Map<string, { status: ActionStatus; message: string | null }>();
			let lastRecovery = 0;
			const revised = (previous: PrinterSnapshot, next: PrinterSnapshot) => ({
				...next,
				revision: previous.revision + 1,
				updatedAt: Date.now()
			});
			const update = (f: (snapshot: PrinterSnapshot) => PrinterSnapshot) =>
				SubscriptionRef.update(state, (snapshot) => revised(snapshot, f(snapshot)));

			// Persist and publish the command result + terminal status as one state transition.
			// The ref lock prevents a stale snapshot from overwriting a concurrent disconnect or tick.
			const settle = (
				action: ActionRecord,
				status: ActionStatus,
				message: string | null,
				request?: ActionRequest & { actor?: CalibrationActor },
				generation?: number
			) =>
				SubscriptionRef.modifyEffect(state, (current) =>
					Effect.gen(function* () {
						let next = current;
						if (request) {
							if (
								current.connection !== 'connected' ||
								current.connectionGeneration !== generation
							) {
								status = 'unknown';
								message = connectionMessage;
							} else if (expired(action)) {
								status = 'failed';
								message = expiryMessage;
							} else {
								const file =
									request.command.type === 'start'
										? yield* store.jobFile(request.command.fileId)
										: undefined;
								const result = yield* Effect.try({
									try: () => {
										if (
											request.command.type.startsWith('calibration') &&
											request.actor?.authorized &&
											!request.actor.authorized()
										)
											throw new CommandRejected({
												message: 'The operator account is no longer authorized.'
											});
										return applyCommand(current, request.command, file, request.actor);
									},
									catch: (cause) =>
										cause instanceof CommandRejected
											? cause
											: new CommandRejected({ message: 'Invalid command' })
								}).pipe(Effect.result);
								if (result._tag === 'Failure') {
									status = 'failed';
									message = result.failure.message;
								} else {
									next = result.success;
									if (request.command.type === 'start') {
										next.job.runId = request.id;
										simulatedRunId = request.id;
									}
								}
							}
						}
						if (status === 'completed' && request?.command.type.startsWith('calibration'))
							yield* store.commitCalibration(action.id, status, message, next.calibration);
						else yield* store.setStatus(action.id, status, message);
						pending.delete(action.id);
						return [
							undefined,
							revised(current, {
								...next,
								actions: current.actions.map((item) =>
									item.id === action.id ? { ...item, status, message } : item
								)
							})
						] as const;
					})
				);

			const degrade = (action: ActionRecord) =>
				Effect.gen(function* () {
					// Settle in memory even if storage is unavailable, then retry only the status write.
					// Never retry the command itself, and do not strand the UI in a pending state.
					pending.delete(action.id);
					unwritten.set(action.id, { status: 'unknown', message: storageMessage });
					yield* update((snapshot) => ({
						...snapshot,
						storage: 'degraded',
						calibration: interruptCalibration(
							snapshot.calibration,
							'Action storage failed. The result is unknown; check the saved default after storage recovers.'
						),
						motion: { ...snapshot.motion, calibration: false },
						actions: snapshot.actions.map((item) =>
							item.id === action.id ? { ...item, status: 'unknown', message: storageMessage } : item
						)
					}));
				});
			const recoverStorage = Effect.gen(function* () {
				if (Date.now() - lastRecovery < 1000) return;
				lastRecovery = Date.now();
				yield* store.probe;
				for (const [id, record] of unwritten) {
					yield* store.setStatus(id, record.status, record.message);
					unwritten.delete(id);
				}
				const persisted = yield* store.calibration;
				yield* SubscriptionRef.modifyEffect(state, (snapshot) =>
					Effect.gen(function* () {
						const calibration = { ...snapshot.calibration, savedOffset: persisted.savedOffset };
						yield* store.writeCalibration(calibration);
						return [
							undefined,
							revised(snapshot, { ...snapshot, calibration, storage: 'healthy' })
						] as const;
					})
				);
			});
			const work = Effect.gen(function* () {
				const snapshot = yield* SubscriptionRef.get(state);
				if (snapshot.storage === 'degraded') {
					yield* recoverStorage;
					return;
				}
				const action = snapshot.actions.filter((item) => item.status === 'queued').at(-1);
				if (!action) return;
				const execute = Effect.gen(function* () {
					if (expired(action)) {
						yield* settle(action, 'failed', expiryMessage);
						return;
					}
					if (snapshot.connection !== 'connected') return;
					const request = pending.get(action.id);
					if (!request) return;
					yield* store.setStatus(action.id, 'sending', null);
					yield* update((current) => ({
						...current,
						actions: current.actions.map((item) =>
							item.id === action.id ? { ...item, status: 'sending' } : item
						)
					}));
					yield* Effect.sleep('600 millis');
					yield* lock.withPermits(1)(
						settle(action, 'completed', null, request, snapshot.connectionGeneration).pipe(
							Effect.uninterruptible
						)
					);
				});
				yield* execute.pipe(
					Effect.catchCause((cause) =>
						degrade(action).pipe(Effect.andThen(Effect.logError('Action processing failed', cause)))
					)
				);
			});
			yield* work.pipe(
				Effect.catchCause((cause) => Effect.logError('Storage recovery failed', cause)),
				Effect.repeat(Schedule.spaced('100 millis')),
				Effect.forkScoped
			);
			if (mode === 'simulator')
				yield* update((snapshot) =>
					snapshot.connection === 'connected'
						? {
								...snapshot,
								job:
									snapshot.job.runId === simulatedRunId &&
									simulatedRunId !== undefined &&
									snapshot.job.state === 'printing'
										? {
												...snapshot.job,
												progress: Math.min(100, (snapshot.job.progress ?? 0) + 1),
												state: (snapshot.job.progress ?? 0) >= 99 ? 'complete' : 'printing',
												layer: snapshot.job.totalLayers
													? Math.floor(
															(snapshot.job.totalLayers *
																Math.min(100, (snapshot.job.progress ?? 0) + 1)) /
																100
														)
													: null
											}
										: snapshot.job,
								heaters: {
									nozzle: {
										...snapshot.heaters.nozzle,
										current: approach(
											snapshot.heaters.nozzle.current,
											snapshot.heaters.nozzle.target
										)
									},
									bed: {
										...snapshot.heaters.bed,
										current: approach(snapshot.heaters.bed.current, snapshot.heaters.bed.target)
									}
								}
							}
						: snapshot
				).pipe(Effect.repeat(Schedule.spaced('1 second')), Effect.forkScoped);

			if (mode === 'simulator')
				yield* lock
					.withPermits(1)(
						SubscriptionRef.modifyEffect(state, (current) =>
							Effect.gen(function* () {
								if (
									!calibrationActive(current.calibration) ||
									current.calibration.session!.expiresAt > Date.now()
								)
									return [undefined, current] as const;
								const calibration = interruptCalibration(
									current.calibration,
									'Session expired after 10 minutes without changes. Unsaved adjustments were discarded.'
								);
								const persisted = yield* store.writeCalibration(calibration).pipe(Effect.result);
								return [
									undefined,
									revised(current, {
										...current,
										calibration,
										motion: { ...current.motion, calibration: false },
										storage: persisted._tag === 'Failure' ? 'degraded' : current.storage
									})
								] as const;
							})
						)
					)
					.pipe(Effect.repeat(Schedule.spaced('1 second')), Effect.forkScoped);

			return {
				state,
				temperatureHistory,
				submit: (request, actor) =>
					lock
						.withPermits(1)(
							Effect.gen(function* () {
								const current = yield* SubscriptionRef.get(state);
								if (mode === 'moonraker')
									return yield* Effect.fail(
										new ActionRejected({
											message: 'Live printer is read-only. Controls are not enabled yet.'
										})
									);
								if (current.storage === 'degraded')
									return yield* Effect.fail(
										new ActionRejected({
											message: 'Action history storage is recovering. Please wait.'
										})
									);
								const existing = yield* store.find(request.id);
								if (existing) {
									if (
										existing.payload !== JSON.stringify(request.command) ||
										(request.command.type.startsWith('calibration') &&
											existing.actorId !== actor?.id)
									)
										return yield* Effect.fail(
											new ActionRejected({
												message: 'Action ID already belongs to a different command'
											})
										);
									return existing.action;
								}
								if (
									'expectedJob' in request.command &&
									request.command.expectedJob &&
									(request.command.expectedJob.filename !== current.job.filename ||
										request.command.expectedJob.runId !== (current.job.runId ?? null))
								) {
									return yield* Effect.fail(
										new ActionRejected({
											message: 'The active job changed. Review the current job before trying again.'
										})
									);
								}
								if (
									calibrationActive(current.calibration) &&
									!request.command.type.startsWith('calibration') &&
									request.command.type !== 'cooldown'
								)
									return yield* Effect.fail(
										new ActionRejected({
											message: 'Calibration owns the printer controls. Finish or cancel it first.'
										})
									);
								if (request.command.type.startsWith('calibration')) {
									if (current.actions.some((item) => ['queued', 'sending'].includes(item.status)))
										return yield* Effect.fail(
											new ActionRejected({
												message: 'Another action is pending. Wait for it to finish.'
											})
										);
									if (actor?.authorized && !actor.authorized())
										return yield* Effect.fail(
											new ActionRejected({
												message: 'The operator account is no longer authorized.'
											})
										);
									if (request.command.type === 'calibrationBegin') {
										const reason = calibrationReason(current);
										if (reason) return yield* Effect.fail(new ActionRejected({ message: reason }));
									}
									yield* Effect.try({
										try: () => applyCommand(current, request.command, undefined, actor),
										catch: (cause) =>
											new ActionRejected({
												message:
													cause instanceof CommandRejected
														? cause.message
														: 'Invalid calibration command'
											})
									});
								}
								if (request.command.type === 'start') {
									const reason = startReason(current);
									if (reason) return yield* Effect.fail(new ActionRejected({ message: reason }));
									const file = yield* store.jobFile(request.command.fileId);
									if (!file)
										return yield* Effect.fail(
											new ActionRejected({ message: 'The selected file is no longer available.' })
										);
								}
								if (request.command.type === 'temperature' || request.command.type === 'cooldown') {
									const reason = temperatureReason(
										current,
										request.command.type === 'temperature' ? request.command.heater : undefined
									);
									if (reason) return yield* Effect.fail(new ActionRejected({ message: reason }));
									yield* Effect.try({
										try: () => applyCommand(current, request.command),
										catch: (cause) =>
											new ActionRejected({
												message:
													cause instanceof CommandRejected
														? cause.message
														: 'Invalid temperature command'
											})
									});
								}

								if (
									request.command.type === 'move' ||
									request.command.type === 'home' ||
									request.command.type === 'releaseMotors'
								) {
									const required =
										request.command.type === 'move'
											? (Object.keys(request.command.target) as ('x' | 'y' | 'z')[])
											: request.command.type === 'releaseMotors'
												? []
												: request.command.axes === 'xy'
													? (['x', 'y'] as const)
													: request.command.axes === 'z'
														? (['z'] as const)
														: (['x', 'y', 'z'] as const);
									const reason = motionReason(current, required, request.command.type !== 'move');
									if (reason) return yield* Effect.fail(new ActionRejected({ message: reason }));
									const validation = yield* Effect.try({
										try: () => applyCommand(current, request.command),
										catch: (cause) =>
											new ActionRejected({
												message:
													cause instanceof CommandRejected
														? cause.message
														: 'Invalid movement command'
											})
									}).pipe(Effect.result);
									if (validation._tag === 'Failure') return yield* Effect.fail(validation.failure);
								}
								if (pending.size >= 20)
									return yield* Effect.fail(
										new ActionRejected({
											message: 'Action queue is full. Wait for pending actions.'
										})
									);
								const action: ActionRecord = {
									id: request.id,
									label:
										request.command.type === 'start'
											? `Start ${(yield* store.jobFile(request.command.fileId))!.name}`
											: actionLabel(request.command),
									status: 'queued',
									createdAt: Date.now(),
									message: null
								};
								yield* store.insert(
									action,
									request.command,
									request.command.type.startsWith('calibration') ? actor?.id : undefined
								);
								pending.set(action.id, { ...request, actor });
								yield* update((snapshot) => ({
									...snapshot,
									actions: [action, ...snapshot.actions].slice(0, 40)
								}));
								return action;
							})
						)
						.pipe(
							Effect.mapError((cause) =>
								cause instanceof ActionRejected
									? cause
									: new ActionRejected({ message: 'Action could not be recorded', cause })
							)
						),
				setConnection: (connected) =>
					mode === 'moonraker'
						? Effect.void
						: lock.withPermits(1)(
								SubscriptionRef.modifyEffect(state, (snapshot) =>
									Effect.gen(function* () {
										const connection = connected
											? ('connected' as const)
											: ('disconnected' as const);
										const calibration = connected
											? snapshot.calibration
											: interruptCalibration(
													snapshot.calibration,
													'Printer connection lost. Unsaved adjustments were discarded; start again after reconnecting.'
												);
										const persisted =
											calibration === snapshot.calibration
												? undefined
												: yield* store.writeCalibration(calibration).pipe(Effect.result);
										return [
											undefined,
											revised(snapshot, {
												...snapshot,
												connection,
												calibration,
												motion: { ...snapshot.motion, calibration: calibrationActive(calibration) },
												storage: persisted?._tag === 'Failure' ? 'degraded' : snapshot.storage,
												connectionGeneration:
													snapshot.connectionGeneration +
													(connection === snapshot.connection ? 0 : 1)
											})
										] as const;
									})
								).pipe(Effect.uninterruptible)
							),
				ingest: (telemetry) =>
					mode === 'simulator'
						? Effect.void
						: update((snapshot) => ({
								...snapshot,
								...telemetry,
								connectionGeneration:
									snapshot.connectionGeneration +
									(snapshot.connection !== telemetry.connection ||
									snapshot.klippy !== telemetry.klippy
										? 1
										: 0)
							})),
				reset:
					mode === 'moonraker'
						? Effect.void
						: lock.withPermits(1)(
								update((snapshot) =>
									pending.size > 0 ||
									snapshot.storage === 'degraded' ||
									calibrationActive(snapshot.calibration)
										? snapshot
										: {
												...initialSnapshot(),
												calibration: snapshot.calibration,
												actions: snapshot.actions,
												connectionGeneration: snapshot.connectionGeneration + 1
											}
								)
							)
			};
		})
	);

export const PrinterServiceLive = makePrinterService();

function approach(current: number | null, target: number | null): number {
	current ??= 23;
	target ??= 0;
	const ambientTarget = Math.max(23, target);
	return (
		Math.round(
			(current +
				Math.sign(ambientTarget - current) * Math.min(Math.abs(ambientTarget - current), 2)) *
				10
		) / 10
	);
}
