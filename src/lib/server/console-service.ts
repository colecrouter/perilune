import {
	Context,
	Data,
	Effect,
	Layer,
	Option,
	Schedule,
	Semaphore,
	Stream,
	SubscriptionRef
} from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import { migrate } from './migrations.js';
import { PrinterService } from './printer-service.js';
import { MoonrakerService } from './moonraker.js';
import {
	consoleReason,
	consoleScript,
	simulatorMacros,
	simulateConsole,
	type ConsoleReceipt,
	type ConsoleSnapshot
} from '#lib/domain/console.js';
export class ConsoleError extends Data.TaggedError('ConsoleError')<{ message: string }> {}
const failure = (message: string) => new ConsoleError({ message });
export interface ConsoleActor {
	id: string;
	authorized: () => boolean;
}
interface Stored {
	id: string;
	owner: string;
	script: string;
	status: ConsoleReceipt['status'];
	created: number;
	message: string | null;
	output: string;
}
const receipt = (row: Stored): ConsoleReceipt => ({
	id: row.id,
	script: row.script,
	status: row.status,
	createdAt: row.created,
	message: row.message,
	output: JSON.parse(row.output)
});
export class ConsoleService extends Context.Service<
	ConsoleService,
	{
		state: SubscriptionRef.SubscriptionRef<ConsoleSnapshot>;
		submit: (
			id: string,
			script: string,
			actor: ConsoleActor
		) => Effect.Effect<ConsoleReceipt, ConsoleError>;
		find: (id: string, actor: ConsoleActor) => Effect.Effect<ConsoleReceipt | null, ConsoleError>;
		pins: (actor: ConsoleActor) => Effect.Effect<string[], ConsoleError>;
		pin: (name: string, pinned: boolean, actor: ConsoleActor) => Effect.Effect<void, ConsoleError>;
	}
