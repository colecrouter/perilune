import { LiveMeshService, LiveMeshServiceLive } from './live-mesh-service.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';
import { Effect, Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { SqlClient } from 'effect/sql/SqlClient';
import { ActionStoreLive } from './action-store.js';
import { PrinterService, makePrinterService } from './printer-service.js';
import { MoonrakerBridgeLive } from './moonraker-bridge.js';
import {
	MoonrakerService,
	MoonrakerCommandError,
	emptyMoonrakerSnapshot,
	type MoonrakerSnapshot,
	type ControlOperation
} from './moonraker.js';
import { JobService, JobServiceLive, JobsConfig } from './job-service.js';
import {
	LiveActionService,
	LiveActionServiceLive,
	LiveActionSettings,
	movementScript
} from './live-action-service.js';
import { printerAdmission } from './printer-admission.js';
import type { ActionRequest } from '#lib/domain/printer.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
});
const owner = { id: 'owner', name: 'Owner', role: 'owner', authorized: () => true };
async function fixture(filename = ':memory:') {
	const state = await Effect.runPromise(
		SubscriptionRef.make<MoonrakerSnapshot>({
			...emptyMoonrakerSnapshot(),
			connection: 'connected' as const,
			klippy: 'ready' as const,
			telemetryReady: true,
			generation: 1,
			availableObjects: [
				'toolhead',
				'idle_timeout',
				'print_stats',
				'heater_bed',
				'extruder',
				'virtual_sdcard'
			],
			updatedAt: Date.now(),
			liveMesh: {
				enabled: true,
				pendingConfig: false,
				plan: { min: [20, 20], max: [100, 100], offset: [0, 0], rows: 3, columns: 3, samples: 1 }
			},
			job: { ...emptyMoonrakerSnapshot().job, state: 'complete' as const },
			heaters: { bed: { current: 25, target: 0 }, nozzle: { current: 25, target: 0 } },
			heaterLimits: { bed: { min: 0, max: 130 }, nozzle: { min: 0, max: 280 } },
			motion: {
				position: { x: 100, y: 100, z: 20 },
				limits: { x: { min: -5, max: 220 }, y: { min: -5, max: 220 }, z: { min: 0, max: 250 } },
				homed: ['x', 'y', 'z'] as Array<'x' | 'y' | 'z'>,
				busy: false,
				calibration: false
			}
		})
	);
	const operations: ControlOperation[] = [];
	let behavior:
		| 'normal'
		| 'drop'
		| 'unobserved'
		| 'dropAfterCancel'
		| 'newJobAfterCancel'
		| 'cancelStillPrinting'
		| 'defect' = 'normal';
	let beforeRefresh: (() => Promise<void>) | undefined;
	const transport = Layer.succeed(MoonrakerService, {
		state,
		refresh: (generation) =>
			Effect.gen(function* () {
				if (beforeRefresh) yield* Effect.promise(beforeRefresh);
				const s = yield* SubscriptionRef.get(state);
				if (generation !== s.generation)
					return yield* Effect.fail(new MoonrakerCommandError({ sent: false }));
				return s;
			}),
		command: () => Effect.void,
		control: (op, generation) =>
			Effect.gen(function* () {
				const s = yield* SubscriptionRef.get(state);
				if (generation !== s.generation)
					return yield* Effect.fail(new MoonrakerCommandError({ sent: false }));
				operations.push(op);
				if (behavior === 'defect') return yield* Effect.die('fixture defect');
				if (behavior === 'drop' || (behavior === 'dropAfterCancel' && op.type === 'controlScript'))
					return yield* Effect.fail(new MoonrakerCommandError({ sent: true }));
				if (behavior === 'unobserved') return;
				if (op.type === 'controlScript')
					yield* SubscriptionRef.update(state, (s): MoonrakerSnapshot => {
						const heaters = structuredClone(s.heaters);
						for (const match of op.script.matchAll(/HEATER=(heater_bed|extruder) TARGET=(\d+)/g))
							heaters[match[1] === 'heater_bed' ? 'bed' : 'nozzle'].target = Number(match[2]);
						if (op.script.startsWith('SET_HEATER_TEMPERATURE')) return { ...s, heaters };
						if (op.script === 'M84') return { ...s, motion: { ...s.motion, homed: [] } };
						if (op.script.startsWith('G28'))
							return { ...s, motion: { ...s.motion, homed: ['x', 'y', 'z'] } };
						return s;
					});
				if (op.type === 'job')
					yield* SubscriptionRef.update(state, (s): MoonrakerSnapshot => {
						if (op.method === 'cancel' && behavior === 'cancelStillPrinting') return s;
						if (op.method === 'cancel' && behavior === 'newJobAfterCancel')
							return {
								...s,
								job: {
									...s.job,
									state: 'printing' as const,
									filename: 'new.gcode',
									runId: crypto.randomUUID()
								}
							};
						return {
							...s,
							job: {
								...s.job,
								state:
									op.method === 'pause'
										? 'paused'
										: op.method === 'cancel'
											? 'cancelled'
											: 'printing',
								filename: op.filename ?? s.job.filename,
								runId: op.method === 'start' ? crypto.randomUUID() : s.job.runId
							},
							heaters:
								op.method === 'cancel'
									? { bed: { current: 25, target: 0 }, nozzle: { current: 25, target: 0 } }
									: s.heaters
						};
					});
			})
	});
	const db = SqliteClient.layer({ filename });
	const store = ActionStoreLive.pipe(Layer.provide(db));
	const printer = makePrinterService('moonraker').pipe(Layer.provideMerge(store));
	const core = MoonrakerBridgeLive.pipe(Layer.provideMerge(Layer.merge(printer, transport)));
	const mesh = LiveMeshServiceLive.pipe(
		Layer.provide(db),
		Layer.provide(store),
		Layer.provide(transport),
		Layer.provideMerge(core)
	);
	const baseJobs = JobServiceLive.pipe(
		Layer.provide(Layer.succeed(JobsConfig, { moonrakerUrl: '', checkUser: () => true })),
		Layer.provide(db),
		Layer.provideMerge(mesh)
	);
	const jobs = Layer.effect(
		JobService,
		Effect.map(JobService, (service) => ({ ...service, refresh: Effect.void }))
	).pipe(Layer.provideMerge(baseJobs));
	const runtime = ManagedRuntime.make(
		LiveActionServiceLive.pipe(
			Layer.provide(
				Layer.succeed(LiveActionSettings, { enabled: true, target: 'fixture', observationMs: 10 })
			),
			Layer.provideMerge(jobs),
			Layer.provideMerge(store),
			Layer.provideMerge(transport),
			Layer.provideMerge(db)
		)
	);
	cleanup.push(() => runtime.dispose());
	const service = await runtime.runPromise(LiveActionService),
		p = await runtime.runPromise(PrinterService);
	const snapshot = () => runtime.runPromise(SubscriptionRef.get(p.state));
	await expect.poll(async () => (await snapshot()).connection).toBe('connected');
	const submit = (command: ActionRequest['command'], actor = owner, id = crypto.randomUUID()) =>
		runtime.runPromise(service.submit({ id, command }, actor));
	const finished = () =>
		expect.poll(async () => (await snapshot()).actions[0]?.status).not.toMatch(/queued|sending/);
	return {
		runtime,
		service,
		state,
		operations,
		snapshot,
		submit,
		finished,
		printer: p,
		jobs: await runtime.runPromise(JobService),
		mesh: await runtime.runPromise(LiveMeshService),
		setBehavior: (v: typeof behavior) => {
			behavior = v;
		},
		setRefresh: (fn: () => Promise<void>) => {
			beforeRefresh = fn;
		}
	};
}
it('persists and deduplicates submission across accounts, validates heater limits and observes targets', async () => {
	const f = await fixture(),
		id = crypto.randomUUID();
	await Promise.all([
		f.submit({ type: 'temperature', heater: 'bed', target: 40 }, owner, id),
		f.submit({ type: 'temperature', heater: 'bed', target: 40 }, owner, id)
	]);
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('completed');
	expect(f.operations).toHaveLength(1);
	await expect(
		f.submit({ type: 'temperature', heater: 'bed', target: 40 }, { ...owner, id: 'other' }, id)
	).rejects.toThrow('another command or account');
	await f.submit({ type: 'temperature', heater: 'nozzle', target: 290 });
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('failed');
	expect(f.operations).toHaveLength(1);
});
it('bounds admission and uses the same gate as other workflows', async () => {
	const f = await fixture();
	let release!: () => void;
	const paused = new Promise<void>((r) => {
		release = r;
	});
	f.setRefresh(() => paused);
	await f.submit({ type: 'releaseMotors', axes: 'all', confirmed: true });
	await expect(f.submit({ type: 'home', axes: 'all' })).rejects.toThrow('pending');
	expect(printerAdmission(f.printer.state)).toBe(printerAdmission(f.printer.state));
	release();
	await f.finished();
	expect(f.operations).toHaveLength(1);
});
it('revalidates position, authorization and generation before dispatch', async () => {
	const f = await fixture();
	f.setRefresh(async () => {
		await f.runtime.runPromise(
			SubscriptionRef.update(f.state, (s) => ({
				...s,
				motion: { ...s.motion, position: { ...s.motion.position, x: 101 } }
			}))
		);
	});
	await f.submit({ type: 'move', target: { x: 110 }, expectedPosition: { x: 100, y: 100, z: 20 } });
	await f.finished();
	expect(f.operations).toHaveLength(0);
	expect((await f.snapshot()).actions[0].status).toBe('failed');
	let valid = true;
	f.setRefresh(async () => {
		valid = false;
	});
	await f.submit({ type: 'home', axes: 'all' }, { ...owner, authorized: () => valid });
	await f.finished();
	expect(f.operations).toHaveLength(0);
});
it('quarantines lost acknowledgements persistently and requires owner recovery without replay', async () => {
	const f = await fixture();
	f.setBehavior('drop');
	await f.submit({ type: 'releaseMotors', axes: 'all', confirmed: true });
	await f.finished();
	const s = await f.snapshot();
	expect(s.actions[0].status).toBe('unknown');
	expect(s.liveRecovery).toBeTruthy();
	expect(await f.runtime.runPromise(yieldRows())).toHaveLength(1);
	await expect(f.submit({ type: 'home', axes: 'all' })).rejects.toThrow('unknown outcome');
	await expect(
		f.runtime.runPromise(f.service.recover(s.actions[0].id, { ...owner, role: 'operator' }))
	).rejects.toThrow('owner');
	await f.runtime.runPromise(f.service.recover(s.actions[0].id, owner));
	expect((await f.snapshot()).liveRecovery).toBeNull();
	expect(f.operations).toHaveLength(1);
});
function yieldRows() {
	return Effect.gen(function* () {
		const sql = yield* SqlClient;
		return yield* sql`SELECT * FROM live_action_reservation`;
	});
}
it('requires observed state after acknowledgement', async () => {
	const f = await fixture();
	f.setBehavior('unobserved');
	await f.submit({ type: 'temperature', heater: 'bed', target: 40 });
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('unknown');
	expect(f.operations).toHaveLength(1);
});
it('uses relative physical deltas and restores modal positioning without returning the toolhead', () => {
	expect(
		movementScript({
			type: 'move',
			target: { x: 110, z: 21 },
			expectedPosition: { x: 100, y: 100, z: 20 }
		})
	).toBe(
		'SAVE_GCODE_STATE NAME=perilune_manual_move\nG91\nG1 X10.000 Z1.000 F300\nM400\nRESTORE_GCODE_STATE NAME=perilune_manual_move'
	);
});

