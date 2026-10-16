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
import { printerAdmission, printerInterlock } from './printer-admission.js';
import type { ActionRequest } from '#lib/domain/printer.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
});
const owner = { id: 'owner', name: 'Owner', role: 'owner', authorized: () => true };
async function fixture(filename = ':memory:', filamentEnabled = true) {
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
			filament: {
				canExtrude: true,
				position: 100,
				active: 'extruder',
				maxDistance: 50,
				minTemp: 170
			},
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
	let afterControl: (() => Promise<void>) | undefined;
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
		control: (op, generation, permit) =>
			Effect.gen(function* () {
				const s = yield* SubscriptionRef.get(state);
				if (generation !== s.generation)
					return yield* Effect.fail(new MoonrakerCommandError({ sent: false }));
				if (permit && !permit())
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
						const feed = op.script.match(/G1 E(-?[\d.]+) F60/);
						if (feed)
							return {
								...s,
								filament: { ...s.filament!, position: s.filament!.position! + Number(feed[1]) }
							};
						if (op.script.startsWith('SET_HEATER_TEMPERATURE')) return { ...s, heaters };
						if (
							op.script.startsWith('PROBE_CALIBRATE') ||
							op.script.startsWith('Z_ENDSTOP_CALIBRATE')
						)
							return {
								...s,
								motion: { ...s.motion, calibration: true },
								zProbe: { ...s.zProbe!, active: true, z: 5 }
							};
						if (op.script.startsWith('TESTZ'))
							return {
								...s,
								zProbe: {
									...s.zProbe!,
									z: s.zProbe!.z! + Number(op.script.match(/Z=(-?[\d.]+)/)![1])
								}
							};
						if (op.script.startsWith('ACCEPT'))
							return {
								...s,
								motion: { ...s.motion, calibration: false },
								zProbe: {
									...s.zProbe!,
									active: false,
									pending: true,
									pendingOffset: 1.234,
									pendingKeys: ['bltouch.z_offset']
								}
							};
						if (op.script.startsWith('ABORT'))
							return {
								...s,
								motion: { ...s.motion, calibration: false },
								zProbe: { ...s.zProbe!, active: false }
							};
						if (op.script === 'TURN_OFF_HEATERS')
							return {
								...s,
								heaters: {
									bed: { ...s.heaters.bed, target: 0 },
									nozzle: { ...s.heaters.nozzle, target: 0 }
								}
							};
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
				if (afterControl) yield* Effect.promise(afterControl);
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
				Layer.succeed(LiveActionSettings, {
					enabled: true,
					zEnabled: true,
					filamentEnabled,
					target: 'fixture',
					observationMs: 10
				})
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
		setAfterControl: (fn: () => Promise<void>) => {
			afterControl = fn;
		},
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

it('emergency epoch prevents heater restoration after a delayed cancel acknowledgement', async () => {
	const f = await fixture();
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	await f.runtime.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			job: {
				...s.job,
				state: 'printing' as const,
				filename: 'test.gcode',
				runId: crypto.randomUUID()
			},
			heaters: { bed: { current: 25, target: 40 }, nozzle: { current: 25, target: 50 } }
		}))
	);
	await expect.poll(async () => (await f.snapshot()).job.state).toBe('printing');
	const job = (await f.snapshot()).job;
	f.setAfterControl(() => held);
	await f.submit({
		type: 'cancel',
		expectedJob: { filename: job.filename!, runId: job.runId! },
		coolBed: false,
		coolNozzle: false
	});
	await expect.poll(() => f.operations.length).toBe(1);
	printerInterlock(f.printer.state).interrupt();
	release();
	await f.finished();
	expect(f.operations).toHaveLength(1);
	expect((await f.snapshot()).actions[0].status).toBe('unknown');
});

