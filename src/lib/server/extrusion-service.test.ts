import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';
import { Effect, Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import { SqlError, ConnectionError } from 'effect/sql/SqlError';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { ActionStore, ActionStoreLive } from './action-store.js';
import { makePrinterService, PrinterService } from './printer-service.js';
import type { PrinterCommand } from '#lib/domain/printer.js';
const actor = { id: 'operator', name: 'Operator', role: 'operator' };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const f of cleanup.splice(0).reverse()) await f();
});
async function create(
	filename = ':memory:',
	wrap?: (store: typeof ActionStore.Service) => typeof ActionStore.Service
) {
	const store = wrap
		? Layer.effect(ActionStore, Effect.map(ActionStore, wrap)).pipe(Layer.provide(ActionStoreLive))
		: ActionStoreLive;
	const runtime = ManagedRuntime.make(
		makePrinterService('simulator', '20 millis').pipe(
			Layer.provideMerge(store),
			Layer.provide(SqliteClient.layer({ filename }))
		)
	);
	cleanup.push(() => runtime.dispose());
	const service = await runtime.runPromise(PrinterService);
	const snapshot = () => runtime.runPromise(SubscriptionRef.get(service.state));
	const submit = async (
		command: PrinterCommand,
		user = actor,
		id = 'runId' in command && ['extrusionBegin', 'extrusionFeed'].includes(command.type)
			? command.runId
			: randomUUID()
	) => {
		await runtime.runPromise(service.submit({ id, command }, user));
		await expect
			.poll(async () => (await snapshot()).actions.find((a) => a.id === id)?.status)
			.toBe('completed');
		return id;
	};
	const ready = () => submit({ type: 'cancel', coolBed: true, coolNozzle: false });
	const begin = async (user = actor) => {
		const runId = randomUUID();
		await submit(
			{ type: 'extrusionBegin', runId, rotationDistance: 7.5, before: 70, confirmed: true },
			user
		);
		return runId;
	};
	const measured = () =>
		expect.poll(async () => (await snapshot()).extrusion.session?.stage).toBe('measure');
	return { runtime, service, snapshot, submit, ready, begin, measured };
}
it('shares progress across clients, fences actors and idempotency, and holds the controls through review', async () => {
	const app = await create();
	await app.ready();
	const runId = await app.begin();
	await app.runtime.runPromise(
		app.service.submit(
			{
				id: runId,
				command: {
					type: 'extrusionBegin',
					runId,
					rotationDistance: 7.5,
					before: 70,
					confirmed: true
				}
			},
			actor
		)
	);
	await expect(
		app.runtime.runPromise(
			app.service.submit(
				{
					id: runId,
					command: {
						type: 'extrusionBegin',
						runId,
						rotationDistance: 7.5,
						before: 70,
						confirmed: true
					}
				},
				{ ...actor, id: 'other' }
			)
		)
	).rejects.toThrow('different command');
	await expect(
		app.runtime.runPromise(
			app.service.submit({ id: randomUUID(), command: { type: 'home', axes: 'all' } }, actor)
		)
	).rejects.toThrow('owns');
	await app.measured();
	await app.submit({ type: 'extrusionMeasure', runId, after: 22 });
	expect((await app.snapshot()).motion.calibration).toBe(true);
	await app.submit({ type: 'extrusionFinish', runId, coolNozzle: false });
	expect((await app.snapshot()).extrusion.session?.proposal?.proposed).toBe(7.2);
	expect((await app.snapshot()).heaters.nozzle.target).toBe(210);
});
it('interrupts on disconnect, authorization loss, and cooldown without resuming', async () => {
	const app = await create();
	await app.ready();
	await app.begin();
	await app.runtime.runPromise(app.service.setConnection(false));
	expect((await app.snapshot()).extrusion.session?.stage).toBe('interrupted');
	await app.runtime.runPromise(app.service.setConnection(true));
	expect((await app.snapshot()).extrusion.session?.stage).toBe('interrupted');
	let authorized = true;
	await app.begin({ ...actor, authorized: () => authorized } as typeof actor);
	authorized = false;
	await expect
		.poll(async () => (await app.snapshot()).extrusion.session?.stage)
		.toBe('interrupted');
	await app.begin();
	await app.submit({ type: 'cooldown' });
	await expect
		.poll(async () => (await app.snapshot()).extrusion.session?.stage)
		.toBe('interrupted');
});
it('restart retains finished proposals but interrupts unfinished movement', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'perilune-extrusion-'));
	cleanup.push(() => rm(dir, { recursive: true, force: true }));
	const filename = join(dir, 'state.sqlite');
	const first = await create(filename);
	await first.ready();
	const runId = await first.begin();
	await first.measured();
	await first.submit({ type: 'extrusionMeasure', runId, after: 22 });
	await first.submit({ type: 'extrusionFinish', runId, coolNozzle: true });
	await first.runtime.dispose();
	const second = await create(filename);
	expect((await second.snapshot()).extrusion.session).toMatchObject({
		stage: 'finished',
		proposal: { proposed: 7.2 }
	});
	await second.ready();
	await second.begin();
	await second.runtime.dispose();
	const third = await create(filename);
	expect((await third.snapshot()).extrusion.session?.stage).toBe('interrupted');
	expect((await third.snapshot()).motion.calibration).toBe(false);
}, 10_000);

