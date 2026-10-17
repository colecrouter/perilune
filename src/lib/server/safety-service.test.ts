import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vite-plus/test';
import { Effect, Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { SqlClient } from 'effect/sql/SqlClient';
import { ActionStoreLive } from './action-store.js';
import { makePrinterService, PrinterService } from './printer-service.js';
import {
	MoonrakerConfig,
	MoonrakerService,
	emptyMoonrakerSnapshot,
	MoonrakerCommandError,
	type MoonrakerSnapshot
} from './moonraker.js';
import { SafetyService, SafetyServiceLive, SafetySettings } from './safety-service.js';
import { printerAdmission, printerInterlock } from './printer-admission.js';
import type { SafetyRequest } from '#lib/domain/safety.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
const owner = { id: 'owner', name: 'Owner', role: 'owner', authorized: () => true };
async function fixture() {
	const state = await Effect.runPromise(
		SubscriptionRef.make<MoonrakerSnapshot>({
			...emptyMoonrakerSnapshot(),
			connection: 'connected',
			klippy: 'ready' as const,
			telemetryReady: true,
			generation: 1,
			availableObjects: ['extruder', 'heater_bed'],
			job: {
				...emptyMoonrakerSnapshot().job,
				state: 'printing',
				filename: 'sample.gcode',
				runId: randomUUID()
			},
			heaters: { bed: { current: 25, target: 60 }, nozzle: { current: 25, target: 200 } },
			motion: { ...emptyMoonrakerSnapshot().motion, busy: false, calibration: false }
		})
	);
	const paths: string[] = [];
	let behavior: 'normal' | 'drop' | 'partial' | 'stuck' = 'normal',
		refreshHook: (() => Promise<void>) | undefined;
	const server = createServer(async (req, res) => {
		const path = req.url!;
		if (req.method === 'POST') paths.push(path);
		if (path === '/printer/emergency_stop') {
			await Effect.runPromise(
				SubscriptionRef.update(state, (s) => ({
					...s,
					klippy: 'shutdown' as const,
					telemetryReady: false,
					generation: s.generation + 1
				}))
			);
		}
		if (path === '/printer/firmware_restart' && behavior !== 'stuck')
			await Effect.runPromise(
				SubscriptionRef.update(state, (s) => ({
					...s,
					klippy: 'ready' as const,
					telemetryReady: true,
					generation: s.generation + 1,
					job: { ...s.job, state: 'standby' as const },
					heaters: {
						bed: { ...s.heaters.bed, target: 0 },
						nozzle: { ...s.heaters.nozzle, target: behavior === 'partial' ? 200 : 0 }
					}
				}))
			);
		if (path === '/printer/print/cancel')
			await Effect.runPromise(
				SubscriptionRef.update(state, (s) => ({
					...s,
					job: { ...s.job, state: 'cancelled' as const }
				}))
			);

		if (path === '/printer/gcode/script') {
			const chunks: Uint8Array[] = [];
			for await (const chunk of req) chunks.push(chunk);
			const body = JSON.parse(Buffer.concat(chunks).toString());
			if (body.script === 'ABORT')
				await Effect.runPromise(
					SubscriptionRef.update(state, (s) => ({
						...s,
						motion: { ...s.motion, calibration: false }
					}))
				);
			else
				await Effect.runPromise(
					SubscriptionRef.update(state, (s) => ({
						...s,
						heaters: {
							bed: { ...s.heaters.bed, target: 0 },
							nozzle: { ...s.heaters.nozzle, target: behavior === 'partial' ? 200 : 0 }
						}
					}))
				);
		}

		if (req.method === 'POST' && behavior === 'drop') {
			req.socket.destroy();
			return;
		}
		res.setHeader('Content-Type', 'application/json');
		res.end(
			JSON.stringify({
				result:
					path === '/printer/info'
						? { state: (await Effect.runPromise(SubscriptionRef.get(state))).klippy }
						: 'ok'
			})
		);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw Error('fixture');
	const url = `ws://127.0.0.1:${address.port}/websocket`;
	cleanup.push(
		() =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			})
	);
	const db = SqliteClient.layer({ filename: ':memory:' }),
		store = ActionStoreLive.pipe(Layer.provide(db)),
		printer = makePrinterService('moonraker').pipe(Layer.provideMerge(store));
	const transport = Layer.succeed(MoonrakerService, {
		state,
		command: () => Effect.void,
		refresh: (generation) =>
			Effect.gen(function* () {
				if (refreshHook) yield* Effect.promise(refreshHook);
				const s = yield* SubscriptionRef.get(state);
				if (s.generation !== generation)
					return yield* Effect.fail(new MoonrakerCommandError({ sent: false }));
				return s;
			})
	});
	const runtime = ManagedRuntime.make(
		SafetyServiceLive.pipe(
			Layer.provide(
				Layer.succeed(SafetySettings, {
					enabled: true,
					observationMs: 25,
					restartObservationMs: 30,
					pollMs: 2
				})
			),
			Layer.provide(Layer.succeed(MoonrakerConfig, { url, requestTimeoutMs: 100 })),
			Layer.provideMerge(transport),
			Layer.provideMerge(printer),
			Layer.provideMerge(db)
		)
	);
	cleanup.push(() => runtime.dispose());
	const safety = await runtime.runPromise(SafetyService),
		p = await runtime.runPromise(PrinterService),
		recoveryId = randomUUID();
	await runtime.runPromise(
		SubscriptionRef.update(p.state, (s) => ({
			...s,
			liveRecovery: {
				id: recoveryId,
				label: 'Original action',
				message: 'Original unknown',
				createdAt: Date.now()
			}
		}))
	);
	const snapshot = () => runtime.runPromise(SubscriptionRef.get(p.state));
	const submit = (
		operation: SafetyRequest['operation'],
		id: string = randomUUID(),
		actor = owner
	) => runtime.runPromise(safety.submit({ id, confirmed: true, operation }, actor));
	const finished = async (id: string) => {
		await expect
			.poll(async () => (await snapshot()).safety?.actions.find((a) => a.id === id)?.status)
			.toMatch(/completed|failed|unknown/);
		return runtime.runPromise(safety.receipt(id, owner));
	};
	return {
		runtime,
		safety,
		printer: p,
		state,
		paths,
		snapshot,
		recoveryId,
		submit,
		finished,
		url,
		setBehavior: (b: typeof behavior) => {
			behavior = b;
		},
		hook: (h: typeof refreshHook) => {
			refreshHook = h;
		}
	};
}
it('stops only the explicitly bound job, deduplicates independently and preserves original recovery', async () => {
	const f = await fixture(),
		job = await Effect.runPromise(SubscriptionRef.get(f.state)),
		op = {
			type: 'stop' as const,
			recoveryOf: f.recoveryId,
			expectedJob: { filename: job.job.filename!, runId: job.job.runId! }
		},
		id = randomUUID();
	await f.submit(op, id);
	expect((await f.finished(id)).observed).toBe(true);
	await f.submit(op, id);
	expect(f.paths).toEqual(['/printer/print/cancel']);
	expect((await f.snapshot()).liveRecovery?.id).toBe(f.recoveryId);
	await expect(f.submit(op, id, { ...owner, id: 'other' })).rejects.toThrow(
		/another request or account/
	);
	await expect(f.submit({ type: 'cooldown', recoveryOf: f.recoveryId }, id)).rejects.toThrow(
		/another request or account/
	);
});
it('rejects stale jobs before dispatch and reports partial cooldown as acknowledged but unknown', async () => {
	const f = await fixture();
	const stale = await f.submit({
		type: 'stop',
		recoveryOf: f.recoveryId,
		expectedJob: { filename: 'old.gcode', runId: randomUUID() }
	});
	expect((await f.finished(stale.id)).status).toBe('failed');
	expect(f.paths).toEqual([]);
	f.setBehavior('partial');
	const action = await f.submit({ type: 'cooldown', recoveryOf: f.recoveryId });
	const record = await f.finished(action.id);
	expect(record).toMatchObject({ status: 'unknown', acknowledged: true, observed: false });
	expect((await f.snapshot()).liveRecovery?.id).toBe(f.recoveryId);
});
it('does not replay a dropped safety acknowledgement', async () => {
	const f = await fixture();
	f.setBehavior('drop');
	const op = { type: 'cooldown' as const, recoveryOf: f.recoveryId },
		record = await f.submit(op);
	expect((await f.finished(record.id)).status).toBe('unknown');
	await f.submit(op, record.id);
	expect(f.paths).toEqual(['/printer/gcode/script']);
});
it('emergency bypasses ordinary admission and unavailable WebSocket readiness, latching other workers', async () => {
	const f = await fixture();
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const normal = f.runtime.runPromise(
		printerAdmission(f.printer.state).withPermits(1)(Effect.promise(() => held))
	);
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			connection: 'reconnecting' as const,
			telemetryReady: false
		}))
	);
	const record = await f.submit({ type: 'emergency' });
	expect(printerInterlock(f.printer.state).halted).toBe(true);
	expect(await f.finished(record.id)).toMatchObject({
		status: 'completed',
		acknowledged: true,
		observed: true
	});
	expect(f.paths).toEqual(['/printer/emergency_stop']);
	release();
	await normal;
	expect((await f.snapshot()).liveRecovery?.id).toBe(f.recoveryId);
});

