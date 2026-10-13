import { Context, Data, Effect, Layer, Schedule, Semaphore, SubscriptionRef } from 'effect';
import {
	CommandRejected,
	actionLabel,
	applyCommand,
	initialSnapshot,
	type ActionRecord,
	type ActionRequest,
	type ActionStatus,
	type PrinterSnapshot
} from '#lib/domain/printer.js';
import { ActionStore } from './action-store.js';

export class ActionRejected extends Data.TaggedError('ActionRejected')<{
	message: string;
	cause?: unknown;
}> {}
export class PrinterService extends Context.Service<
	PrinterService,
	{
		state: SubscriptionRef.SubscriptionRef<PrinterSnapshot>;
		submit: (request: ActionRequest) => Effect.Effect<ActionRecord, ActionRejected>;
		setConnection: (connected: boolean) => Effect.Effect<void>;
		reset: Effect.Effect<void>;
	}
>()('perilune/PrinterService') {}

const expired = (action: ActionRecord) => Date.now() - action.createdAt >= 30_000;
const expiryMessage = 'Action expired while waiting. Submit it again if still needed.';
const connectionMessage = 'Connection lost during sending. This action will not be retried.';
const storageMessage =
	'Action history storage failed. Outcome is unknown; this action will not be retried.';

export const PrinterServiceLive = Layer.effect(
	PrinterService,
	Effect.gen(function* () {
		const store = yield* ActionStore;
		const history = yield* store.list;
		const state = yield* SubscriptionRef.make({ ...initialSnapshot(), actions: history });
		const lock = yield* Semaphore.make(1);
		const pending = new Map<string, ActionRequest>();
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
			request?: ActionRequest,
			generation?: number
		) =>
			SubscriptionRef.modifyEffect(state, (current) =>
				Effect.gen(function* () {
					let next = current;
					if (request) {
						if (current.connection !== 'connected' || current.connectionGeneration !== generation) {
							status = 'unknown';
							message = connectionMessage;
						} else if (expired(action)) {
							status = 'failed';
							message = expiryMessage;
						} else {
							const result = yield* Effect.try({
								try: () => applyCommand(current, request.command),
								catch: (cause) =>
									cause instanceof CommandRejected
										? cause
										: new CommandRejected({ message: 'Invalid command' })
							}).pipe(Effect.result);
							if (result._tag === 'Failure') {
								status = 'failed';
								message = result.failure.message;
							} else next = result.success;
						}
					}
					yield* store.setStatus(action.id, status, message);
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
			yield* update((snapshot) => ({ ...snapshot, storage: 'healthy' }));
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
					settle(action, 'completed', null, request, snapshot.connectionGeneration)
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
		yield* update((snapshot) =>
			snapshot.connection === 'connected'
				? {
						...snapshot,
						heaters: {
							nozzle: {
								...snapshot.heaters.nozzle,
								current: approach(snapshot.heaters.nozzle.current, snapshot.heaters.nozzle.target)
							},
							bed: {
								...snapshot.heaters.bed,
								current: approach(snapshot.heaters.bed.current, snapshot.heaters.bed.target)
							}
						}
					}
				: snapshot
		).pipe(Effect.repeat(Schedule.spaced('1 second')), Effect.forkScoped);

		return {
			state,
			submit: (request) =>
				lock
					.withPermits(1)(
						Effect.gen(function* () {
							const current = yield* SubscriptionRef.get(state);
							if (current.storage === 'degraded')
								return yield* Effect.fail(
									new ActionRejected({
										message: 'Action history storage is recovering. Please wait.'
									})
								);
							const existing = yield* store.find(request.id);
							if (existing) {
								if (existing.payload !== JSON.stringify(request.command))
									return yield* Effect.fail(
										new ActionRejected({
											message: 'Action ID already belongs to a different command'
										})
									);
								return existing.action;
							}
							if (pending.size >= 20)
								return yield* Effect.fail(
									new ActionRejected({ message: 'Action queue is full. Wait for pending actions.' })
								);
							const action: ActionRecord = {
								id: request.id,
								label: actionLabel(request.command),
								status: 'queued',
								createdAt: Date.now(),
								message: null
							};
							yield* store.insert(action, request.command);
							pending.set(action.id, request);
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
				update((snapshot) => {
					const connection = connected ? 'connected' : 'disconnected';
					return {
						...snapshot,
						connection,
						connectionGeneration:
							snapshot.connectionGeneration + (connection === snapshot.connection ? 0 : 1)
					};
				}),
			reset: lock.withPermits(1)(
				update((snapshot) =>
					pending.size > 0 || snapshot.storage === 'degraded'
						? snapshot
						: {
								...initialSnapshot(),
								actions: snapshot.actions,
								connectionGeneration: snapshot.connectionGeneration + 1
							}
				)
			)
		};
	})
);

function approach(current: number, target: number): number {
	const ambientTarget = Math.max(23, target);
	return (
		Math.round(
			(current +
				Math.sign(ambientTarget - current) * Math.min(Math.abs(ambientTarget - current), 2)) *
				10
		) / 10
	);
}
