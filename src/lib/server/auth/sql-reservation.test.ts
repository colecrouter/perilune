import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { expect, it } from 'vite-plus/test';
import { PreferenceService, PreferenceServiceLive } from '../preference-service.js';
import { createAuthService, digest } from './service.js';
import { sqlTransactionReservation } from './sql-reservation.js';

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const details = {
	token: 'fixture',
	name: 'Owner',
	email: 'owner@example.test',
	password: 'fixture-account-password'
};
function fixture() {
	const directory = mkdtempSync(join(tmpdir(), 'perilune-auth-reservation-'));
	const filename = join(directory, 'state.sqlite');
	const service = createAuthService(filename, 'http://localhost:4181');
	service.db
		.prepare('INSERT INTO enrollment VALUES (?,?,?,?,NULL,?)')
		.run(digest(details.token), 'owner', 'setup', Date.now() + 60000, Date.now());
	const runtime = ManagedRuntime.make(
		PreferenceServiceLive.pipe(Layer.provideMerge(SqliteClient.layer({ filename })))
	);
	const reserve = sqlTransactionReservation(() => runtime.runPromise(SqliteClient.SqliteClient));
	service.setTransactionReservation(reserve);
	return {
		service,
		runtime,
		reserve,
		close: async () => {
			await runtime.dispose();
			service.close();
			rmSync(directory, { recursive: true, force: true });
		}
	};
}
it('queues Effect SQL writes while real Better Auth enrollment owns the connection reservation', async () => {
	const f = fixture();
	let background: Promise<unknown> | undefined;
	try {
		const sql = await f.runtime.runPromise(SqliteClient.SqliteClient);
		const preferences = await f.runtime.runPromise(PreferenceService);
		let acquisitions = 0;
		f.service.setTransactionReservation(async () => {
			const release = await f.reserve();
			// The first reservation claims the token; the second starts Better Auth's transaction.
			if (++acquisitions === 2) {
				let finished = false;
				background = f.runtime
					.runPromise(
						Effect.all(
							[
								sql`INSERT INTO auth_audit(event,created) VALUES ('background',0)`,
								preferences.patch('fixture-owner', { serif: false })
							],
							{ concurrency: 'unbounded' }
						)
					)
					.then(() => {
						finished = true;
					});
				const start = Date.now();
				await pause(25);
				expect(Date.now() - start).toBeLessThan(1000);
				expect(finished).toBe(false);
			}
			return release;
		});
		await f.service.enroll({ ...details });
		await background;
		expect(acquisitions).toBeGreaterThanOrEqual(3);
		expect(await f.runtime.runPromise(preferences.get('fixture-owner'))).toMatchObject({
			serif: false
		});
		expect(f.service.db.prepare('SELECT role FROM user').get()?.role).toBe('owner');
		expect(
			f.service.db.prepare("SELECT count(*) n FROM auth_audit WHERE event='background'").get()?.n
		).toBe(1);
	} finally {
		await f.close();
	}
});
it('waits asynchronously when an Effect SQL transaction precedes enrollment', async () => {
	const f = fixture();
	let unblock!: () => void;
	const hold = new Promise<void>((resolve) => {
		unblock = resolve;
	});
	let entered!: () => void;
	const ready = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let writer: Promise<unknown> | undefined;
	try {
		const sql = await f.runtime.runPromise(SqliteClient.SqliteClient);
		const preferences = await f.runtime.runPromise(PreferenceService);
		writer = f.runtime.runPromise(
			sql.withTransaction(
				Effect.gen(function* () {
					yield* sql`INSERT INTO auth_audit(event,created) VALUES ('background',0)`;
					yield* preferences.patch('fixture-owner', { serif: false });
					entered();
					yield* Effect.promise(() => hold);
				})
			)
		);
		await ready;
		let finished = false;
		const enrollment = f.service.enroll({ ...details }).then(() => {
			finished = true;
		});
		const start = Date.now();
		await pause(25);
		expect(Date.now() - start).toBeLessThan(1000);
		expect(finished).toBe(false);
		unblock();
		await Promise.all([writer, enrollment]);
		expect(f.service.db.prepare('SELECT role FROM user').get()?.role).toBe('owner');
	} finally {
		unblock();
		await writer;
		await f.close();
	}
});