it('hazard review works offline, is durable and does not restart or unlock controls', async () => {
	const f = await fixture(),
		emergency = await f.submit({ type: 'emergency' });
	await f.finished(emergency.id);
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({ ...s, connection: 'reconnecting' as const }))
	);
	await f.runtime.runPromise(f.safety.acknowledge(emergency.id, owner));
	const current = await f.snapshot();
	expect(current.safety?.halted).toBe(true);
	expect(current.safety?.recovery?.reviewedAt).toBeTypeOf('number');
	expect(f.paths).toEqual(['/printer/emergency_stop']);
	const sql = await f.runtime.runPromise(SqlClient);
	const row = await f.runtime.runPromise(
		sql<{ hazard_reviewed_at: number }>`SELECT hazard_reviewed_at FROM printer_safety_state`
	);
	expect(row[0].hazard_reviewed_at).toBe(current.safety?.recovery?.reviewedAt);
	await expect(f.runtime.runPromise(f.safety.verify(emergency.id, owner))).rejects.toThrow();
});
it('review then explicit restart verifies new ready telemetry before unlocking, without clearing live recovery', async () => {
	const f = await fixture(),
		emergency = await f.submit({ type: 'emergency' });
	await f.finished(emergency.id);
	await expect(f.submit({ type: 'restart', recoveryOf: emergency.id })).rejects.toThrow(
		/hazard review/
	);
	await f.runtime.runPromise(f.safety.acknowledge(emergency.id, owner));
	const restart = await f.submit({ type: 'restart', recoveryOf: emergency.id });
	expect((await f.finished(restart.id)).status).toBe('completed');
	await expect.poll(async () => (await f.snapshot()).safety?.halted).toBe(false);
	expect((await f.snapshot()).liveRecovery?.id).toBe(f.recoveryId);
	expect(f.paths).toEqual(['/printer/emergency_stop', '/printer/firmware_restart']);
	const duplicate = await f.submit({ type: 'restart', recoveryOf: emergency.id }, restart.id);
	expect(duplicate.id).toBe(restart.id);
	expect(f.paths.length).toBe(2);
});
it('lost restart acknowledgement stays locked, cannot be replayed, and supports explicit read-only verification', async () => {
	const f = await fixture(),
		emergency = await f.submit({ type: 'emergency' });
	await f.finished(emergency.id);
	await f.runtime.runPromise(f.safety.acknowledge(emergency.id, owner));
	f.setBehavior('drop');
	const restart = await f.submit({ type: 'restart', recoveryOf: emergency.id });
	expect((await f.finished(restart.id)).status).toBe('unknown');
	expect((await f.snapshot()).safety?.halted).toBe(true);
	await expect(f.submit({ type: 'restart', recoveryOf: emergency.id })).rejects.toThrow(
		/already submitted/
	);
	await f.runtime.runPromise(f.safety.verify(emergency.id, owner));
	expect((await f.snapshot()).safety?.halted).toBe(false);
	expect((await f.runtime.runPromise(f.safety.receipt(restart.id, owner))).reviewedAt).toBeTypeOf(
		'number'
	);
	expect(f.paths.filter((p) => p === '/printer/firmware_restart')).toHaveLength(1);
});
it.each(['partial', 'stuck'] as const)(
	'restart %s observation does not release the interlock',
	async (behavior) => {
		const f = await fixture(),
			emergency = await f.submit({ type: 'emergency' });
		await f.finished(emergency.id);
		await f.runtime.runPromise(f.safety.acknowledge(emergency.id, owner));
		f.setBehavior(behavior);
		const restart = await f.submit({ type: 'restart', recoveryOf: emergency.id });
		expect((await f.finished(restart.id)).status).toBe('unknown');
		expect((await f.snapshot()).safety?.halted).toBe(true);
		await expect(f.runtime.runPromise(f.safety.verify(emergency.id, owner))).rejects.toThrow();
	}
);
it('new emergency invalidates a saved hazard review and rejects stale tokens', async () => {
	const f = await fixture(),
		first = await f.submit({ type: 'emergency' });
	await f.finished(first.id);
	await f.runtime.runPromise(f.safety.acknowledge(first.id, owner));
	const second = await f.submit({ type: 'emergency' });
	await f.finished(second.id);
	expect((await f.snapshot()).safety?.recovery?.reviewedAt).toBeNull();
	await expect(f.submit({ type: 'restart', recoveryOf: first.id })).rejects.toThrow(
		/hazard review/
	);
	await expect(f.runtime.runPromise(f.safety.acknowledge(first.id, owner))).rejects.toThrow(
		/changed/
	);
	await expect(f.runtime.runPromise(f.safety.verify(second.id, owner))).rejects.toThrow(/review/);
});
it('owner authorization is required for offline review and rechecked before restart dispatch', async () => {
	const f = await fixture(),
		emergency = await f.submit({ type: 'emergency' });
	await f.finished(emergency.id);
	await expect(
		f.runtime.runPromise(f.safety.acknowledge(emergency.id, { ...owner, role: 'operator' }))
	).rejects.toThrow(/owner/);
	await f.runtime.runPromise(f.safety.acknowledge(emergency.id, owner));
	let allowed = true;
	const restart = await f.submit({ type: 'restart', recoveryOf: emergency.id }, randomUUID(), {
		...owner,
		authorized: () => allowed
	});
	allowed = false;
	expect((await f.finished(restart.id)).status).toBe('failed');
	expect(f.paths.filter((p) => p === '/printer/firmware_restart')).toHaveLength(0);
});
it('unrelated uncertain safety outcomes survive the emergency recovery flow', async () => {
	const f = await fixture();
	f.setBehavior('drop');
	const unknown = await f.submit({ type: 'cooldown', recoveryOf: f.recoveryId });
	await f.finished(unknown.id);
	f.setBehavior('normal');
	const emergency = await f.submit({ type: 'emergency' });
	await f.finished(emergency.id);
	await f.runtime.runPromise(f.safety.acknowledge(emergency.id, owner));
	const restart = await f.submit({ type: 'restart', recoveryOf: emergency.id });
	await f.finished(restart.id);
	await expect.poll(async () => (await f.snapshot()).safety?.halted).toBe(false);
	expect((await f.runtime.runPromise(f.safety.receipt(unknown.id, owner))).reviewedAt).toBeNull();
});
it('revoked authorization at execution prevents physical dispatch', async () => {
	const f = await fixture();
	let allowed = true;
	const record = await f.submit({ type: 'cooldown', recoveryOf: f.recoveryId }, randomUUID(), {
		...owner,
		authorized: () => allowed
	});
	allowed = false;
	expect((await f.finished(record.id)).status).toBe('failed');
	expect(f.paths).toEqual([]);
});
it('startup marks durable pending receipts unknown without replay and restores the emergency latch', async () => {
	const f = await fixture();
	const sql = await f.runtime.runPromise(SqlClient),
		target = createHash('sha256').update(f.url).digest('hex'),
		id = randomUUID();
	await f.runtime.runPromise(
		sql`INSERT INTO safety_actions(id,target,actor,payload,record) VALUES(${id},${target},'owner','{}',${JSON.stringify({ id, label: 'Emergency stop', kind: 'emergency', status: 'sending', createdAt: Date.now(), message: null, acknowledged: false, observed: false, reviewedAt: null })})`
	);
	await f.runtime.runPromise(sql`UPDATE printer_safety_state SET halted=1 WHERE target=${target}`);
	// A second scoped worker models startup against the same durable database, with no queued in-memory work.
	const db = Layer.succeed(SqlClient, sql),
		p = Layer.succeed(PrinterService, f.printer),
		transport = Layer.succeed(MoonrakerService, {
			state: f.state,
			command: () => Effect.void,
			refresh: () => SubscriptionRef.get(f.state)
		});
	const restart = ManagedRuntime.make(
		SafetyServiceLive.pipe(
			Layer.provide(db),
			Layer.provide(p),
			Layer.provide(transport),
			Layer.provide(Layer.succeed(MoonrakerConfig, { url: f.url })),
			Layer.provide(Layer.succeed(SafetySettings, { enabled: true }))
		)
	);
	cleanup.push(() => restart.dispose());
	const service = await restart.runPromise(SafetyService);
	expect((await restart.runPromise(service.receipt(id, owner))).status).toBe('unknown');
	expect((await f.snapshot()).safety?.halted).toBe(true);
	expect(f.paths).toEqual([]);
});
it('generation changes while fetching fresh state prevent stopping a different connection', async () => {
	const f = await fixture(),
		job = await Effect.runPromise(SubscriptionRef.get(f.state));
	f.hook(async () => {
		await Effect.runPromise(
			SubscriptionRef.update(f.state, (s) => ({ ...s, generation: s.generation + 1 }))
		);
	});
	const record = await f.submit({
		type: 'stop',
		recoveryOf: f.recoveryId,
		expectedJob: { filename: job.job.filename!, runId: job.job.runId! }
	});
	expect((await f.finished(record.id)).status).toBe('failed');
	expect(f.paths).toEqual([]);
});
it('a safety persistence failure dispatches nothing and leaves the emergency memory interlock latched', async () => {
	const f = await fixture(),
		sql = await f.runtime.runPromise(SqlClient);
	await f.runtime.runPromise(sql`DROP TABLE printer_safety_state`);
	const id = randomUUID(),
		record = await f.submit({ type: 'emergency' }, id);
	expect(record.status).toBe('failed');
	expect(f.paths).toEqual([]);
	expect((await f.snapshot()).safety?.halted).toBe(true);
	expect((await f.submit({ type: 'emergency' }, id)).status).toBe('failed');
	expect(f.paths).toEqual([]);
});
it('expires a held recovery action without dispatch', async () => {
	const f = await fixture();
	let release!: () => void,
		entered = false;
	const held = new Promise<void>((resolve) => (release = resolve));
	f.hook(async () => {
		entered = true;
		await held;
	});
	const record = await f.submit({ type: 'cooldown', recoveryOf: f.recoveryId });
	await expect.poll(() => entered).toBe(true);
	const originalNow = Date.now,
		expired = originalNow() + 31000;
	try {
		Date.now = () => expired;
		release();
		expect((await f.finished(record.id)).status).toBe('failed');
		expect(f.paths).toEqual([]);
	} finally {
		Date.now = originalNow;
		release();
	}
});
it('bounds ordinary safety admission across owners while emergency retains its own lane', async () => {
	const f = await fixture();
	let release!: () => void,
		entered = false;
	const held = new Promise<void>((resolve) => (release = resolve));
	f.hook(async () => {
		entered = true;
		await held;
	});
	const record = await f.submit({ type: 'cooldown', recoveryOf: f.recoveryId });
	await expect.poll(() => entered).toBe(true);
	await expect(
		f.submit({ type: 'cooldown', recoveryOf: f.recoveryId }, randomUUID(), {
			...owner,
			id: 'other-owner'
		})
	).rejects.toThrow(/pending/);
	const emergency = await f.submit({ type: 'emergency' });
	expect((await f.finished(emergency.id)).status).toBe('completed');
	release();
	expect((await f.finished(record.id)).status).toBe('failed');
});

