import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { Layer, ManagedRuntime } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { defaultPreferences, preferencePatch } from '#lib/domain/preferences.js';
import { PreferenceService, PreferenceServiceLive } from './preference-service.js';
it('keeps account settings separate and merges concurrent changes without replacing other fields', async () => {
	const runtime = ManagedRuntime.make(
		PreferenceServiceLive.pipe(Layer.provide(SqliteClient.layer({ filename: ':memory:' })))
	);
	try {
		const service = await runtime.runPromise(PreferenceService);
		expect(await runtime.runPromise(service.get('first'))).toEqual(defaultPreferences);
		await Promise.all([
			runtime.runPromise(service.patch('first', { serif: false })),
			runtime.runPromise(service.patch('first', { jobsPageSize: 25 }))
		]);
		expect(await runtime.runPromise(service.get('first'))).toMatchObject({
			serif: false,
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
			service.patch('owner', { serif: false, consoleFilter: 'errors', jobsPageSize: 25 })
		);
		await runtime.dispose();
		runtime = make();
		service = await runtime.runPromise(PreferenceService);
		expect(await runtime.runPromise(service.get('owner'))).toMatchObject({
			serif: false,
			consoleFilter: 'errors',
			jobsPageSize: 25
		});
		expect(await runtime.runPromise(service.get('different-owner'))).toEqual(defaultPreferences);
	} finally {
		await runtime.dispose();
		await rm(directory, { recursive: true, force: true });
	}
});
