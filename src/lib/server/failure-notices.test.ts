import { afterEach, expect, it } from 'vite-plus/test';
import { Effect, ManagedRuntime } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { SqlClient } from 'effect/sql/SqlClient';
import { initialSnapshot, type ActionRecord } from '#lib/domain/printer.js';
import { migrate } from './migrations.js';
import { failureNotices, acknowledgeFailures } from './failure-notices.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of cleanups.splice(0)) await close();
});
async function fixture() {
	const runtime = ManagedRuntime.make(SqliteClient.layer({ filename: ':memory:' }));
	cleanups.push(() => runtime.dispose());
	await runtime.runPromise(migrate);
	const snapshot = initialSnapshot();
	let createdAt = 0;
	async function insert(
		type: string,
		probeId: string,
		status: 'completed' | 'failed',
		actor = 'owner'
	) {
		const action: ActionRecord = {
			id: crypto.randomUUID(),
			label: type,
			status,
			message: 'Receipt remains history',
			createdAt: ++createdAt
		};
		await runtime.runPromise(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO actions(id,payload,label,status,created_at,message,actor_id) VALUES(${action.id},${JSON.stringify({ type, probeId })},${action.label},${status},${action.createdAt},${action.message},${actor})`;
			})
		);
		snapshot.actions.push(action);
		return action;
	}
	return {
		runtime,
		snapshot,
		insert,
		read: (owner = 'owner') => runtime.runPromise(failureNotices(snapshot, owner))
	};
}
it.each(['meshProbeCancel', 'meshProbeFinish', 'meshProbeReconcile'])(
	'a completed %s resolves alerts for exactly its workflow without changing history',
	async (type) => {
		const f = await fixture();
		const failed = await f.insert('meshProbeCancel', 'original', 'failed');
		const other = await f.insert('meshProbeCancel', 'other', 'failed');
		expect((await f.read()).map((a) => a.id)).toEqual([other.id, failed.id]);
		await f.insert(type, 'original', 'failed');
		expect(await f.read()).toHaveLength(3);
		await f.insert(type, 'original', 'completed');
		expect((await f.read()).map((a) => a.id)).toEqual([other.id]);
		expect(f.snapshot.actions.find((a) => a.id === failed.id)?.status).toBe('failed');
		// A later failure in a different workflow still needs attention.
		const newer = await f.insert('meshProbeBegin', 'new', 'failed');
		expect((await f.read()).map((a) => a.id)).toEqual([newer.id, other.id]);
	}
);
it('acknowledgements are durable server state, account-scoped and limited to visible receipts', async () => {
	const f = await fixture();
	const own = await f.insert('home', '', 'failed');
	const other = await f.insert('home', '', 'failed', 'other');
	await f.runtime.runPromise(acknowledgeFailures(f.snapshot, 'owner', [own.id, other.id]));
	expect(await f.read()).toEqual([]);
	expect((await f.read('other')).map((a) => a.id)).toEqual([other.id]);
	// New server reads already omit acknowledgements; no hydration/storage read is needed.
	expect(await f.read()).toEqual([]);
	const fresh = await f.insert('home', '', 'failed');
	expect((await f.read()).map((a) => a.id)).toEqual([fresh.id]);
});
