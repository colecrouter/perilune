import { afterEach, expect, it } from 'vite-plus/test';
import { Effect, Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { ActionStore, ActionStoreLive } from './action-store.js';
import { PrinterService, makePrinterService } from './printer-service.js';
import { reconcilePrintSubmission } from './print-action-reconciliation.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const f of cleanup.splice(0)) await f();
});
async function fixture() {
	const db = SqliteClient.layer({ filename: ':memory:' });
	const store = ActionStoreLive.pipe(Layer.provide(db));
	const runtime = ManagedRuntime.make(
		makePrinterService('simulator').pipe(Layer.provideMerge(store), Layer.provideMerge(db))
	);
	cleanup.push(() => runtime.dispose());
	return {
		runtime,
		service: await runtime.runPromise(PrinterService),
		store: await runtime.runPromise(ActionStore)
	};
}
const actor = { id: 'owner', name: 'Owner', role: 'owner', authorized: () => true };
it('closes an absent request ID and prevents a late physical admission', async () => {
	const f = await fixture(),
		id = crypto.randomUUID();
	const receipt = await f.runtime.runPromise(reconcilePrintSubmission(id, actor.id));
	expect(receipt?.status).toBe('failed');
	const before = await f.runtime.runPromise(SubscriptionRef.get(f.service.state));
	await expect(
		f.runtime.runPromise(
			f.service.submit(
				{
					id,
					command: {
						type: 'pause',
						expectedJob: { filename: before.job.filename, runId: before.job.runId ?? null }
					}
				},
				actor
			)
		)
	).rejects.toThrow(/different command/);
	expect((await f.runtime.runPromise(SubscriptionRef.get(f.service.state))).job.state).toBe(
		'printing'
	);
	expect((await f.runtime.runPromise(f.store.find(id)))?.action.status).toBe('failed');
});
it('returns existing receipts without changing them or exposing another account', async () => {
	const f = await fixture(),
		id = crypto.randomUUID();
	const action = {
		id,
		label: 'Pause print',
		status: 'unknown' as const,
		createdAt: 1,
		message: null
	};
	await f.runtime.runPromise(f.store.insert(action, { type: 'pause' }, actor.id));
	expect(await f.runtime.runPromise(reconcilePrintSubmission(id, 'other'))).toBeNull();
	expect(await f.runtime.runPromise(reconcilePrintSubmission(id, actor.id))).toEqual(action);
	expect((await f.runtime.runPromise(f.store.find(id)))?.action.status).toBe('unknown');
	await f.runtime.runPromise(f.store.setStatus(id, 'unknown', 'Reviewed', 123));
	expect((await f.runtime.runPromise(reconcilePrintSubmission(id, actor.id)))?.reviewedAt).toBe(
		123
	);
});
