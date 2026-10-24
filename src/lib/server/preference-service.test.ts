import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { Effect, Exit, Layer, ManagedRuntime } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { overviewPreset } from '#lib/domain/overview-layout.js';
import { defaultPreferences, preferencePatch } from '#lib/domain/preferences.js';
import { isSqlError } from 'effect/sql/SqlError';
import { PreferenceService, PreferenceServiceLive } from './preference-service.js';
it('keeps account settings separate and merges concurrent changes without replacing other fields', async () => {
	const runtime = ManagedRuntime.make(
		PreferenceServiceLive.pipe(Layer.provide(SqliteClient.layer({ filename: ':memory:' })))
	);
	try {
		const service = await runtime.runPromise(PreferenceService);
		expect(await runtime.runPromise(service.get('first'))).toEqual(defaultPreferences);
		await Promise.all([
			runtime.runPromise(
				service.patch('first', { serif: false, overviewLayout: overviewPreset('compact') })
			),
			runtime.runPromise(service.patch('first', { jobsPageSize: 25 }))
		]);
		expect(await runtime.runPromise(service.get('first'))).toMatchObject({
			serif: false,
			overviewLayout: overviewPreset('compact'),
			jobsPageSize: 25
		});
		expect(await runtime.runPromise(service.get('second'))).toEqual(defaultPreferences);
	} finally {
		await runtime.dispose();
	}
});
it('rejects unsupported and physical fields instead of silently persisting them', () => {
	for (const value of [
		{},
		{ target: 200 },
		{ serif: 'false' },
		{ jobsPageSize: 1000 },
		{ consoleFilter: 'private' },
		{ temperatureMinutes: Infinity }
	])
		expect(() => preferencePatch(value)).toThrow();
	expect(preferencePatch({ serif: false, consoleCompact: true })).toEqual({
		serif: false,
		consoleCompact: true
	});
});

it('retains preferences through service restart', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'perilune-preferences-'));
	const filename = join(directory, 'state.sqlite');
	const make = () =>
		ManagedRuntime.make(
			PreferenceServiceLive.pipe(Layer.provide(SqliteClient.layer({ filename })))
		);
	let runtime = make();
	try {
		let service = await runtime.runPromise(PreferenceService);
		await runtime.runPromise(
			service.patch('owner', {
				serif: false,
				consoleFilter: 'errors',
				jobsPageSize: 25,
				overviewLayout: overviewPreset('camera')
			})
		);
		await runtime.dispose();
		runtime = make();
		service = await runtime.runPromise(PreferenceService);
		expect(await runtime.runPromise(service.get('owner'))).toMatchObject({
			serif: false,
			overviewLayout: overviewPreset('camera'),
			consoleFilter: 'errors',
			jobsPageSize: 25
		});
		expect(await runtime.runPromise(service.get('different-owner'))).toEqual(defaultPreferences);
	} finally {
		await runtime.dispose();
		await rm(directory, { recursive: true, force: true });
	}
});

it('joins existing Effect transactions and rolls back interrupted preference writes', async () => {
	const runtime = ManagedRuntime.make(
		PreferenceServiceLive.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })))
	);
	try {
		const service = await runtime.runPromise(PreferenceService);
		const sql = await runtime.runPromise(SqliteClient.SqliteClient);
		const failed = await runtime.runPromiseExit(
			sql.withTransaction(
				Effect.gen(function* () {
					yield* service.patch('owner', { serif: false });
					return yield* Effect.fail('rollback');
				})
			)
		);
		expect(Exit.isFailure(failed)).toBe(true);
		expect(await runtime.runPromise(service.get('owner'))).toEqual(defaultPreferences);
		const controller = new AbortController();
		let entered!: () => void;
		const written = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const pending = runtime.runPromiseExit(
			sql.withTransaction(
				Effect.gen(function* () {
					yield* service.patch('owner', { serif: false });
					entered();
					return yield* Effect.never;
				})
			),
			{ signal: controller.signal }
		);
		await written;
		controller.abort();
		expect(Exit.isFailure(await pending)).toBe(true);
		expect(await runtime.runPromise(service.get('owner'))).toEqual(defaultPreferences);
	} finally {
		await runtime.dispose();
	}
});

it('reads existing JSON rows without schema changes and preserves unknown stored fields on patch', async () => {
	const runtime = ManagedRuntime.make(
		PreferenceServiceLive.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })))
	);
	try {
		const service = await runtime.runPromise(PreferenceService);
		const sql = await runtime.runPromise(SqliteClient.SqliteClient);
		const schema = await runtime.runPromise(
			sql`SELECT type,name,sql FROM sqlite_schema ORDER BY name`
		);
		await runtime.runPromise(
			sql`INSERT INTO user_preferences(owner,value) VALUES('legacy',${JSON.stringify({ serif: false, futureField: 'retained' })})`
		);
		expect(await runtime.runPromise(service.get('legacy'))).toMatchObject({ serif: false });
		await runtime.runPromise(service.patch('legacy', { jobsPageSize: 25 }));
		const rows = await runtime.runPromise(
			sql<{ value: string }>`SELECT value FROM user_preferences WHERE owner='legacy'`
		);
		expect(JSON.parse(rows[0].value)).toMatchObject({
			serif: false,
			jobsPageSize: 25,
			futureField: 'retained'
		});
		expect(
			await runtime.runPromise(sql`SELECT type,name,sql FROM sqlite_schema ORDER BY name`)
		).toEqual(schema);
		await runtime.runPromise(sql`DROP TABLE user_preferences`);
		for (const query of [
			service.get('private-owner'),
			service.patch('private-owner', { serif: false })
		]) {
			const error = await runtime.runPromise(query.pipe(Effect.flip));
			expect(isSqlError(error)).toBe(true);
			expect(String(error)).not.toContain('private-owner');
		}
	} finally {
		await runtime.dispose();
	}
});