async function hotFilament(f: Awaited<ReturnType<typeof fixture>>) {
	await f.runtime.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			heaters: { ...s.heaters, nozzle: { current: 210, target: 210 } }
		}))
	);
	await expect.poll(async () => (await f.snapshot()).heaters.nozzle.current).toBe(210);
}
it('live measured extrusion acknowledges travel before accepting a measurement and retains an unapplied proposal', async () => {
	const f = await fixture();
	await hotFilament(f);
	const id = crypto.randomUUID();
	const command = {
		type: 'extrusionBegin' as const,
		runId: id,
		rotationDistance: 7.5,
		before: 70,
		confirmed: true
	};
	await f.submit(command, owner, id);
	await f.finished();
	expect((await f.snapshot()).extrusion.session?.stage).toBe('measure');
	expect(f.operations).toHaveLength(1);
	expect(f.operations[0]).toMatchObject({ script: expect.stringContaining('G1 E50 F60') });
	await f.submit(command, owner, id);
	expect(f.operations).toHaveLength(1);
	await expect(
		f.submit({ type: 'move', target: { x: 102 }, expectedPosition: { x: 100, y: 100, z: 20 } })
	).rejects.toThrow(/owns/);
	await f.submit({ type: 'extrusionMeasure', runId: id, after: 22 });
	await f.finished();
	expect((await f.snapshot()).extrusion.session?.proposal?.proposed).toBe(7.2);
	await f.submit({ type: 'extrusionFinish', runId: id, coolNozzle: true });
	await f.finished();
	expect((await f.snapshot()).extrusion.session?.stage).toBe('finished');
	expect((await f.snapshot()).heaters.nozzle.target).toBe(0);
});
it('rejects cold, unsupported tool and over-limit live extrusion without dispatch', async () => {
	const f = await fixture();
	const submit = () =>
		f.submit({
			type: 'extrusionBegin',
			runId: crypto.randomUUID(),
			rotationDistance: 7.5,
			before: 70,
			confirmed: true
		});
	await submit();
	await f.finished();
	expect(f.operations).toHaveLength(0);
	await hotFilament(f);
	await f.runtime.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			filament: { ...s.filament!, maxDistance: 25 }
		}))
	);
	await submit();
	await f.finished();
	expect(f.operations).toHaveLength(0);
	await f.runtime.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			filament: { ...s.filament!, maxDistance: 50, active: 'extruder1' }
		}))
	);
	await submit();
	await f.finished();
	expect(f.operations).toHaveLength(0);
});
it('lost extrusion acknowledgement keeps recovery locked and is never replayed', async () => {
	const f = await fixture();
	await hotFilament(f);
	f.setBehavior('drop');
	const id = crypto.randomUUID(),
		command = { type: 'extrusionFeed' as const, runId: id, distance: 5 as const, confirmed: true };
	await f.submit(command, owner, id);
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('unknown');
	expect((await f.snapshot()).liveRecovery?.id).toBe(id);
	await f.submit(command, owner, id);
	expect(f.operations).toHaveLength(1);
});
it('an emergency during an extrusion acknowledgement keeps the result unknown', async () => {
	const f = await fixture();
	await hotFilament(f);
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	f.setAfterControl(() => held);
	await f.submit({
		type: 'extrusionFeed',
		runId: crypto.randomUUID(),
		distance: 5,
		confirmed: true
	});
	await expect.poll(() => f.operations.length).toBe(1);
	printerInterlock(f.printer.state).interrupt();
	release();
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('unknown');
});
it('restarting a durable measured session interrupts it without replaying movement', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'perilune-live-filament-'));
	cleanup.push(() => rm(dir, { recursive: true, force: true }));
	const file = join(dir, 'state.sqlite');
	const a = await fixture(file);
	await hotFilament(a);
	const id = crypto.randomUUID();
	await a.submit({
		type: 'extrusionBegin',
		runId: id,
		rotationDistance: 7.5,
		before: 70,
		confirmed: true
	});
	await a.finished();
	await a.runtime.dispose();
	const b = await fixture(file);
	expect((await b.snapshot()).extrusion.session).toMatchObject({ id, stage: 'interrupted' });
	expect(b.operations).toHaveLength(0);
	await b.submit({ type: 'extrusionMeasure', runId: id, after: 22 });
	await b.finished();
	expect((await b.snapshot()).actions[0].status).toBe('failed');
	expect(b.operations).toHaveLength(0);
});
it('preserves measurement ownership and interrupts a revoked owner after movement', async () => {
	const f = await fixture();
	await hotFilament(f);
	let allowed = true;
	const actor = { ...owner, authorized: () => allowed },
		id = crypto.randomUUID();
	await f.submit(
		{ type: 'extrusionBegin', runId: id, rotationDistance: 7.5, before: 70, confirmed: true },
		actor
	);
	await f.finished();
	await f.submit({ type: 'extrusionMeasure', runId: id, after: 22 }, { ...owner, id: 'other' });
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('failed');
	expect((await f.snapshot()).extrusion.session?.stage).toBe('measure');
	allowed = false;
	await expect.poll(async () => (await f.snapshot()).extrusion.session?.stage).toBe('interrupted');
	expect(f.operations).toHaveLength(1);
});
it('idle session checkpoint failure retains worker liveness and only retries storage', async () => {
	const f = await fixture();
	await hotFilament(f);
	let allowed = true;
	const id = crypto.randomUUID();
	await f.submit(
		{ type: 'extrusionBegin', runId: id, rotationDistance: 7.5, before: 70, confirmed: true },
		{ ...owner, authorized: () => allowed }
	);
	await f.finished();
	const sql = await f.runtime.runPromise(SqlClient);
	await f.runtime.runPromise(sql`DROP TABLE live_filament_state`);
	allowed = false;
	await expect.poll(async () => (await f.snapshot()).storage).toBe('degraded');
	expect((await f.snapshot()).extrusion.session?.stage).toBe('interrupted');
	await f.runtime.runPromise(
		sql`CREATE TABLE live_filament_state(target TEXT PRIMARY KEY,state TEXT NOT NULL)`
	);
	await expect.poll(async () => (await f.snapshot()).storage).toBe('healthy');
	await f.submit({ type: 'cooldown' });
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('completed');
	expect(f.operations).toHaveLength(2);
});