it('recovery abort ends the freshly observed manual helper without clearing the original action', async () => {
	const f = await fixture();
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			availableObjects: [...s.availableObjects, 'manual_probe'],
			motion: { ...s.motion, calibration: true }
		}))
	);
	const receipt = await f.submit({ type: 'abortProbe', recoveryOf: f.recoveryId });
	expect((await f.finished(receipt.id)).status).toBe('completed');
	expect((await f.snapshot()).liveRecovery?.id).toBe(f.recoveryId);
	expect((await Effect.runPromise(SubscriptionRef.get(f.state))).heaters.nozzle.target).toBe(200);
	expect(f.paths).toEqual(['/printer/gcode/script']);
});

it('a new emergency during readiness verification cannot be cleared by the older verification', async () => {
	const f = await fixture(),
		first = await f.submit({ type: 'emergency' });
	await f.finished(first.id);
	await f.runtime.runPromise(f.safety.acknowledge(first.id, owner));
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			klippy: 'ready' as const,
			telemetryReady: true,
			job: { ...s.job, state: 'standby' as const },
			heaters: { bed: { current: 25, target: 0 }, nozzle: { current: 25, target: 0 } }
		}))
	);
	let entered = false,
		release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	f.hook(async () => {
		entered = true;
		await gate;
	});
	const verification = f.runtime.runPromise(f.safety.verify(first.id, owner)).then(
		() => null,
		(cause) => cause
	);
	await expect.poll(() => entered).toBe(true);
	const second = await f.submit({ type: 'emergency' });
	await f.finished(second.id);
	release();
	expect(await verification).toBeTruthy();
	expect((await f.snapshot()).safety).toMatchObject({
		halted: true,
		recovery: { token: second.id, reviewedAt: null }
	});
});

