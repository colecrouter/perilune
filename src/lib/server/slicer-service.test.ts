import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vite-plus/test';
import { Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { SqlClient } from 'effect/sql/SqlClient';
import { ActionStore, ActionStoreLive } from './action-store.js';
import { JobService, JobServiceLive, JobsConfig } from './job-service.js';
import { LiveActionDisabled } from './live-action-service.js';
import { PrinterService, PrinterServiceLive } from './printer-service.js';
import { SlicerService, SlicerServiceLive } from './slicer-service.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(filename = ':memory:') {
	let valid = true;
	const db = SqliteClient.layer({ filename });
	const printer = PrinterServiceLive.pipe(
		Layer.provideMerge(ActionStoreLive.pipe(Layer.provide(db)))
	);
	const jobs = JobServiceLive.pipe(
		Layer.provide(db),
		Layer.provideMerge(printer),
		Layer.provide(
			Layer.succeed(JobsConfig, {
				moonrakerUrl: '',
				checkUser: () => valid,
				checkPrintKey: () => valid
			})
		)
	);
	const runtime = ManagedRuntime.make(
		SlicerServiceLive.pipe(
			Layer.provideMerge(jobs),
			Layer.provideMerge(db),
			Layer.provide(LiveActionDisabled)
		)
	);
	cleanup.push(() => runtime.dispose());
	const service = await runtime.runPromise(SlicerService);
	const catalog = await runtime.runPromise(JobService);
	const machine = await runtime.runPromise(PrinterService);
	const store = await runtime.runPromise(ActionStore);
	const sql = await runtime.runPromise(SqlClient);
	// The simulator starts with a demonstration print; finish it before testing real admission.
	await runtime.runPromise(
		machine.submit({
			id: randomUUID(),
			command: { type: 'cancel', coolBed: false, coolNozzle: false }
		})
	);
	await expect
		.poll(async () => (await runtime.runPromise(SubscriptionRef.get(machine.state))).job.state)
		.toBe('cancelled');
	const file = await runtime.runPromise(
		catalog.upload('fixture.gcode', new TextEncoder().encode('G4 P1000\n'))
	);
	return {
		runtime,
		service,
		catalog,
		machine,
		store,
		sql,
		file,
		revoke: () => {
			valid = false;
		},
		start: (token: string) => runtime.runPromise(service.start(token, file.name))
	};
}
it('requires explicit print authority and preserves upload-only defaults', async () => {
	const f = await fixture();
	const upload = await f.runtime.runPromise(f.catalog.issueKey('owner', 0, 'Upload'));
	expect(upload.key.canPrint).toBe(false);
	await expect(f.start(upload.token)).rejects.toThrow(/uploads only/);
	await expect(f.start('x'.repeat(43))).rejects.toThrow(/Invalid or expired/);
	const print = await f.runtime.runPromise(f.catalog.issueKey('owner', 0, 'Print', true));
	expect(
		(await f.runtime.runPromise(f.catalog.keys('owner'))).find((k) => k.id === print.key.id)
			?.canPrint
	).toBe(true);
	await f.runtime.runPromise(f.catalog.revokeKey('owner', print.key.id));
	await expect(f.start(print.token)).rejects.toThrow(/Invalid or expired/);
});
it('coalesces concurrent native starts, waits for completion and preserves receipts after restart', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'perilune-slicer-'));
	cleanup.push(() => rm(dir, { recursive: true, force: true }));
	const filename = join(dir, 'state.sqlite');
	const f = await fixture(filename);
	const key = await f.runtime.runPromise(f.catalog.issueKey('owner', 0, 'Print', true));
	const [a, b] = await Promise.all([f.start(key.token), f.start(key.token)]);
	expect(a.id).toBe(b.id);
	expect(a.status).toBe('completed');
	expect(
		(await f.runtime.runPromise(f.store.list)).filter((a) => a.label.startsWith('Start'))
	).toHaveLength(1);
	await f.runtime.dispose();
	const next = await fixture(filename);
	const retried = await next.start(key.token);
	expect(retried.id).toBe(a.id);
});
it('does not replay unknown receipts, even after the native retry window', async () => {
	const f = await fixture();
	const key = await f.runtime.runPromise(f.catalog.issueKey('owner', 0, 'Print', true));
	const receipt = await f.start(key.token);
	await f.runtime.runPromise(f.store.setStatus(receipt.id, 'unknown', 'Lost acknowledgement'));
	await f.runtime.runPromise(f.sql`UPDATE slicer_starts SET created=0`);
	await expect(f.start(key.token)).rejects.toThrow(/unknown/);
	expect((await f.runtime.runPromise(f.store.find(receipt.id)))?.action.status).toBe('unknown');
});
it('checks exact filenames and readiness, and account recovery invalidates print keys', async () => {
	const f = await fixture();
	const key = await f.runtime.runPromise(f.catalog.issueKey('owner', 0, 'Print', true));
	await expect(
		f.runtime.runPromise(f.service.start(key.token, '../fixture.gcode'))
	).rejects.toThrow(/Invalid G-code/);
	await expect(f.runtime.runPromise(f.service.start(key.token, 'missing.gcode'))).rejects.toThrow(
		/unavailable/
	);
	await f.runtime.runPromise(f.machine.setConnection(false));
	await expect(f.start(key.token)).rejects.toThrow(/readiness/);
	await f.runtime.runPromise(f.machine.setConnection(true));
	await expect(f.start(key.token)).resolves.toMatchObject({ status: 'completed' });
	f.revoke();
	await expect(f.start(key.token)).rejects.toThrow(/Invalid or expired/);
});

it('a disconnected HTTP waiter does not cancel process-owned execution', async () => {
	const f = await fixture();
	const key = await f.runtime.runPromise(f.catalog.issueKey('owner', 0, 'Print', true));
	const abort = new AbortController();
	const waiting = f.runtime
		.runPromise(f.service.start(key.token, f.file.name), { signal: abort.signal })
		.catch(() => null);
	await expect
		.poll(async () =>
			(await f.runtime.runPromise(f.store.list)).some((a) => a.label.startsWith('Start'))
		)
		.toBe(true);
	abort.abort();
	await waiting;
	const retried = await f.start(key.token);
	expect(retried.status).toBe('completed');
	expect(
		(await f.runtime.runPromise(f.store.list)).filter((a) => a.label.startsWith('Start'))
	).toHaveLength(1);
});
