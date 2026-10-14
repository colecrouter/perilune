import { ConnectionError, SqlError } from 'effect/sql/SqlError';
import { CALIBRATION_IDLE_MS } from '#lib/domain/calibration.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { Effect, Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { ActionStore, ActionStoreLive } from './action-store.js';
import { PrinterService, makePrinterService } from './printer-service.js';
import type { PrinterCommand } from '#lib/domain/printer.js';
const actor = { id: 'operator-a', name: 'Operator A', role: 'operator', authorized: () => true };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
async function create(
	filename = ':memory:',
	wrap?: (store: typeof ActionStore.Service) => typeof ActionStore.Service
) {
	const store = wrap
		? Layer.effect(ActionStore, Effect.map(ActionStore, wrap)).pipe(Layer.provide(ActionStoreLive))
		: ActionStoreLive;
	const runtime = ManagedRuntime.make(
		makePrinterService().pipe(
			Layer.provideMerge(store),
			Layer.provide(SqliteClient.layer({ filename }))
		)
	);
	cleanup.push(() => runtime.dispose());
	const service = await runtime.runPromise(PrinterService);
	const snapshot = () => runtime.runPromise(SubscriptionRef.get(service.state));
	const submit = async (command: PrinterCommand, user = actor, id = randomUUID()) => {
		await runtime.runPromise(service.submit({ id, command }, user));
		await expect
			.poll(async () => (await snapshot()).actions.find((action) => action.id === id)?.status)
			.toBe('completed');
		return id;
	};
	const ready = () => submit({ type: 'cancel', coolBed: true, coolNozzle: true });
	const begin = async () => {
		const sessionId = randomUUID();
		await submit({
			type: 'calibrationBegin',
			sessionId,
			expectedOffset: (await snapshot()).calibration.appliedOffset,
			confirmed: true
		});
		return sessionId;
	};
	return { runtime, service, snapshot, submit, ready, begin };
}
it('binds idempotency to the actor and reserves controls across users', async () => {
	const app = await create();
	await app.ready();
	const sessionId = await app.begin();
	const request = {
		id: randomUUID(),
		command: { type: 'calibrationAdjust' as const, sessionId, version: 0, delta: -0.01 as const }
	};
	await app.runtime.runPromise(app.service.submit(request, actor));
	await app.runtime.runPromise(app.service.submit(request, actor));
	await expect(
		app.runtime.runPromise(app.service.submit(request, { ...actor, id: 'other' }))
	).rejects.toThrow('different command');
	await expect.poll(async () => (await app.snapshot()).calibration.session?.version).toBe(1);
	await expect(
		app.runtime.runPromise(
			app.service.submit({ id: randomUUID(), command: { type: 'home', axes: 'all' } }, actor)
		)
	).rejects.toThrow('Calibration owns');
	await expect(
		app.runtime.runPromise(
			app.service.submit(
				{
					id: randomUUID(),
					command: { type: 'calibrationAdjust', sessionId, version: 0, delta: 0.01 }
				},
				actor
			)
		)
	).rejects.toThrow('changed');
}, 15000);
it('revalidates revoked actor authorization before execution', async () => {
	const app = await create();
	await app.ready();
	const sessionId = await app.begin();
	let authorized = true;
	const id = randomUUID();
	await app.runtime.runPromise(
		app.service.submit(
			{ id, command: { type: 'calibrationAdjust', sessionId, version: 0, delta: 0.01 } },
			{ ...actor, authorized: () => authorized }
		)
	);
	authorized = false;
	await expect
		.poll(async () => (await app.snapshot()).actions.find((action) => action.id === id)?.status)
		.toBe('failed');
	expect((await app.snapshot()).calibration.session?.candidate).toBe(0);
}, 15000);
it('interrupts disconnected and restarted sessions without replaying adjustment', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'perilune-calibration-'));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const filename = join(directory, 'state.sqlite');
	const app = await create(filename);
	await app.ready();
	let sessionId = await app.begin();
	await app.submit({ type: 'calibrationAdjust', sessionId, version: 0, delta: -0.1 });
	await app.runtime.runPromise(app.service.setConnection(false));
	expect((await app.snapshot()).calibration.session?.stage).toBe('interrupted');
	expect((await app.snapshot()).motion.calibration).toBe(false);
	await app.runtime.runPromise(app.service.setConnection(true));
	sessionId = await app.begin();
	await app.submit({ type: 'calibrationAdjust', sessionId, version: 0, delta: 0.1 });
	await app.runtime.dispose();
	const next = await create(filename);
	expect((await next.snapshot()).calibration).toMatchObject({
		appliedOffset: 0,
		session: { stage: 'interrupted' }
	});
	expect((await next.snapshot()).motion.calibration).toBe(false);
}, 20000);
it('saves the default and action status together, and restores it after restart', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'perilune-calibration-'));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const filename = join(directory, 'state.sqlite');
	const app = await create(filename);
	await app.ready();
	const sessionId = await app.begin();
	await app.submit({ type: 'calibrationAdjust', sessionId, version: 0, delta: -0.05 });
	await app.submit({ type: 'calibrationStage', sessionId, version: 1, stage: 'first-layer' });
	await app.submit({
		type: 'calibrationStage',
		sessionId,
		version: 2,
		stage: 'review',
		confirmed: true
	});
	await app.submit({ type: 'calibrationFinish', sessionId, version: 3, outcome: 'save' });
	await app.runtime.dispose();
	const next = await create(filename);
	expect((await next.snapshot()).calibration).toMatchObject({
		savedOffset: -0.05,
		appliedOffset: -0.05,
		session: { stage: 'saved' }
	});
}, 20000);

