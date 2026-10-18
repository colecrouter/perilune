import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { Effect, ManagedRuntime } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { SqlClient } from 'effect/sql/SqlClient';
import { migrate } from './migrations.js';
import { recordJobOwner, jobOwner } from './job-attribution.js';
it('persists verified ownership across restart using durable identity and refuses contradictory or unknown identity', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'perilune-attribution-'));
	const make = () =>
		ManagedRuntime.make(SqliteClient.layer({ filename: join(directory, 'state.sqlite') }));
	let runtime = make();
	try {
		await runtime.runPromise(migrate);
		await runtime.runPromise(recordJobOwner('run-one', 'action-one', 'owner-one', 'upstream-one'));
		expect(await runtime.runPromise(jobOwner('run-one'))).toBe('owner-one');
		await runtime.dispose();
		runtime = make();
		expect(await runtime.runPromise(jobOwner('new-process-run', 'upstream-one'))).toBe('owner-one');
		expect(await runtime.runPromise(jobOwner('run-one', 'different-upstream'))).toBeNull();
		expect(await runtime.runPromise(jobOwner('different-run', 'unknown-upstream'))).toBeNull();
		expect(await runtime.runPromise(jobOwner('different-run'))).toBeNull();
	} finally {
		await runtime.dispose();
		await rm(directory, { recursive: true, force: true });
	}
});
it('rolls ownership back with a failed receipt transaction', async () => {
	const runtime = ManagedRuntime.make(SqliteClient.layer({ filename: ':memory:' }));
	try {
		await runtime.runPromise(migrate);
		await expect(
			runtime.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							yield* recordJobOwner('run', 'action', 'owner');
							return yield* Effect.fail('receipt failed');
						})
					);
				})
			)
		).rejects.toBeDefined();
		expect(await runtime.runPromise(jobOwner('run'))).toBeNull();
	} finally {
		await runtime.dispose();
	}
});

it('keeps verified process ownership when later history was unavailable at dispatch, without claiming it durably', async () => {
	const runtime = ManagedRuntime.make(SqliteClient.layer({ filename: ':memory:' }));
	try {
		await runtime.runPromise(migrate);
		await runtime.runPromise(recordJobOwner('local', 'receipt', 'owner'));
		expect(await runtime.runPromise(jobOwner('local', 'late-history'))).toBe('owner');
		expect(await runtime.runPromise(jobOwner('another-process', 'late-history'))).toBeNull();
	} finally {
		await runtime.dispose();
	}
});

it('bounds attribution storage while keeping the new claim when timestamps tie', async () => {
	const runtime = ManagedRuntime.make(SqliteClient.layer({ filename: ':memory:' }));
	try {
		await runtime.runPromise(migrate);
		const sql = await runtime.runPromise(SqlClient);
		await runtime.runPromise(
			sql`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<5001) INSERT INTO job_attribution SELECT 'run-'||n,'action-'||n,'owner',NULL,${Date.now()} FROM seq`
		);
		await runtime.runPromise(recordJobOwner('new', 'new-action', 'new-owner'));
		expect(
			(await runtime.runPromise(sql<{ n: number }>`SELECT COUNT(*) AS n FROM job_attribution`))[0]!
				.n
		).toBe(5000);
		expect(await runtime.runPromise(jobOwner('new'))).toBe('new-owner');
	} finally {
		await runtime.dispose();
	}
});