it('backend restart preserves hazard review and uncertain restart without replay', async () => {
	const f = await fixture(),
		emergency = await f.submit({ type: 'emergency' });
	await f.finished(emergency.id);
	await f.runtime.runPromise(f.safety.acknowledge(emergency.id, owner));
	f.setBehavior('drop');
	const restart = await f.submit({ type: 'restart', recoveryOf: emergency.id });
	await f.finished(restart.id);
	const sql = await f.runtime.runPromise(SqlClient);
	const restarted = ManagedRuntime.make(
		SafetyServiceLive.pipe(
			Layer.provide(Layer.succeed(SqlClient, sql)),
			Layer.provide(Layer.succeed(PrinterService, f.printer)),
			Layer.provide(
				Layer.succeed(MoonrakerService, {
					state: f.state,
					command: () => Effect.void,
					refresh: () => SubscriptionRef.get(f.state)
				})
			),
			Layer.provide(Layer.succeed(MoonrakerConfig, { url: f.url })),
			Layer.provide(Layer.succeed(SafetySettings, { enabled: true }))
		)
	);
	cleanup.push(() => restarted.dispose());
	const safety = await restarted.runPromise(SafetyService);
	expect((await f.snapshot()).safety?.recovery?.reviewedAt).toBeTypeOf('number');
	expect((await restarted.runPromise(safety.receipt(restart.id, owner))).status).toBe('unknown');
	await expect(
		restarted.runPromise(
			safety.submit(
				{
					id: randomUUID(),
					confirmed: true,
					operation: { type: 'restart', recoveryOf: emergency.id }
				},
				owner
			)
		)
	).rejects.toThrow(/already submitted/);
	expect(f.paths.filter((p) => p === '/printer/firmware_restart')).toHaveLength(1);
	await restarted.runPromise(safety.verify(emergency.id, owner));
	expect((await f.snapshot()).safety?.halted).toBe(false);
});

it('individual outcome review never clears a different unknown safety receipt', async () => {
	const f = await fixture();
	f.setBehavior('drop');
	const first = await f.submit({ type: 'cooldown', recoveryOf: f.recoveryId });
	await f.finished(first.id);
	const second = await f.submit({ type: 'cooldown', recoveryOf: f.recoveryId });
	await f.finished(second.id);
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({ ...s, job: { ...s.job, state: 'standby' as const } }))
	);
	await f.runtime.runPromise(f.safety.review(first.id, owner));
	expect((await f.runtime.runPromise(f.safety.receipt(first.id, owner))).reviewedAt).toBeTypeOf(
		'number'
	);
	expect((await f.runtime.runPromise(f.safety.receipt(second.id, owner))).reviewedAt).toBeNull();
});
