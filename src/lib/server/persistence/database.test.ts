import { expect, it } from 'vite-plus/test';
import { Cause, Effect, ManagedRuntime } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { databaseQuery, makeDatabase } from './database.js';
import { userPreferences } from './schema.js';

it('reuses the process client without creating schema and preserves nested rollback', async () => {
	const runtime = ManagedRuntime.make(SqliteClient.layer({ filename: ':memory:' }));
	try {
		const sql = await runtime.runPromise(SqliteClient.SqliteClient);
		const before = await runtime.runPromise(sql`SELECT name FROM sqlite_schema`);
		const db = await runtime.runPromise(makeDatabase);
		expect(db.$client).toBe(sql);
		expect(await runtime.runPromise(sql`SELECT name FROM sqlite_schema`)).toEqual(before);
		await runtime.runPromise(
			sql`CREATE TABLE user_preferences(owner TEXT PRIMARY KEY,value TEXT NOT NULL)`
		);
		await runtime.runPromise(
			sql.withTransaction(
				Effect.gen(function* () {
					yield* db.insert(userPreferences).values({ owner: 'outer', value: '{}' });
					yield* db
						.transaction(() =>
							Effect.gen(function* () {
								yield* db.insert(userPreferences).values({ owner: 'inner', value: '{}' });
								return yield* Effect.fail('inner rollback');
							})
						)
						.pipe(Effect.catch(() => Effect.void));
				})
			)
		);
		expect(await runtime.runPromise(sql`SELECT owner FROM user_preferences`)).toEqual([
			{ owner: 'outer' }
		]);
	} finally {
		await runtime.dispose();
	}
});

it('sanitizes unexpected ORM failures without keeping query parameters or arbitrary causes', async () => {
	const error = new EffectDrizzleQueryError({
		query: 'fixture',
		params: ['private-fixture'],
		cause: Cause.fail(new Error('private-fixture'))
	});
	const result = await Effect.runPromise(databaseQuery(Effect.fail(error)).pipe(Effect.flip));
	expect(result._tag).toBe('SqlError');
	expect(result.reason._tag).toBe('UnknownError');
	expect(JSON.stringify(result)).not.toContain('private-fixture');
});
