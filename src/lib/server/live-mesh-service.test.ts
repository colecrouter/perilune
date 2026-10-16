import { printerInterlock } from './printer-admission.js';
import { afterEach, expect, it } from 'vite-plus/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqlClient } from 'effect/sql/SqlClient';
import { Effect, Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { ActionStoreLive } from './action-store.js';
import { makePrinterService, PrinterService } from './printer-service.js';
import {
	MoonrakerService,
	MoonrakerCommandError,
	emptyMoonrakerSnapshot,
	type MoonrakerSnapshot,
	type MeshOperation
} from './moonraker.js';
import { MoonrakerBridgeLive } from './moonraker-bridge.js';
import { LiveMeshService, LiveMeshServiceLive } from './live-mesh-service.js';
import { liveMeshPlan } from '#lib/domain/live-mesh.js';
import type { ActionRequest } from '#lib/domain/printer.js';
import type { BedMesh } from '#lib/domain/bed-mesh.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
});
const owner = { id: 'owner', name: 'Owner', role: 'owner', authorized: () => true };
async function fixture(handler?: (op: MeshOperation) => Promise<void>, filename = ':memory:') {
	const mesh: BedMesh = {
		name: 'default',
		min: [30, 30],
		max: [205, 215],
		points: Array.from({ length: 5 }, () => [0, 0.01, 0.02, 0.03, 0.04])
	};
	const state = await Effect.runPromise(
		SubscriptionRef.make<MoonrakerSnapshot>({
			...emptyMoonrakerSnapshot(),
			connection: 'connected' as const,
			klippy: 'ready' as const,
			generation: 1,
			telemetryReady: true,
			updatedAt: Date.now(),
			job: { ...emptyMoonrakerSnapshot().job, state: 'complete' as const },
			heaters: { bed: { current: 23, target: 0 }, nozzle: { current: 23, target: 0 } },
			motion: {
				position: { x: 0, y: 220, z: 20 },
				limits: { x: { min: -6, max: 230 }, y: { min: -14, max: 230 }, z: { min: -3, max: 250 } },
				homed: [] as Array<'x' | 'y' | 'z'>,
				busy: false,
				calibration: false
			},
			liveMesh: {
				enabled: true,
				plan: liveMeshPlan({
					bed_mesh: { mesh_min: '30,30', mesh_max: '205,215', probe_count: '5,5' },
					bltouch: { x_offset: '-24', y_offset: '-13', samples: '2' }
				}),
				pendingConfig: false
			},
			bedMesh: { status: 'ready' as const, active: mesh, profiles: [mesh], omittedProfiles: 0 }
		})
	);
	const operations: MeshOperation[] = [];
	const transport = Layer.succeed(MoonrakerService, {
		state,
		refresh: () => SubscriptionRef.get(state),
		command: (operation, generation, permit) =>
			Effect.tryPromise({
				try: async () => {
					if ((await Effect.runPromise(SubscriptionRef.get(state))).generation !== generation)
						throw new MoonrakerCommandError({ sent: false });
					if (permit && !permit()) throw new MoonrakerCommandError({ sent: false });
					operations.push(operation);
					await handler?.(operation);
					await Effect.runPromise(
						SubscriptionRef.update(state, (s): MoonrakerSnapshot => {
							if (operation.type === 'home')
								return { ...s, motion: { ...s.motion, homed: ['x', 'y', 'z'] } };
							if (operation.type === 'probe') {
								const result = {
									...mesh,
									name: operation.name,
									points: mesh.points.map((r) => r.map((v) => v + 0.1))
								};
								return {
									...s,
									bedMesh: { ...s.bedMesh, active: result, profiles: [mesh, result] },
									liveMesh: { ...s.liveMesh, pendingConfig: true }
								};
							}
							if (operation.type === 'restore')
								return { ...s, bedMesh: { ...s.bedMesh, active: mesh, profiles: [mesh] } };
							if (operation.type === 'keep')
								return { ...s, bedMesh: { ...s.bedMesh, profiles: [mesh] } };
							if (operation.type === 'save')
								return {
									...s,
									generation: s.generation + 1,
									bedMesh: {
										...s.bedMesh,
										active: null,
										profiles: [mesh, { ...s.bedMesh.active!, name: operation.name }]
									},
									liveMesh: { ...s.liveMesh, pendingConfig: false },
									motion: { ...s.motion, homed: [] }
								};
							return s;
						})
					);
				},
				catch: (cause) =>
					cause instanceof MoonrakerCommandError ? cause : new MoonrakerCommandError({ sent: true })
			})
	});
	const db = SqliteClient.layer({ filename }),
		store = ActionStoreLive.pipe(Layer.provide(db));
	const services = Layer.merge(
		makePrinterService('moonraker').pipe(Layer.provide(store)),
		transport
	);
	const core = MoonrakerBridgeLive.pipe(Layer.provideMerge(services));
	const runtime = ManagedRuntime.make(
		LiveMeshServiceLive.pipe(Layer.provide(store), Layer.provideMerge(db), Layer.provideMerge(core))
	);
	cleanup.push(() => runtime.dispose());
	const controller = await runtime.runPromise(LiveMeshService),
		printer = await runtime.runPromise(PrinterService);
	const snapshot = () => runtime.runPromise(SubscriptionRef.get(printer.state));
	await expect.poll(async () => (await snapshot()).telemetryReady).toBe(true);
	const submit = (request: ActionRequest, actor = owner) =>
		runtime.runPromise(controller.submit(request, actor));
	const begin = () => {
		const id = crypto.randomUUID();
		return { id, command: { type: 'meshProbeBegin' as const, probeId: id, confirmed: true } };
	};
	return { runtime, controller, printer, state, snapshot, submit, begin, operations };
}
it('homes once, measures without blocking telemetry, and keeps an active temporary mesh', async () => {
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	const f = await fixture(async (op) => {
		if (op.type === 'probe') await held;
	});
	const request = f.begin();
	await f.submit(request);
	await f.submit(request);
	await expect.poll(() => f.operations.map((o) => o.type)).toEqual(['home', 'probe']);
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			heaters: { ...s.heaters, bed: { current: 24, target: 0 } },
			probeResponses: [
				{ sequence: 1, x: 54, y: 43 },
				{ sequence: 2, x: 54, y: 43 }
			]
		}))
	);
	await expect.poll(async () => (await f.snapshot()).heaters.bed.current).toBe(24);
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.completedSamples).toBe(1);
	await expect(f.submit(f.begin())).rejects.toThrow(/pending/);
	release();
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('review');
	await f.submit({
		id: crypto.randomUUID(),
		command: { type: 'meshProbeFinish', probeId: request.id, outcome: 'apply' }
	});
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('applied');
	expect((await f.snapshot()).bedMesh.active?.points[0][0]).toBe(0.1);
	expect(f.operations.map((o) => o.type)).toEqual(['home', 'probe', 'keep']);
});
it('restores the previous mesh only after review and protects workflow ownership', async () => {
	const f = await fixture(),
		request = f.begin();
	await f.submit(request);
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('review');
	await expect(
		f.submit(
			{
				id: crypto.randomUUID(),
				command: { type: 'meshProbeCancel', probeId: request.id, confirmed: true }
			},
			{ ...owner, id: 'other', role: 'operator' }
		)
	).rejects.toThrow(/another/);
	await f.submit({
		id: crypto.randomUUID(),
		command: { type: 'meshProbeCancel', probeId: request.id, confirmed: true }
	});
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('cancelled');
	expect((await f.snapshot()).bedMesh.active?.name).toBe('default');
});
it('retains an uncertain reservation after lost acknowledgement and never replays', async () => {
	const f = await fixture(async (op) => {
			if (op.type === 'probe') throw new MoonrakerCommandError({ sent: true });
		}),
		request = f.begin();
	await f.submit(request);
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('uncertain');
	expect((await f.snapshot()).actions[0].status).toBe('unknown');
	await f.submit(request);
	expect(f.operations.map((o) => o.type)).toEqual(['home', 'probe']);
	await expect(f.submit(f.begin())).rejects.toThrow(/owns/);
	await expect(
		f.submit({
			id: crypto.randomUUID(),
			command: { type: 'move', target: { x: 0 }, expectedPosition: { x: 0, y: 0, z: 0 } }
		})
	).rejects.toThrow(/Only/);
});
it('verifies a saved named profile after restart and never overwrites default', async () => {
	const f = await fixture(),
		request = f.begin();
	await f.submit(request);
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('review');
	await expect(
		f.submit({
			id: crypto.randomUUID(),
			command: { type: 'meshProbeFinish', probeId: request.id, outcome: 'save', name: 'default' }
		})
	).rejects.toThrow(/reserved/);
	await f.submit({
		id: crypto.randomUUID(),
		command: { type: 'meshProbeFinish', probeId: request.id, outcome: 'save', name: 'reviewed-bed' }
	});
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('saved');
	expect((await f.snapshot()).bedMesh.profiles.map((p) => p.name)).toEqual([
		'default',
		'reviewed-bed'
	]);
});
it('revalidates authorization immediately before dispatch', async () => {
	const f = await fixture(),
		request = f.begin();
	let allowed = true;
	await f.submit(request, { ...owner, authorized: () => allowed });
	allowed = false;
	await expect.poll(async () => (await f.snapshot()).actions[0]?.status).toBe('failed');
	expect(f.operations).toEqual([]);
});
it('keeps recovery metadata after storage failure and retries only journal writes', async () => {
	const f = await fixture(),
		request = f.begin();
	await f.submit(request);
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('review');
	await f.runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`CREATE TRIGGER deny_terminal BEFORE UPDATE ON actions WHEN NEW.status='completed' BEGIN SELECT RAISE(FAIL,'fixture'); END`;
		})
	);
	await f.submit({
		id: crypto.randomUUID(),
		command: { type: 'meshProbeFinish', probeId: request.id, outcome: 'apply' }
	});
	await expect.poll(async () => (await f.snapshot()).storage).toBe('degraded');
	const session = (await f.snapshot()).meshProbe.session!;
	expect(session.id).toBe(request.id);
	expect(session.previousProfile).toBe('default');
	expect(session.previousMesh?.points[0][0]).toBe(0);
	expect(session.stage).toBe('uncertain');
	expect(f.operations.map((o) => o.type)).toEqual(['home', 'probe', 'keep']);
	await f.runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`DROP TRIGGER deny_terminal`;
		})
	);
	await expect.poll(async () => (await f.snapshot()).storage).toBe('healthy');
	expect(f.operations.map((o) => o.type)).toEqual(['home', 'probe', 'keep']);
});
it('does not dispatch when the admission journal cannot be written', async () => {
	const f = await fixture();
	await f.runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`CREATE TRIGGER deny_insert BEFORE INSERT ON actions BEGIN SELECT RAISE(FAIL,'fixture'); END`;
		})
	);
	await expect(f.submit(f.begin())).rejects.toThrow(/persist/);
	expect(f.operations).toEqual([]);
	expect((await f.snapshot()).meshProbe.session).toBeNull();
});
it('restores a durable reservation after backend restart without replaying', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'perilune-live-mesh-'));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const filename = join(directory, 'printer.sqlite');
	const first = await fixture(undefined, filename),
		request = first.begin();
	await first.submit(request);
	await expect.poll(async () => (await first.snapshot()).meshProbe.session?.stage).toBe('review');
	await first.runtime.dispose();
	const second = await fixture(undefined, filename);
	expect((await second.snapshot()).meshProbe.session).toMatchObject({
		id: request.id,
		stage: 'uncertain',
		previousProfile: 'default'
	});
	expect(second.operations).toEqual([]);
	await second.submit(request);
	expect(second.operations).toEqual([]);
	await expect(second.submit(second.begin())).rejects.toThrow(/owns/);
});
it('preserves review when a profile appears after save admission', async () => {
	const f = await fixture(),
		request = f.begin();
	await f.submit(request);
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('review');
	await f.submit({
		id: crypto.randomUUID(),
		command: { type: 'meshProbeFinish', probeId: request.id, outcome: 'save', name: 'new-profile' }
	});
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			bedMesh: {
				...s.bedMesh,
				profiles: [...s.bedMesh.profiles, { ...s.bedMesh.active!, name: 'new-profile' }]
			}
		}))
	);
	await expect.poll(async () => (await f.snapshot()).actions[0].status).toBe('failed');
	expect((await f.snapshot()).meshProbe.session?.stage).toBe('review');
	expect(f.operations.map((o) => o.type)).toEqual(['home', 'probe']);
});
it('does not probe if an external client changes the baseline during homing', async () => {
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	const f = await fixture(async (op) => {
			if (op.type === 'home') await held;
		}),
		request = f.begin();
	await f.submit(request);
	await expect.poll(() => f.operations.map((o) => o.type)).toEqual(['home']);
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			bedMesh: {
				...s.bedMesh,
				active: {
					...s.bedMesh.active!,
					points: s.bedMesh.active!.points.map((r) => r.map((v) => v + 0.2))
				}
			}
		}))
	);
	release();
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('uncertain');
	expect(f.operations.map((o) => o.type)).toEqual(['home']);
});
it('counts current Klipper probe-coordinate readings without applying offsets twice', async () => {
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	const f = await fixture(async (op) => {
		if (op.type === 'probe') await held;
	});
	const request = f.begin();
	await f.submit(request);
	await expect.poll(() => f.operations.map((o) => o.type)).toEqual(['home', 'probe']);
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			probeResponses: [
				{ sequence: 1, x: 30, y: 30, space: 'probe' as const },
				{ sequence: 2, x: 30, y: 30, space: 'probe' as const }
			]
		}))
	);
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.completedSamples).toBe(1);
	release();
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('review');
});
it('refuses profile writes when the bounded list cannot prove uniqueness', async () => {
	const f = await fixture();
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			bedMesh: { ...s.bedMesh, omittedProfiles: 1 }
		}))
	);
	await expect.poll(async () => (await f.snapshot()).bedMesh.omittedProfiles).toBe(1);
	await expect(f.submit(f.begin())).rejects.toThrow(/complete profile/);
	expect(f.operations).toEqual([]);
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			bedMesh: { ...s.bedMesh, omittedProfiles: 0 }
		}))
	);
	await expect.poll(async () => (await f.snapshot()).bedMesh.omittedProfiles).toBe(0);
	const request = f.begin();
	await f.submit(request);
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('review');
	await f.submit({
		id: crypto.randomUUID(),
		command: {
			type: 'meshProbeFinish',
			probeId: request.id,
			outcome: 'save',
			name: 'hidden-profile'
		}
	});
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			bedMesh: { ...s.bedMesh, omittedProfiles: 1 }
		}))
	);
	await expect.poll(async () => (await f.snapshot()).actions[0].status).toBe('failed');
	expect(f.operations.map((o) => o.type)).toEqual(['home', 'probe']);
	expect((await f.snapshot()).meshProbe.session?.stage).toBe('review');
});
it('refuses an existing internal run name rather than overwriting it', async () => {
	const f = await fixture(),
		request = f.begin();
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			bedMesh: {
				...s.bedMesh,
				profiles: [
					...s.bedMesh.profiles,
					{ ...s.bedMesh.active!, name: `perilune_${request.id.replaceAll('-', '')}` }
				]
			}
		}))
	);
	await expect.poll(async () => (await f.snapshot()).bedMesh.profiles.length).toBe(2);
	await expect(f.submit(request)).rejects.toThrow(/internal profile/);
	expect(f.operations).toEqual([]);
});
it('rechecks candidate capacity after homing before dispatching the probe', async () => {
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	const f = await fixture(async (op) => {
			if (op.type === 'home') await held;
		}),
		request = f.begin();
	await f.submit(request);
	await expect.poll(() => f.operations.map((o) => o.type)).toEqual(['home']);
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({
			...s,
			bedMesh: {
				...s.bedMesh,
				profiles: [
					...s.bedMesh.profiles,
					...Array.from({ length: 30 }, (_, i) => ({ ...s.bedMesh.active!, name: `external-${i}` }))
				]
			}
		}))
	);
	release();
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('uncertain');
	expect(f.operations.map((o) => o.type)).toEqual(['home']);
});
it('does not hide an external manual-probe session started during homing', async () => {
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	const f = await fixture(async (op) => {
			if (op.type === 'home') await held;
		}),
		request = f.begin();
	await f.submit(request);
	await expect.poll(() => f.operations.map((o) => o.type)).toEqual(['home']);
	await Effect.runPromise(
		SubscriptionRef.update(f.state, (s) => ({ ...s, motion: { ...s.motion, calibration: true } }))
	);
	release();
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('uncertain');
	expect(f.operations.map((o) => o.type)).toEqual(['home']);
});

it('emergency epoch prevents probing after a delayed home acknowledgement', async () => {
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	const f = await fixture(async (op) => {
		if (op.type === 'home') await held;
	});
	await f.submit(f.begin());
	await expect.poll(() => f.operations.map((o) => o.type)).toEqual(['home']);
	printerInterlock(f.printer.state).interrupt();
	release();
	await expect.poll(async () => (await f.snapshot()).meshProbe.session?.stage).toBe('uncertain');
	expect(f.operations.map((o) => o.type)).toEqual(['home']);
});
