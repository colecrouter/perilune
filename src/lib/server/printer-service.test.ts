import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { Effect, Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import { ConnectionError, SqlError } from 'effect/sql/SqlError';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { ActionStore, ActionStoreLive } from './action-store.js';
import { PrinterService, PrinterServiceLive, makePrinterService } from './printer-service.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function create(
	filename = ':memory:',
	wrap?: (store: typeof ActionStore.Service) => typeof ActionStore.Service,
	mode: 'simulator' | 'moonraker' = 'simulator'
) {
	const storeLayer = wrap
		? Layer.effect(ActionStore, Effect.map(ActionStore, wrap)).pipe(Layer.provide(ActionStoreLive))
		: ActionStoreLive;
	const runtime = ManagedRuntime.make(
		(mode === 'simulator' ? PrinterServiceLive : makePrinterService(mode)).pipe(
			Layer.provideMerge(storeLayer),
			Layer.provide(SqliteClient.layer({ filename }))
		)
	);
	cleanups.push(() => runtime.dispose());
	const service = await runtime.runPromise(PrinterService);
	return {
		runtime,
		service,
		store: await runtime.runPromise(ActionStore),
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
	it('rejects a temperature target submitted while disconnected', async () => {
		const { runtime, service, snapshot } = await create();
		await runtime.runPromise(service.setConnection(false));
		await expect(
			runtime.runPromise(
				service.submit({
					id: randomUUID(),
					command: { type: 'temperature', heater: 'bed', target: 75 }
				})
			)
		).rejects.toThrow('reconnect');
		expect((await snapshot()).heaters.bed.target).toBe(60);
		expect((await snapshot()).actions).toHaveLength(0);
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
	it('remembers brief disconnects that recover during sending', async () => {
		const { runtime, service, snapshot } = await create();
		await runtime.runPromise(service.submit({ id: randomUUID(), command: { type: 'pause' } }));
		await expect
			.poll(async () => (await snapshot()).actions[0]?.status, { interval: 10 })
			.toBe('sending');
		await runtime.runPromise(service.setConnection(false));
		await runtime.runPromise(service.setConnection(true));
		await expect.poll(async () => (await snapshot()).actions[0]?.status).toBe('unknown');
		expect((await snapshot()).job.state).toBe('printing');
	});
	it('rechecks expiry immediately before applying a command', async () => {
		const { runtime, service, snapshot } = await create();
		await runtime.runPromise(service.submit({ id: randomUUID(), command: { type: 'pause' } }));
		await expect
			.poll(async () => (await snapshot()).actions[0]?.status, { interval: 10 })
			.toBe('sending');
		const now = Date.now.bind(Date);
		const clock = vi.spyOn(Date, 'now').mockImplementation(() => now() + 31_000);
		try {
			await expect.poll(async () => (await snapshot()).actions[0]?.status).toBe('failed');
			expect((await snapshot()).job.state).toBe('printing');
			expect((await snapshot()).actions[0]?.message).toContain('expired');
		} finally {
			clock.mockRestore();
		}
	});
	it('preserves concurrent connection and telemetry changes across terminal persistence', async () => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const { runtime, service, snapshot } = await create(':memory:', (store) => ({
			...store,
			setStatus: (id, status, message) =>
				status === 'completed'
					? Effect.gen(function* () {
							entered.resolve();
							yield* Effect.promise(() => release.promise);
							yield* store.setStatus(id, status, message);
						})
					: store.setStatus(id, status, message)
		}));
		await runtime.runPromise(service.submit({ id: randomUUID(), command: { type: 'pause' } }));
		await entered.promise;
		const disconnected = runtime.runPromise(service.setConnection(false));
		const telemetry = runtime.runPromise(
			SubscriptionRef.update(service.state, (current) => ({
				...current,
				heaters: { ...current.heaters, nozzle: { ...current.heaters.nozzle, current: 199 } }
			}))
		);
		release.resolve();
		await Promise.all([disconnected, telemetry]);
		const result = await snapshot();
		expect(result.connection).toBe('disconnected');
		expect(result.heaters.nozzle.current).toBe(199);
		expect(result.job.state).toBe('paused');
		expect(result.actions[0]?.status).toBe('completed');
	});
	it('settles storage failures visibly and recovers status writes without replay', async () => {
		let outage = false;
		let failCompletion = true;
		const failure = new SqlError({
			reason: new ConnectionError({ cause: 'injected storage outage' })
		});
		const { runtime, service, store, snapshot } = await create(':memory:', (actual) => ({
			...actual,
			probe: Effect.suspend(() => (outage ? Effect.fail(failure) : actual.probe)),
			setStatus: (id, status, message) =>
				Effect.suspend(() => {
					if (status === 'completed' && failCompletion) {
						failCompletion = false;
						outage = true;
					}
					return outage ? Effect.fail(failure) : actual.setStatus(id, status, message);
				})
		}));
		const request = { id: randomUUID(), command: { type: 'pause' as const } };
		await runtime.runPromise(service.submit(request));
		await expect.poll(async () => (await snapshot()).storage).toBe('degraded');
		expect((await snapshot()).actions[0]?.status).toBe('unknown');
		await expect(
			runtime.runPromise(service.submit({ id: randomUUID(), command: { type: 'pause' } }))
		).rejects.toThrow('recovering');
		outage = false;
		await expect.poll(async () => (await snapshot()).storage).toBe('healthy');
		expect((await runtime.runPromise(store.find(request.id)))?.action.status).toBe('unknown');
		expect((await runtime.runPromise(service.submit(request))).status).toBe('unknown');
		expect((await snapshot()).job.state).toBe('printing');
	});
});

describe('live read-only printer service', () => {
	it('starts without fabricated values and rejects every physical command', async () => {
		const { runtime, service, snapshot } = await create(':memory:', undefined, 'moonraker');
		expect((await snapshot()).heaters.bed.current).toBeNull();
		expect((await snapshot()).job.state).toBe('unknown');
		for (const command of [
			{ type: 'pause' },
			{ type: 'resume' },
			{ type: 'cancel', coolBed: true, coolNozzle: true },
			{ type: 'temperature', heater: 'bed', target: 60 }
		] as const) {
			await expect(
				runtime.runPromise(service.submit({ id: randomUUID(), command }))
			).rejects.toThrow('read-only');
		}
		expect((await snapshot()).actions).toHaveLength(0);
	});
	it('preserves last telemetry during reconnection and ignores simulator controls', async () => {
		const { runtime, service, snapshot } = await create(':memory:', undefined, 'moonraker');
		const telemetry = {
			connection: 'connected',
			klippy: 'ready',
			telemetryAt: Date.now(),
			availableObjects: ['heater_bed'],
			job: { ...(await snapshot()).job, state: 'standby' },
			heaters: { nozzle: { current: null, target: null }, bed: { current: 42, target: 0 } }
		} as const;
		await runtime.runPromise(
			service.ingest({ ...telemetry, availableObjects: [...telemetry.availableObjects] })
		);
		await runtime.runPromise(
			service.ingest({
				...telemetry,
				availableObjects: [...telemetry.availableObjects],
				connection: 'reconnecting',
				klippy: 'unknown'
			})
		);
		await runtime.runPromise(service.reset);
		await runtime.runPromise(service.setConnection(true));
		const result = await snapshot();
		expect(result.connection).toBe('reconnecting');
		expect(result.heaters.bed.current).toBe(42);
		expect(result.connectionGeneration).toBe(2);
	});
});

describe('shared motion reservation', () => {
	it('accepts one conflicting move, deduplicates its retry, and rejects a second user', async () => {
		const { runtime, service, snapshot } = await create();
		await runtime.runPromise(
			SubscriptionRef.update(service.state, (state) => ({
				...state,
				job: { ...state.job, state: 'cancelled' as const }
			}))
		);
		const request = {
			id: randomUUID(),
			command: { type: 'move', target: { x: 0 }, expectedPosition: { x: 110, y: 110, z: 20 } }
		} as const;
		await runtime.runPromise(service.submit(request));
		expect((await runtime.runPromise(service.submit(request))).id).toBe(request.id);
		await expect(
			runtime.runPromise(service.submit({ ...request, id: randomUUID() }))
		).rejects.toThrow('pending');
		await expect.poll(async () => (await snapshot()).actions[0]?.status).toBe('completed');
		expect((await snapshot()).motion.position).toEqual({ x: 0, y: 110, z: 20 });
	});
	it('rechecks busy state at execution instead of applying an accepted unsafe move', async () => {
		const { runtime, service, snapshot } = await create();
		await runtime.runPromise(
			SubscriptionRef.update(service.state, (state) => ({
				...state,
				job: { ...state.job, state: 'cancelled' as const }
			}))
		);
		await runtime.runPromise(
			service.submit({
				id: randomUUID(),
				command: { type: 'move', target: { x: 0 }, expectedPosition: { x: 110, y: 110, z: 20 } }
			})
		);
		await expect
			.poll(async () => (await snapshot()).actions[0]?.status, { interval: 10 })
			.toBe('sending');
		await runtime.runPromise(
			SubscriptionRef.update(service.state, (state) => ({
				...state,
				motion: { ...state.motion, calibration: true }
			}))
		);
		await expect.poll(async () => (await snapshot()).actions[0]?.status).toBe('failed');
		expect((await snapshot()).motion.position.x).toBe(110);
	});
});

it('samples temperature history without browser subscriptions and retains disconnect gaps', async () => {
	const { runtime, service } = await create();
	const history = () => runtime.runPromise(SubscriptionRef.get(service.temperatureHistory));
	await expect.poll(async () => (await history()).length).toBe(1);
	await runtime.runPromise(service.setConnection(false));
	await expect.poll(async () => (await history()).length, { timeout: 7000 }).toBe(3);
	const samples = await history();
	expect(samples[0].readings.extruder.current).not.toBeNull();
	expect(samples[1].readings.extruder.current).toBeNull();
}, 10000);
it('rechecks heater readiness at execution and publishes a failed outcome', async () => {
	const { runtime, service, snapshot } = await create();
	await runtime.runPromise(
		service.submit({
			id: randomUUID(),
			command: { type: 'temperature', heater: 'bed', target: 80 }
		})
	);
	await expect
		.poll(async () => (await snapshot()).actions[0]?.status, { interval: 10 })
		.toBe('sending');
	await runtime.runPromise(
		SubscriptionRef.update(service.state, (s) => ({ ...s, klippy: 'shutdown' as const }))
	);
	await expect.poll(async () => (await snapshot()).actions[0]?.status).toBe('failed');
	expect((await snapshot()).heaters.bed.target).toBe(60);
});

it('records short disconnects even between scheduled temperature samples', async () => {
	const { runtime, service } = await create();
	const history = () => runtime.runPromise(SubscriptionRef.get(service.temperatureHistory));
	await expect.poll(async () => (await history()).length).toBe(1);
	await runtime.runPromise(service.setConnection(false));
	await expect.poll(async () => (await history()).at(-1)?.readings.extruder.current).toBeNull();
	await runtime.runPromise(service.setConnection(true));
	await expect.poll(async () => (await history()).at(-1)?.readings.extruder.current).not.toBeNull();
	expect((await history()).some((s) => s.readings.extruder.current === null)).toBe(true);
});

it('binds basic command deduplication to its operator and rechecks authorization at execution', async () => {
	const { runtime, service, snapshot, store } = await create();
	let authorized = true;
	const actor = {
		id: 'operator',
		name: 'Operator',
		role: 'operator' as const,
		authorized: () => authorized
	};
	const request = { id: randomUUID(), command: { type: 'pause' as const } };
	await runtime.runPromise(service.submit(request, actor));
	expect((await runtime.runPromise(store.find(request.id)))?.actorId).toBe(actor.id);
	await expect(
		runtime.runPromise(service.submit(request, { ...actor, id: 'other' }))
	).rejects.toThrow('different command');
	authorized = false;
	await expect.poll(async () => (await snapshot()).actions[0]?.status).toBe('failed');
	expect((await snapshot()).job.state).toBe('printing');
	await expect(
		runtime.runPromise(
			service.submit(
				{ id: randomUUID(), command: { type: 'pause' } },
				{
					...actor,
					authorized: () => {
						throw new Error('closed auth');
					}
				}
			)
		)
	).rejects.toThrow('no longer authorized');
});