it('live filament requires its own explicit enablement', async () => {
	const f = await fixture(':memory:', false);
	await hotFilament(f);
	await expect(
		f.submit({ type: 'extrusionFeed', runId: crypto.randomUUID(), distance: 5, confirmed: true })
	).rejects.toThrow(/disabled/);
	expect(f.operations).toHaveLength(0);
});
async function zReady(f: Awaited<ReturnType<typeof fixture>>) {
	await f.runtime.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			availableObjects: [...s.availableObjects, 'manual_probe'],
			zProbe: {
				method: 'probe' as const,
				active: false,
				z: 20,
				offset: [-24, -13] as [number, number],
				pending: false,
				pendingOffset: null,
				pendingKeys: []
			}
		}))
	);
	await expect.poll(async () => (await f.snapshot()).zProbe?.method).toBe('probe');
}
it('live Z helper reconciles begin/adjust/accept and stages a result without saving configuration', async () => {
	const f = await fixture();
	await zReady(f);
	const id = crypto.randomUUID();
	await f.submit({ type: 'zProbeBegin', run: id, confirmed: true });
	await f.finished();
	expect((await f.snapshot()).liveZ?.session).toMatchObject({
		id,
		stage: 'active',
		version: 0,
		z: 5
	});
	await f.submit({ type: 'zProbeAdjust', run: id, version: 0, expectedZ: 5, delta: -0.1 });
	await f.finished();
	expect((await f.snapshot()).liveZ?.session).toMatchObject({ version: 1, z: 4.9 });
	await f.submit({ type: 'zProbeAccept', run: id, version: 1, expectedZ: 4.9, confirmed: true });
	await f.finished();
	expect((await f.snapshot()).liveZ?.session).toMatchObject({ stage: 'staged', candidate: 1.234 });
	expect(f.operations).toHaveLength(3);
	expect(f.operations.some((o) => 'script' in o && o.script.includes('SAVE_CONFIG'))).toBe(false);
});
it('live Z rejects stale height/version and other operators then allows explicit abort', async () => {
	const f = await fixture();
	await zReady(f);
	const run = crypto.randomUUID();
	await f.submit({ type: 'zProbeBegin', run, confirmed: true });
	await f.finished();
	await f.submit({ type: 'zProbeAdjust', run, version: 0, expectedZ: 4, delta: -0.1 });
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('failed');
	await f.submit(
		{ type: 'zProbeAdjust', run, version: 0, expectedZ: 5, delta: -0.1 },
		{ ...owner, id: 'other' }
	);
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('failed');
	expect(f.operations).toHaveLength(1);
	await f.submit({ type: 'zProbeAbort', run, version: 0, confirmed: true });
	await f.finished();
	expect((await f.snapshot()).liveZ?.session?.stage).toBe('aborted');
	expect((await f.snapshot()).motion.calibration).toBe(false);
});
it('live Z does not begin with pending settings or a probe path outside bounds', async () => {
	const f = await fixture();
	await zReady(f);
	await f.runtime.runPromise(
		SubscriptionRef.update(f.state, (s) => ({ ...s, zProbe: { ...s.zProbe!, pending: true } }))
	);
	await f.submit({ type: 'zProbeBegin', run: crypto.randomUUID(), confirmed: true });
	await f.finished();
	expect(f.operations).toHaveLength(0);
	await f.runtime.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			zProbe: { ...s.zProbe!, pending: false },
			motion: { ...s.motion, position: { ...s.motion.position, x: 0 } }
		}))
	);
	await f.submit({ type: 'zProbeBegin', run: crypto.randomUUID(), confirmed: true });
	await f.finished();
	expect(f.operations).toHaveLength(0);
});
it('lost probe acknowledgement never claims accepted height or replays the helper', async () => {
	const f = await fixture();
	await zReady(f);
	const run = crypto.randomUUID();
	await f.submit({ type: 'zProbeBegin', run, confirmed: true });
	await f.finished();
	f.setBehavior('drop');
	const id = crypto.randomUUID(),
		command = {
			type: 'zProbeAccept' as const,
			run,
			version: 0,
			expectedZ: 5,
			confirmed: true as const
		};
	await f.submit(command, owner, id);
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('unknown');
	expect((await f.snapshot()).liveZ?.session?.stage).toBe('interrupted');
	await f.submit(command, owner, id);
	expect(f.operations).toHaveLength(2);
});
it('live Z restart and externally ended helper never resume a paper test', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'perilune-z-'));
	cleanup.push(() => rm(dir, { recursive: true, force: true }));
	const file = join(dir, 'state.sqlite');
	const a = await fixture(file);
	await zReady(a);
	const run = crypto.randomUUID();
	await a.submit({ type: 'zProbeBegin', run, confirmed: true });
	await a.finished();
	await a.runtime.dispose();
	const b = await fixture(file);
	expect((await b.snapshot()).liveZ?.session).toMatchObject({ id: run, stage: 'interrupted' });
	expect(b.operations).toHaveLength(0);
	await zReady(b);
	await b.submit({ type: 'zProbeBegin', run: crypto.randomUUID(), confirmed: true });
	await b.finished();
	await b.runtime.runPromise(
		SubscriptionRef.update(b.state, (s) => ({
			...s,
			motion: { ...s.motion, calibration: false },
			zProbe: { ...s.zProbe!, active: false }
		}))
	);
	await expect.poll(async () => (await b.snapshot()).liveZ?.session?.stage).toBe('interrupted');
	expect((await b.snapshot()).motion.calibration).toBe(false);
});
it('owned Z abort stays available if a heater target or busy state changes externally', async () => {
	const f = await fixture();
	await zReady(f);
	const run = crypto.randomUUID();
	await f.submit({ type: 'zProbeBegin', run, confirmed: true });
	await f.finished();
	await f.runtime.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			heaters: { ...s.heaters, nozzle: { current: 30, target: 200 } },
			motion: { ...s.motion, busy: true }
		}))
	);
	await f.submit({ type: 'zProbeAbort', run, version: 0, confirmed: true });
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('completed');
	expect((await f.snapshot()).liveZ?.session?.stage).toBe('aborted');
});
it('resolved pending Z results allow a fresh calibration without claiming they remain pending', async () => {
	const f = await fixture();
	await zReady(f);
	const run = crypto.randomUUID();
	await f.submit({ type: 'zProbeBegin', run, confirmed: true });
	await f.finished();
	await f.submit({ type: 'zProbeAccept', run, version: 0, expectedZ: 5, confirmed: true });
	await f.finished();
	await f.runtime.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			zProbe: { ...s.zProbe!, pending: false, pendingOffset: null, pendingKeys: [] }
		}))
	);
	await expect.poll(async () => (await f.snapshot()).liveZ?.session?.stage).toBe('resolved');
	await f.submit({ type: 'zProbeBegin', run: crypto.randomUUID(), confirmed: true });
	await f.finished();
	expect((await f.snapshot()).actions[0].status).toBe('completed');
});
