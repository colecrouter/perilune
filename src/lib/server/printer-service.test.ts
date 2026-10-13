import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { PrinterService, PrinterServiceLive } from './printer-service.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function create(filename = ':memory:') {
	const runtime = ManagedRuntime.make(
		PrinterServiceLive.pipe(Layer.provide(SqliteClient.layer({ filename })))
	);
	cleanups.push(() => runtime.dispose());
	const service = await runtime.runPromise(PrinterService);
	return {
		runtime,
		service,
		snapshot: () => runtime.runPromise(SubscriptionRef.get(service.state))
	};
}

describe('process-owned action service', () => {
	it('deduplicates simultaneous retries and rejects conflicting reuse', async () => {
		const { runtime, service, snapshot } = await create();
		const request = { id: randomUUID(), command: { type: 'pause' as const } };
		await Promise.all([
			runtime.runPromise(service.submit(request)),
			runtime.runPromise(service.submit(request))
		]);
		expect((await snapshot()).actions).toHaveLength(1);
		await expect(
			runtime.runPromise(service.submit({ ...request, command: { type: 'resume' } }))
		).rejects.toThrow('different command');
		await expect.poll(async () => (await snapshot()).actions[0]?.status).toBe('completed');
		expect((await snapshot()).job.state).toBe('paused');
	});
	it('serializes conflicting commands from multiple users', async () => {
		const { runtime, service, snapshot } = await create();
		await Promise.all(
			[1, 2].map(() =>
				runtime.runPromise(service.submit({ id: randomUUID(), command: { type: 'pause' } }))
			)
		);
		await expect
			.poll(
				async () =>
					(await snapshot()).actions.filter(
						(action) => action.status === 'queued' || action.status === 'sending'
					).length
			)
			.toBe(0);
		expect((await snapshot()).actions.map((action) => action.status).sort()).toEqual([
			'completed',
			'failed'
		]);
	});
	it('keeps a queued target through disconnect and shares it with subscribers', async () => {
		const { runtime, service, snapshot } = await create();
		await runtime.runPromise(service.setConnection(false));
		await runtime.runPromise(
			service.submit({
				id: randomUUID(),
				command: { type: 'temperature', heater: 'bed', target: 75 }
			})
		);
		expect((await snapshot()).actions[0]?.status).toBe('queued');
		expect((await snapshot()).heaters.bed.target).toBe(60);
		await runtime.runPromise(service.setConnection(true));
		await expect.poll(async () => (await snapshot()).heaters.bed.target).toBe(75);
	});
	it('does not retry an action whose connection drops while sending', async () => {
		const { runtime, service, snapshot } = await create();
		await runtime.runPromise(service.submit({ id: randomUUID(), command: { type: 'pause' } }));
		await expect
			.poll(async () => (await snapshot()).actions[0]?.status, { interval: 10 })
			.toBe('sending');
		await runtime.runPromise(service.setConnection(false));
		await expect.poll(async () => (await snapshot()).actions[0]?.status).toBe('unknown');
		await runtime.runPromise(service.setConnection(true));
		expect((await snapshot()).job.state).toBe('printing');
	});
	it('recovers unfinished records after restart without replaying them', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'perilune-test-'));
		cleanups.push(() => rm(directory, { recursive: true, force: true }));
		const filename = join(directory, 'state.sqlite');
		const first = await create(filename);
		await first.runtime.runPromise(first.service.setConnection(false));
		const request = { id: randomUUID(), command: { type: 'pause' as const } };
		await first.runtime.runPromise(first.service.submit(request));
		await first.runtime.dispose();
		const second = await create(filename);
		expect((await second.snapshot()).actions[0]?.status).toBe('unknown');
		const retry = await second.runtime.runPromise(second.service.submit(request));
		expect(retry.status).toBe('unknown');
		expect((await second.snapshot()).job.state).toBe('printing');
	});
	it('bounds queue growth while disconnected', async () => {
		const { runtime, service } = await create();
		await runtime.runPromise(service.setConnection(false));
		for (let i = 0; i < 20; i++)
			await runtime.runPromise(service.submit({ id: randomUUID(), command: { type: 'pause' } }));
		await expect(
			runtime.runPromise(service.submit({ id: randomUUID(), command: { type: 'pause' } }))
		).rejects.toThrow('queue is full');
	});
});