it('retains the reservation after a backend restart and never resumes work', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'perilune-live-actions-'));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const filename = join(directory, 'test.sqlite');
	const first = await fixture(filename);
	first.setBehavior('drop');
	await first.submit({ type: 'releaseMotors', axes: 'all', confirmed: true });
	await first.finished();
	const original = (await first.snapshot()).liveRecovery;
	await first.runtime.dispose();
	const second = await fixture(filename);
	expect((await second.snapshot()).liveRecovery).toEqual(original);
	expect(second.operations).toHaveLength(0);
	await expect(second.submit({ type: 'home', axes: 'all' })).rejects.toThrow('unknown outcome');
});
it('refuses recovery while motion or a print is active', async () => {
	const f = await fixture();
	f.setBehavior('drop');
	await f.submit({ type: 'releaseMotors', axes: 'all', confirmed: true });
	await f.finished();
	const id = (await f.snapshot()).liveRecovery!.id;
	await f.runtime.runPromise(
		SubscriptionRef.update(f.state, (s) => ({ ...s, motion: { ...s.motion, busy: true } }))
	);
	await expect(f.runtime.runPromise(f.service.recover(id, owner))).rejects.toThrow(
		'stopped and idle'
	);
	expect((await f.snapshot()).liveRecovery?.id).toBe(id);
});

