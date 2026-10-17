import { randomUUID } from 'node:crypto';
import { Context, Data, Effect, Layer, Semaphore, SubscriptionRef } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import type { ActionRecord } from '#lib/domain/printer.js';
import { safeRelativePath } from '#lib/domain/jobs.js';
import { ActionStore } from './action-store.js';
import { JobService } from './job-service.js';
import { LiveActionService } from './live-action-service.js';
import { ActionRejected, PrinterService } from './printer-service.js';

export class SlicerError extends Data.TaggedError('SlicerError')<{
	status: number;
	message: string;
}> {}
const reject = (status: number, message: string) => new SlicerError({ status, message });
export class SlicerService extends Context.Service<
	SlicerService,
	{
		start: (token: string, filename: string) => Effect.Effect<ActionRecord, SlicerError>;
	}
>()('perilune/SlicerService') {}

/** HTTP callers only wait for receipts; the existing process worker owns all execution. */
export const SlicerServiceLive = Layer.effect(
	SlicerService,
	Effect.gen(function* () {
		const jobs = yield* JobService;
		const printer = yield* PrinterService;
		const live = yield* LiveActionService;
		const store = yield* ActionStore;
		const sql = yield* SqlClient;
		const gate = yield* Semaphore.make(1);
		let waiting = 0;
		return {
			start: (token: string, filename: string) =>
				Effect.suspend(() => {
					if (waiting >= 8)
						return Effect.fail(reject(429, 'Too many print requests. Check Jobs before retrying.'));
					waiting++;
					return Effect.gen(function* () {
						const key = yield* jobs.printKey(token);
						if (!key) return yield* Effect.fail(reject(401, 'Invalid or expired slicer key.'));
						if (!key.canPrint)
							return yield* Effect.fail(
								reject(
									403,
									'This key allows uploads only. Create an upload-and-print key in Account → Integrations, or choose Upload only in your slicer.'
								)
							);
						if (!safeRelativePath(filename))
							return yield* Effect.fail(reject(400, 'Invalid G-code filename.'));
						const action = yield* gate.withPermits(1)(
							Effect.gen(function* () {
								if (jobs.refresh) yield* jobs.refresh;
								const catalog = yield* SubscriptionRef.get(jobs.state);
								const file = catalog.files.find((file) => file.name === filename);
								if (!catalog.available || !file)
									return yield* Effect.fail(
										reject(409, 'Uploaded file is unavailable. Refresh the Perilune library.')
									);
								const previous = (yield* sql<{
									action_id: string;
									created: number;
								}>`SELECT action_id,created FROM slicer_starts WHERE key_id=${key.id} AND file_id=${file.id}`)[0];
								// Native Moonraker clients supply no request ID. Coalesce retries for two minutes,
								// including across process restarts, and never replay an uncertain receipt.
								const prior = previous ? yield* store.find(previous.action_id) : undefined;
								if (
									prior &&
									(Date.now() - previous.created < 120_000 ||
										['queued', 'sending', 'unknown'].includes(prior.action.status))
								)
									return prior.action;
								if (previous && !prior && Date.now() - previous.created < 120_000)
									return yield* Effect.fail(
										reject(
											409,
											'A previous start request was interrupted. Check Jobs before submitting a new start.'
										)
									);
								const id = randomUUID();
								yield* sql`INSERT INTO slicer_starts(key_id,file_id,action_id,created) VALUES(${key.id},${file.id},${id},${Date.now()}) ON CONFLICT(key_id,file_id) DO UPDATE SET action_id=excluded.action_id,created=excluded.created`;
								const snapshot = yield* SubscriptionRef.get(printer.state);
								const request = { id, command: { type: 'start' as const, fileId: file.id } };
								const actor = {
									id: key.owner,
									name: 'Slicer',
									role: 'operator',
									authorized: key.authorized
								};
								return yield* (
									snapshot.mode === 'moonraker'
										? live.submit(request, actor)
										: printer.submit(request, actor)
								).pipe(
									Effect.catch((cause) =>
										Effect.gen(function* () {
											// Proven admission rejection dispatched nothing; allow immediate correction.
											// Preserve any durable receipt or uncertain storage outcome.
											if (cause instanceof ActionRejected && !(yield* store.find(id)))
												yield* sql`DELETE FROM slicer_starts WHERE key_id=${key.id} AND file_id=${file.id} AND action_id=${id}`;
											return yield* Effect.fail(cause);
										})
									)
								);
							}).pipe(Effect.uninterruptible)
						);
						const deadline = Date.now() + 20_000;
						let receipt = action;
						while (['queued', 'sending'].includes(receipt.status) && Date.now() < deadline) {
							yield* Effect.sleep('100 millis');
							receipt = (yield* store.find(action.id))?.action ?? receipt;
						}
						if (receipt.status !== 'completed')
							return yield* Effect.fail(
								reject(
									409,
									`Print start is ${receipt.status}. Check the action in Perilune Jobs before trying again.`
								)
							);
						return receipt;
					}).pipe(
						Effect.ensuring(
							Effect.sync(() => {
								waiting--;
							})
						)
					);
				}).pipe(
					Effect.mapError((cause) =>
						cause instanceof SlicerError
							? cause
							: reject(
									409,
									'Print could not start. Check printer readiness and the action in Perilune Jobs before trying again.'
								)
					)
				)
		};
	})
);
