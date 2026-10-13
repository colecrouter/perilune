import { Context, Data, Effect, Layer, Schedule, Semaphore, SubscriptionRef } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
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
import { migrate } from './migrations.js';

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

interface StoredAction {
	id: string;
	payload: string;
	label: string;
	status: ActionStatus;
	created_at: number;
	message: string | null;
}
const fromRow = (row: StoredAction): ActionRecord => ({
	id: row.id,
	label: row.label,
	status: row.status,
	createdAt: row.created_at,
	message: row.message
});

export const PrinterServiceLive = Layer.effect(
	PrinterService,
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		yield* migrate;
		// A process restart cannot establish whether a sent command completed. Never replay it.
		yield* sql`UPDATE actions SET status = 'unknown', message = 'Backend restarted. This action was not replayed.' WHERE status IN ('queued', 'sending')`;
		const history =
			yield* sql<StoredAction>`SELECT * FROM actions ORDER BY created_at DESC LIMIT 20`;
		const state = yield* SubscriptionRef.make({
			...initialSnapshot(),
			actions: history.map(fromRow)
		});
		const lock = yield* Semaphore.make(1);
		const pending = new Map<string, ActionRequest>();
		const update = (f: (snapshot: PrinterSnapshot) => PrinterSnapshot) =>
			SubscriptionRef.update(state, (snapshot) => ({
				...f(snapshot),
				revision: snapshot.revision + 1,
				updatedAt: Date.now()
			}));
		const finish = (id: string, status: ActionStatus, message: string | null = null) =>
			Effect.gen(function* () {
				yield* sql`UPDATE actions SET status = ${status}, message = ${message} WHERE id = ${id}`;
				yield* update((snapshot) => ({
					...snapshot,
					actions: snapshot.actions.map((action) =>
						action.id === id ? { ...action, status, message } : action
					)
				}));
				pending.delete(id);
			});
		const work = Effect.gen(function* () {
			const snapshot = yield* SubscriptionRef.get(state);
			const action = snapshot.actions.filter((item) => item.status === 'queued').at(-1);
			if (!action) return;
			if (Date.now() - action.createdAt > 30_000) {
				yield* finish(
					action.id,
					'failed',
					'Action expired while waiting. Submit it again if still needed.'
				);
				return;
			}
			if (snapshot.connection !== 'connected') return;
			const request = pending.get(action.id);
			if (!request) return;
			yield* sql`UPDATE actions SET status = 'sending' WHERE id = ${action.id}`;
			yield* update((current) => ({
				...current,
				actions: current.actions.map((item) =>
					item.id === action.id ? { ...item, status: 'sending' } : item
				)
			}));
			yield* Effect.sleep('600 millis');
			yield* lock.withPermits(1)(
				Effect.gen(function* () {
					const current = yield* SubscriptionRef.get(state);
					if (current.connection !== 'connected') {
						yield* finish(
							action.id,
							'unknown',
							'Connection lost during sending. This action will not be retried.'
						);
						return;
					}
					const result = yield* Effect.try({
						try: () => applyCommand(current, request.command),
						catch: (cause) =>
							cause instanceof CommandRejected
								? cause
								: new CommandRejected({ message: 'Invalid command' })
					}).pipe(Effect.result);
					if (result._tag === 'Failure') {
						yield* finish(action.id, 'failed', result.failure.message);
						return;
					}
					yield* finish(action.id, 'completed');
					yield* update((latest) => ({ ...result.success, actions: latest.actions }));
				})
			);
		});
		yield* work.pipe(
			Effect.catchCause((cause) => Effect.logError('Simulator worker failure', cause)),
			Effect.repeat(Schedule.spaced('100 millis')),
			Effect.forkScoped
		);
		// One shared ticker, independent of browser connections.
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
							const existing =
								yield* sql<StoredAction>`SELECT * FROM actions WHERE id = ${request.id}`;
							if (existing[0]) {
								if (existing[0].payload !== JSON.stringify(request.command))
									return yield* Effect.fail(
										new ActionRejected({
											message: 'Action ID already belongs to a different command'
										})
									);
								return fromRow(existing[0]);
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
							yield* sql`INSERT INTO actions (id, payload, label, status, created_at) VALUES (${action.id}, ${JSON.stringify(request.command)}, ${action.label}, ${action.status}, ${action.createdAt})`;
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
				update((snapshot) => ({
					...snapshot,
					connection: connected ? 'connected' : 'disconnected'
				})),
			reset: lock.withPermits(1)(
				Effect.gen(function* () {
					const snapshot = yield* SubscriptionRef.get(state);
					if (pending.size > 0) return;
					yield* update(() => ({ ...initialSnapshot(), actions: snapshot.actions }));
				})
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