it('starts a catalog-bound live job, protects job identity, and restores independent cancel targets', async () => {
	const f = await fixture(),
		fileId = 'a'.repeat(64);
	await f.runtime.runPromise(
		SubscriptionRef.update(f.jobs.state, (s) => ({
			...s,
			files: [
				{
					id: fileId,
					name: 'test.gcode',
					source: 'moonraker' as const,
					size: 42,
					modified: 1,
					metadata: null
				}
			]
		}))
	);
	await f.submit({ type: 'start', fileId });
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('completed');
	const expectedJob = {
		filename: 'test.gcode',
		runId: (await f.runtime.runPromise(SubscriptionRef.get(f.state))).job.runId!
	};
	await f.submit({ type: 'pause', expectedJob });
	await f.finished();
	expect((await f.runtime.runPromise(SubscriptionRef.get(f.state))).job.state).toBe('paused');
	await f.submit({ type: 'resume', expectedJob });
	await f.finished();
	await f.runtime.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			heaters: { bed: { current: 25, target: 40 }, nozzle: { current: 25, target: 50 } }
		}))
	);
	await f.submit({ type: 'cancel', expectedJob, coolBed: false, coolNozzle: true });
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('completed');
	expect((await f.runtime.runPromise(SubscriptionRef.get(f.state))).heaters).toMatchObject({
		bed: { target: 40 },
		nozzle: { target: 0 }
	});
	const count = f.operations.length;
	await f.runtime.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			job: { ...s.job, state: 'printing' as const, runId: crypto.randomUUID() }
		}))
	);
	await f.submit({ type: 'pause', expectedJob });
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('failed');
	expect(f.operations).toHaveLength(count);
});
for (const behavior of [
	'drop',
	'dropAfterCancel',
	'newJobAfterCancel',
	'cancelStillPrinting'
] as const)
	it(`quarantines cancel ${behavior} without replay or unsafe restoration`, async () => {
		const f = await fixture(),
			runId = crypto.randomUUID();
		await f.runtime.runPromise(
			SubscriptionRef.update(f.state, (s) => ({
				...s,
				job: { ...s.job, state: 'printing' as const, filename: 'test.gcode', runId }
			}))
		);
		f.setBehavior(behavior);
		await f.submit({
			type: 'cancel',
			expectedJob: { filename: 'test.gcode', runId },
			coolBed: false,
			coolNozzle: false
		});
		await f.finished();
		expect((await f.snapshot()).actions[0].status).toBe('unknown');
		expect(f.operations).toHaveLength(behavior === 'dropAfterCancel' ? 2 : 1);
	});