for (const afterCommit of [false, true])
	it(`storage acknowledgement loss ${afterCommit ? 'after' : 'before'} commit never replays movement`, async () => {
		let fail = false,
			calls = 0;
		const app = await create(':memory:', (store) => ({
			...store,
			commitExtrusion: (id, status, message, state) =>
				Effect.gen(function* () {
					if (!fail) return yield* store.commitExtrusion(id, status, message, state);
					fail = false;
					calls++;
					if (afterCommit) yield* store.commitExtrusion(id, status, message, state);
					return yield* Effect.fail(
						new SqlError({
							reason: new ConnectionError({ cause: new Error('fixture storage failure') })
						})
					);
				})
		}));
		await app.ready();
		fail = true;
		const id = randomUUID();
		const command = {
			type: 'extrusionBegin' as const,
			runId: id,
			rotationDistance: 7.5,
			before: 70,
			confirmed: true
		};
		await app.runtime.runPromise(app.service.submit({ id, command }, actor));
		await expect
			.poll(async () => (await app.snapshot()).actions.find((a) => a.id === id)?.status)
			.toBe('unknown');
		await expect.poll(async () => (await app.snapshot()).storage).toBe('healthy');
		expect((await app.snapshot()).motion.calibration).toBe(false);
		expect((await app.snapshot()).extrusion.session?.stage ?? null).toBe(
			afterCommit ? 'interrupted' : null
		);
		await app.runtime.runPromise(app.service.submit({ id, command }, actor));
		expect(calls).toBe(1);
		expect((await app.snapshot()).extrusion.session?.completed ?? 0).toBe(0);
	});

it('retains a committed finished proposal when its acknowledgement is lost', async () => {
	let fail = false,
		calls = 0;
	const app = await create(':memory:', (store) => ({
		...store,
		commitExtrusion: (id, status, message, state) =>
			Effect.gen(function* () {
				yield* store.commitExtrusion(id, status, message, state);
				if (fail) {
					fail = false;
					calls++;
					return yield* Effect.fail(
						new SqlError({ reason: new ConnectionError({ cause: new Error('fixture lost ack') }) })
					);
				}
			})
	}));
	await app.ready();
	const runId = await app.begin();
	await app.measured();
	await app.submit({ type: 'extrusionMeasure', runId, after: 22 });
	fail = true;
	const id = randomUUID();
	await app.runtime.runPromise(
		app.service.submit(
			{ id, command: { type: 'extrusionFinish', runId, coolNozzle: false } },
			actor
		)
	);
	await expect
		.poll(async () => (await app.snapshot()).actions.find((a) => a.id === id)?.status)
		.toBe('unknown');
	await expect.poll(async () => (await app.snapshot()).storage).toBe('healthy');
	expect((await app.snapshot()).extrusion.session).toMatchObject({
		stage: 'finished',
		proposal: { proposed: 7.2 }
	});
	expect((await app.snapshot()).motion.calibration).toBe(false);
	expect(calls).toBe(1);
}, 10_000);