it('expires an abandoned session and persists the interrupted checkpoint', async () => {
	const app = await create();
	await app.ready();
	await app.begin();
	const now = Date.now.bind(Date);
	const clock = vi.spyOn(Date, 'now').mockImplementation(() => now() + CALIBRATION_IDLE_MS + 1);
	try {
		await expect
			.poll(async () => (await app.snapshot()).calibration.session?.stage)
			.toBe('interrupted');
		expect((await app.snapshot()).motion.calibration).toBe(false);
		const store = await app.runtime.runPromise(ActionStore);
		expect((await app.runtime.runPromise(store.calibration)).session?.stage).toBe('interrupted');
	} finally {
		clock.mockRestore();
	}
}, 15000);
it.each(['before', 'after'] as const)(
	'handles %s-commit save failure without replaying the command',
	async (when) => {
		let saves = 0;
		const app = await create(':memory:', (store) => ({
			...store,
			commitCalibration: (id, status, message, state) =>
				state.session?.stage === 'saved'
					? Effect.gen(function* () {
							saves++;
							if (when === 'after') yield* store.commitCalibration(id, status, message, state);
							return yield* Effect.fail(
								new SqlError({
									reason: new ConnectionError({
										cause: new Error('injected'),
										message: 'Injected save acknowledgement failure'
									})
								})
							);
						})
					: store.commitCalibration(id, status, message, state)
		}));
		await app.ready();
		const sessionId = await app.begin();
		await app.submit({ type: 'calibrationAdjust', sessionId, version: 0, delta: -0.05 });
		await app.submit({ type: 'calibrationStage', sessionId, version: 1, stage: 'first-layer' });
		await app.submit({
			type: 'calibrationStage',
			sessionId,
			version: 2,
			stage: 'review',
			confirmed: true
		});
		const id = randomUUID();
		await app.runtime.runPromise(
			app.service.submit(
				{ id, command: { type: 'calibrationFinish', sessionId, version: 3, outcome: 'save' } },
				actor
			)
		);
		await expect
			.poll(async () => (await app.snapshot()).actions.find((action) => action.id === id)?.status)
			.toBe('unknown');
		await expect.poll(async () => (await app.snapshot()).storage).toBe('healthy');
		expect((await app.snapshot()).calibration).toMatchObject({
			savedOffset: when === 'after' ? -0.05 : 0,
			appliedOffset: 0,
			session: { stage: 'interrupted' }
		});
		expect((await app.snapshot()).motion.calibration).toBe(false);
		const store = await app.runtime.runPromise(ActionStore);
		expect((await app.runtime.runPromise(store.find(id)))?.action.status).toBe('unknown');
		expect(saves).toBe(1);
	},
	20000
);