it('persists unexpected transport defects and clears the matching snapshot pending state on recovery', async () => {
	const f = await fixture();
	f.setBehavior('defect');
	const id = crypto.randomUUID();
	await f.submit({ type: 'releaseMotors', axes: 'all', confirmed: true }, owner, id);
	await f.finished();
	expect(
		(await f.submit({ type: 'releaseMotors', axes: 'all', confirmed: true }, owner, id)).status
	).toBe('unknown');
	await f.runtime.runPromise(
		SubscriptionRef.update(f.printer.state, (s) => ({
			...s,
			actions: s.actions.map((a) => ({ ...a, status: 'sending' as const }))
		}))
	);
	await f.runtime.runPromise(f.service.recover(id, owner));
	expect((await f.snapshot()).actions[0].status).toBe('unknown');
	expect((await f.snapshot()).liveRecovery).toBeNull();
});

it('serializes concurrent basic and mesh admission through the same reservation gate', async () => {
	const f = await fixture();
	let release!: () => void, entered!: () => void;
	const ready = new Promise<void>((r) => {
		entered = r;
	});
	const held = f.runtime.runPromise(
		printerAdmission(f.printer.state).withPermits(1)(
			Effect.promise(() => {
				entered();
				return new Promise<void>((r) => {
					release = r;
				});
			})
		)
	);
	await ready;
	const basic = f.submit({ type: 'releaseMotors', axes: 'all', confirmed: true });
	const probeId = crypto.randomUUID();
	const mesh = f.runtime.runPromise(
		f.mesh.submit(
			{ id: probeId, command: { type: 'meshProbeBegin', probeId, confirmed: true } },
			owner
		)
	);
	const results = Promise.allSettled([basic, mesh]);
	release();
	await held;
	const [a, b] = await results;
	expect(a.status).toBe('fulfilled');
	expect(b.status).toBe('rejected');
	if (b.status === 'rejected') expect(b.reason.message).toMatch(/pending/);
	await f.finished();
	expect(f.operations).toHaveLength(1);
});
