import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';
import { Effect, Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import { SqlError, ConnectionError } from 'effect/sql/SqlError';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { ActionStore, ActionStoreLive } from './action-store.js';
import { PrinterService, makePrinterService } from './printer-service.js';
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
		id = command.type === 'meshProbeBegin' ? command.probeId : randomUUID()
	) => {
		await runtime.runPromise(service.submit({ id, command }, user));
		await expect
			.poll(async () => (await snapshot()).actions.find((action) => action.id === id)?.status)
			.toBe('completed');
		return id;
	};
	const ready = () => submit({ type: 'cancel', coolBed: true, coolNozzle: true });
	const begin = async (user = actor) => {
		const probeId = randomUUID();
		await submit({ type: 'meshProbeBegin', probeId, confirmed: true }, user);
		return probeId;
	};
	const review = () =>
		expect.poll(async () => (await snapshot()).meshProbe.session?.stage).toBe('review');
	return { runtime, service, snapshot, submit, ready, begin, review };
}
it('binds run identity and idempotency to the actor and reserves printer controls', async () => {
	const app = await create();
	await app.ready();
	const probeId = await app.begin();
	const request = {
		id: probeId,
		command: { type: 'meshProbeBegin' as const, probeId, confirmed: true }
	};
	await app.runtime.runPromise(app.service.submit(request, actor));
	await expect(
		app.runtime.runPromise(app.service.submit(request, { ...actor, id: 'other' }))
	).rejects.toThrow('different command');
	await expect(
		app.runtime.runPromise(
			app.service.submit(
				{ id: randomUUID(), command: { ...request.command, probeId: randomUUID() } },
				actor
			)
		)
	).rejects.toThrow('unique');
	await expect(
		app.runtime.runPromise(
			app.service.submit(
				{ id: randomUUID(), command: { type: 'temperature', heater: 'bed', target: 60 } },
				actor
			)
		)
	).rejects.toThrow('owns');
	await app.review();
	await app.submit({ type: 'meshProbeFinish', probeId, outcome: 'save', name: 'reviewed' });
	expect((await app.snapshot()).meshProbe.savedProfiles[0].name).toBe('reviewed');
	expect((await app.snapshot()).bedMesh.active?.name).toBe('warm-bed');
});
it('disconnect and authorization revocation interrupt a process-owned run without resuming it', async () => {
	const app = await create();
	await app.ready();
	await app.begin();
	await app.runtime.runPromise(app.service.setConnection(false));
	expect((await app.snapshot()).meshProbe.session?.stage).toBe('interrupted');
	await app.runtime.runPromise(app.service.setConnection(true));
	expect((await app.snapshot()).motion.calibration).toBe(false);
	let authorized = true;
	const user = { ...actor, authorized: () => authorized };
	await app.begin(user);
	authorized = false;
	await expect
		.poll(async () => (await app.snapshot()).meshProbe.session?.stage)
		.toBe('interrupted');
	expect((await app.snapshot()).meshProbe.session?.result).toBeNull();
});
it('saved profiles survive restart while unfinished runs and temporary application do not', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'perilune-mesh-test-'));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const filename = join(directory, 'state.sqlite');
	const first = await create(filename);
	await first.ready();
	const id = await first.begin();
	await first.review();
	await first.submit({ type: 'meshProbeFinish', probeId: id, outcome: 'save', name: 'persisted' });
	await first.runtime.dispose();
	const second = await create(filename);
	expect(
		(await second.snapshot()).bedMesh.profiles.some((profile) => profile.name === 'persisted')
	).toBe(true);
	await second.ready();
	const temporary = await second.begin();
	await second.review();
	await second.submit({ type: 'meshProbeFinish', probeId: temporary, outcome: 'apply' });
	await second.runtime.dispose();
	const third = await create(filename);
	expect((await third.snapshot()).bedMesh.active?.name).toBe('warm-bed');
	expect((await third.snapshot()).meshProbe.session?.stage).toBe('interrupted');
	await third.ready();
	await third.begin();
	await third.runtime.dispose();
	const fourth = await create(filename);
	expect((await fourth.snapshot()).meshProbe.session?.stage).toBe('interrupted');
	expect((await fourth.snapshot()).meshProbe.savedProfiles[0].name).toBe('persisted');
}, 20000);

for (const afterCommit of [false, true])
	it(`save acknowledgement loss ${afterCommit ? 'after' : 'before'} commit is unknown and never replayed`, async () => {
		let fail = false;
		let calls = 0;
		const app = await create(':memory:', (store) => ({
			...store,
			commitMeshProbe: (id, status, message, state) =>
				Effect.gen(function* () {
					if (!fail) return yield* store.commitMeshProbe(id, status, message, state);
					fail = false;
					calls++;
					if (afterCommit) yield* store.commitMeshProbe(id, status, message, state);
					return yield* Effect.fail(
						new SqlError({
							reason: new ConnectionError({ cause: new Error('fixture storage failure') })
						})
					);
				})
		}));
		await app.ready();
		const probeId = await app.begin();
		await app.review();
		fail = true;
		const id = randomUUID();
		await app.runtime.runPromise(
			app.service.submit(
				{ id, command: { type: 'meshProbeFinish', probeId, outcome: 'save', name: 'ambiguous' } },
				actor
			)
		);
		await expect
			.poll(async () => (await app.snapshot()).actions.find((action) => action.id === id)?.status)
			.toBe('unknown');
		await expect.poll(async () => (await app.snapshot()).storage).toBe('healthy');
		expect(
			(await app.snapshot()).meshProbe.savedProfiles.some((profile) => profile.name === 'ambiguous')
		).toBe(afterCommit);
		expect((await app.snapshot()).meshProbe.session?.stage).toBe('interrupted');
		expect(calls).toBe(1);
	});
it('does not resurrect deleted simulator compensation after backend restart', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'mesh-deletion-restart-'));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const filename = join(directory, 'state.sqlite');
	const app = await create(filename);
	await app.ready();
	const active = (await app.snapshot()).bedMesh.active!;
	await app.submit({
		type: 'meshProbeProfile',
		probeId: randomUUID(),
		operation: 'clear',
		expected: JSON.stringify(active),
		confirmed: true
	});
	await app.submit(
		{
			type: 'meshProbeProfile',
			probeId: randomUUID(),
			operation: 'delete',
			name: active.name,
			expected: JSON.stringify(active),
			confirmed: true
		},
		{ id: 'owner', name: 'Owner', role: 'owner' }
	);
	await app.runtime.dispose();
	const restarted = await create(filename);
	expect((await restarted.snapshot()).bedMesh.profiles.some((p) => p.name === active.name)).toBe(
		false
	);
	expect((await restarted.snapshot()).bedMesh.active).toBeNull();
});
