import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';
import { Effect, Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { SqlClient } from 'effect/sql/SqlClient';
import { ConsoleService, ConsoleServiceLive } from './console-service.js';
import { PrinterService, PrinterServiceLive, makePrinterService } from './printer-service.js';
import { ActionStoreLive } from './action-store.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture(live = false, filename = ':memory:') {
	const db = SqliteClient.layer({ filename });
	const printer = (live ? makePrinterService('moonraker') : PrinterServiceLive).pipe(
		Layer.provide(ActionStoreLive.pipe(Layer.provide(db)))
	);
	const runtime = ManagedRuntime.make(
		ConsoleServiceLive.pipe(Layer.provideMerge(printer), Layer.provideMerge(db))
	);
	cleanups.push(() => runtime.dispose());
	const service = await runtime.runPromise(ConsoleService);
	const printerService = await runtime.runPromise(PrinterService);
	let valid = true;
	const actor = { id: 'operator', authorized: () => valid };
	return {
		runtime,
		service,
		printer: printerService,
		actor,
		revoke: () => {
			valid = false;
		},
		read: () => runtime.runPromise(SubscriptionRef.get(service.state)),
		submit: (id = randomUUID(), script = 'M105') =>
			runtime.runPromise(service.submit(id, script, actor))
	};
}
it('deduplicates admission across retries and rejects ID reuse by another actor or payload', async () => {
	const f = await fixture();
	const id = randomUUID();
	await Promise.all([f.submit(id), f.submit(id)]);
	expect((await f.read()).receipts).toHaveLength(1);
	await expect(f.submit(id, 'M114')).rejects.toThrow(/different submission/);
	await expect(
		f.runtime.runPromise(f.service.submit(id, 'M105', { id: 'other', authorized: () => true }))
	).rejects.toThrow(/different submission/);
	await expect.poll(async () => (await f.read()).receipts[0]?.status).toBe('completed');
	expect((await f.read()).receipts[0]?.output[0]).toContain('Simulator');
});
it('rechecks revocation and connection generation at execution rather than retrying', async () => {
	const f = await fixture();
	await f.submit();
	await expect.poll(async () => (await f.read()).receipts[0]?.status).toBe('sending');
	f.revoke();
	await expect.poll(async () => (await f.read()).receipts[0]?.status).toBe('failed');
	const other = await fixture();
	await other.submit();
	await expect.poll(async () => (await other.read()).receipts[0]?.status).toBe('sending');
	await other.runtime.runPromise(other.printer.setConnection(false));
	await expect.poll(async () => (await other.read()).receipts[0]?.status).toBe('unknown');
	await other.runtime.runPromise(other.printer.setConnection(true));
	expect((await other.read()).receipts[0]?.status).toBe('unknown');
});
it('enforces live read-only mode and records unsupported command failure without printer mutation', async () => {
	const live = await fixture(true);
	await expect(live.submit()).rejects.toThrow(/Live command/);
	const f = await fixture();
	const before = await f.runtime.runPromise(SubscriptionRef.get(f.printer.state));
	await f.submit(randomUUID(), 'G28');
	await expect.poll(async () => (await f.read()).receipts[0]?.status).toBe('failed');
	expect((await f.runtime.runPromise(SubscriptionRef.get(f.printer.state))).motion).toEqual(
		before.motion
	);
});
it('bounds the queue, expires waiting commands and stores per-account shortcuts', async () => {
	const f = await fixture();
	for (let i = 0; i < 20; i++) await f.submit();
	await expect(f.submit()).rejects.toThrow(/full/);
	const sql = await f.runtime.runPromise(SqlClient);
	await f.runtime.runPromise(sql`UPDATE console_commands SET created=0 WHERE status='queued'`);
	await expect
		.poll(async () => (await f.read()).receipts.some((r) => r.message?.includes('expired')))
		.toBe(true);
	await f.runtime.runPromise(f.service.pin('PERILUNE_STATUS', true, f.actor));
	expect(await f.runtime.runPromise(f.service.pins(f.actor))).toEqual(['PERILUNE_STATUS']);
	expect(
		await f.runtime.runPromise(f.service.pins({ id: 'another', authorized: () => true }))
	).toEqual([]);
});
it('keeps receipts and shortcuts after restart without replaying in-flight commands', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'perilune-console-'));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	const filename = join(directory, 'state.sqlite');
	const first = await fixture(false, filename);
	const id = randomUUID();
	await first.runtime.runPromise(first.service.pin('PERILUNE_STATUS', true, first.actor));
	await first.submit(id, 'HELP');
	await expect.poll(async () => (await first.read()).receipts[0]?.status).toBe('sending');
	await first.runtime.dispose();
	const second = await fixture(false, filename);
	expect((await second.submit(id, 'HELP')).status).toBe('unknown');
	expect(await second.runtime.runPromise(second.service.pins(second.actor))).toEqual([
		'PERILUNE_STATUS'
	]);
	await new Promise((resolve) => setTimeout(resolve, 800));
	expect((await second.read()).receipts[0]?.status).toBe('unknown');
});
it('a throwing authorization callback cannot kill the execution worker', async () => {
	const f = await fixture();
	let throwing = false;
	const actor = {
		id: 'throwing',
		authorized: () => {
			if (throwing) throw new Error('auth database unavailable');
			return true;
		}
	};
	await f.runtime.runPromise(f.service.submit(randomUUID(), 'HELP', actor));
	await expect.poll(async () => (await f.read()).receipts[0]?.status).toBe('sending');
	throwing = true;
	await expect.poll(async () => (await f.read()).receipts[0]?.status).toBe('failed');
	const next = await f.submit();
	await expect
		.poll(async () => (await f.runtime.runPromise(f.service.find(next.id, f.actor)))?.status)
		.toBe('completed');
});