>()('perilune/ConsoleService') {}
export const ConsoleServiceLive = Layer.effect(
	ConsoleService,
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		yield* migrate;
		const printer = yield* PrinterService;
		const upstream = yield* Effect.serviceOption(MoonrakerService);
		const lock = yield* Semaphore.make(1);
		const actors = new Map<string, ConsoleActor>();
		let unhealthy = false;
		yield* sql`UPDATE console_commands SET status='unknown',message='Backend restarted. This command was not replayed.' WHERE status IN ('queued','sending')`;
		const initial = yield* SubscriptionRef.get(printer.state);
		const state = yield* SubscriptionRef.make<ConsoleSnapshot>({
			revision: 0,
			mode: initial.mode,
			connection: initial.connection,
			reason: consoleReason(initial),
			macros: initial.mode === 'simulator' ? simulatorMacros : [],
			responses: [],
			receipts: []
		});
		const valid = (actor?: ConsoleActor) => {
			try {
				return Boolean(actor?.authorized());
			} catch {
				return false;
			}
		};
		const authorize = (actor: ConsoleActor) =>
			Effect.try({
				try: () => {
					if (!valid(actor)) throw failure('Operator access is no longer valid.');
				},
				catch: () => failure('Operator access is no longer valid.')
			});
		const mapErrors = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
			effect.pipe(
				Effect.mapError((cause) =>
					cause instanceof ConsoleError
						? cause
						: failure(
								'Console storage is unavailable. Your input has been kept; check command history before trying again.'
							)
				)
			);
		const publish = Effect.gen(function* () {
			const snapshot = yield* SubscriptionRef.get(printer.state);
			const live = Option.isSome(upstream)
				? yield* SubscriptionRef.get(upstream.value.state)
				: null;
			const rows =
				yield* sql<Stored>`SELECT * FROM console_commands ORDER BY created DESC,rowid DESC LIMIT 100`;
			yield* SubscriptionRef.update(state, (old) => ({
				revision: old.revision + 1,
				mode: snapshot.mode,
				connection: snapshot.connection,
				reason: unhealthy
					? 'Console storage failed. Check history before submitting more commands.'
					: consoleReason(snapshot),
				macros: snapshot.mode === 'simulator' ? simulatorMacros : (live?.console?.macros ?? []),
				responses: live?.console?.responses ?? [],
				receipts: rows.map(receipt)
			}));
		});
		yield* publish;
		const streams = [SubscriptionRef.changes(printer.state).pipe(Stream.map(() => null))];
		if (Option.isSome(upstream))
			streams.push(SubscriptionRef.changes(upstream.value.state).pipe(Stream.map(() => null)));
		yield* Stream.mergeAll(streams, { concurrency: 'unbounded' }).pipe(
			Stream.runForEach(() =>
				publish.pipe(Effect.catch(() => Effect.logWarning('Console state could not refresh.')))
			),
			Effect.forkScoped
		);
		const finish = (
			id: string,
			status: ConsoleReceipt['status'],
			message: string | null,
			output: string[] = []
		) =>
			Effect.gen(function* () {
				yield* sql`UPDATE console_commands SET status=${status},message=${message},output=${JSON.stringify(output)} WHERE id=${id}`;
				actors.delete(id);
				yield* publish;
			});
		const work = Effect.gen(function* () {
			if (unhealthy) {
				yield* sql`UPDATE console_commands SET status='unknown',message='Console storage failed. This command was not replayed.' WHERE status IN ('queued','sending')`;
				actors.clear();
				unhealthy = false;
				yield* publish;
			}
			const row = yield* lock.withPermits(1)(
				Effect.gen(function* () {
					const [next] =
						yield* sql<Stored>`SELECT * FROM console_commands WHERE status='queued' ORDER BY created,rowid LIMIT 1`;
					if (!next) return;
					const snapshot = yield* SubscriptionRef.get(printer.state);
					if (Date.now() - next.created > 30_000) {
						yield* finish(next.id, 'failed', 'Command expired while waiting. It was not run.');
						return;
					}
					const actor = actors.get(next.id);
					if (!valid(actor)) {
						yield* finish(next.id, 'failed', 'Operator access ended before execution.');
						return;
					}
					const reason = consoleReason(snapshot);
					if (reason) {
						yield* finish(next.id, 'failed', reason);
						return;
					}
					yield* sql`UPDATE console_commands SET status='sending' WHERE id=${next.id}`;
					yield* publish;
					return { row: next, generation: snapshot.connectionGeneration };
				})
			);
			if (!row) return;
			yield* Effect.sleep('600 millis');
			yield* lock.withPermits(1)(
				Effect.gen(function* () {
					const snapshot = yield* SubscriptionRef.get(printer.state);
					if (
						snapshot.connection !== 'connected' ||
						snapshot.connectionGeneration !== row.generation
					) {
						yield* finish(
							row.row.id,
							'unknown',
							'Connection changed while executing. The command will not be retried.'
						);
						return;
					}
					const actor = actors.get(row.row.id);
					if (!valid(actor)) {
						yield* finish(row.row.id, 'failed', 'Operator access ended before execution.');
						return;
					}
					if (Date.now() - row.row.created > 30_000) {
						yield* finish(row.row.id, 'failed', 'Command expired before execution.');
						return;
					}
					const output = yield* Effect.try({
						try: () => simulateConsole(row.row.script, snapshot),
						catch: (cause) =>
							failure(cause instanceof Error ? cause.message : 'Simulator command failed.')
					}).pipe(Effect.result);
					if (output._tag === 'Failure')
						yield* finish(row.row.id, 'failed', output.failure.message);
					else yield* finish(row.row.id, 'completed', null, output.success);
				})
			);
		});
		yield* work.pipe(
			Effect.catch(() =>
				Effect.gen(function* () {
					unhealthy = true;
					yield* SubscriptionRef.update(state, (s) => ({
						...s,
						reason: 'Console storage failed. Check history before submitting more commands.'
					}));
				})
			),
			Effect.repeat(Schedule.spaced('100 millis')),
			Effect.forkScoped
		);
		yield* Effect.gen(function* () {
			yield* sql`DELETE FROM console_commands WHERE status NOT IN ('queued','sending') AND (created < ${Date.now() - 7 * 86400_000} OR id IN (SELECT id FROM console_commands ORDER BY created DESC,rowid DESC LIMIT -1 OFFSET 2000))`;
		}).pipe(
			Effect.catch(() => Effect.void),
			Effect.repeat(Schedule.spaced('1 minute')),
			Effect.forkScoped
		);
		return {
			state,
			submit: (id, script, actor) =>
				mapErrors(
					lock.withPermits(1)(
						Effect.gen(function* () {
							yield* authorize(actor);
							if (unhealthy)
								return yield* Effect.fail(
									failure(
										'Console storage is recovering. Check history before submitting more commands.'
									)
								);
							const text = yield* Effect.try({
								try: () => consoleScript(script),
								catch: (cause) =>
									failure(cause instanceof Error ? cause.message : 'Invalid command.')
							});
							if (!/^[a-f0-9-]{36}$/i.test(id))
								return yield* Effect.fail(failure('Supply a unique command ID.'));
							const [existing] = yield* sql<Stored>`SELECT * FROM console_commands WHERE id=${id}`;
							if (existing) {
								if (existing.owner !== actor.id || existing.script !== text)
									return yield* Effect.fail(
										failure('This command ID belongs to a different submission.')
									);
								return receipt(existing);
							}
							const snapshot = yield* SubscriptionRef.get(printer.state);
							const reason = consoleReason(snapshot);
							if (reason) return yield* Effect.fail(failure(reason));
							const count = yield* sql<{
								total: number;
							}>`SELECT COUNT(*) AS total FROM console_commands WHERE status IN ('queued','sending')`;
							if (count[0]!.total >= 20)
								return yield* Effect.fail(
									failure('Console queue is full. Wait for pending commands.')
								);
							const now = Date.now();
							yield* sql`INSERT INTO console_commands VALUES(${id},${actor.id},${text},'queued',${now},NULL,'[]')`;
							actors.set(id, actor);
							yield* publish;
							return {
								id,
								script: text,
								status: 'queued' as const,
								createdAt: now,
								message: null,
								output: []
							};
						})
					)
				),
			find: (id, actor) =>
				mapErrors(
					Effect.gen(function* () {
						yield* authorize(actor);
						const [row] =
							yield* sql<Stored>`SELECT * FROM console_commands WHERE id=${id} AND owner=${actor.id}`;
						return row ? receipt(row) : null;
					})
				),
			pins: (actor) =>
				mapErrors(
					Effect.gen(function* () {
						yield* authorize(actor);
						const rows = yield* sql<{
							name: string;
						}>`SELECT name FROM macro_shortcuts WHERE owner=${actor.id} ORDER BY name`;
						return rows.map((row) => row.name);
					})
				),
			pin: (name, pinned, actor) =>
				mapErrors(
					lock.withPermits(1)(
						Effect.gen(function* () {
							yield* authorize(actor);
							if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(name))
								return yield* Effect.fail(failure('Choose a valid macro.'));
							if (!pinned)
								yield* sql`DELETE FROM macro_shortcuts WHERE owner=${actor.id} AND name=${name}`;
							else {
								const existing =
									yield* sql`SELECT name FROM macro_shortcuts WHERE owner=${actor.id} AND name=${name}`;
								if (existing.length) return;
								if (!(yield* SubscriptionRef.get(state)).macros.some((m) => m.name === name))
									return yield* Effect.fail(failure('This macro is no longer available.'));
								const count = yield* sql<{
									total: number;
								}>`SELECT COUNT(*) AS total FROM macro_shortcuts WHERE owner=${actor.id}`;
								if (count[0]!.total >= 24)
									return yield* Effect.fail(failure('Keep up to 24 macro shortcuts.'));
								yield* sql`INSERT OR IGNORE INTO macro_shortcuts VALUES(${actor.id},${name})`;
							}
							yield* publish;
						})
					)
				)
		};
	})
);
