import { SqlClient } from 'effect/sql/SqlClient';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { Layer, ManagedRuntime } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { filamentChangeCapability } from './filament-change-capability.js';
import { FilamentChangeStore, FilamentChangeStoreLive } from './filament-change-settings.js';
import { defaultFilamentChangeSettings, filamentSetupReason } from '#lib/domain/filament-change.js';
import { emptyMoonrakerSnapshot, normalizeMoonrakerStatus } from './moonraker.js';

it('discovers loaded macros without gcode.help and never returns macro bodies', () => {
	const config = { 'gcode_macro M600': { gcode: 'PAUSE\nG1 E-50' }, pause_resume: {} };
	const cap = filamentChangeCapability(['gcode_macro M600', 'pause_resume'], config)!;
	expect(cap.m600).toBe(true);
	expect(cap.pauseResume).toBe(true);
	expect(JSON.stringify(cap)).not.toContain('G1 E-50');
	expect(cap.findings.join(' ')).toContain('not been verified');
	expect(filamentChangeCapability([], config)?.m600).toBe(false);
	expect(filamentChangeCapability([], undefined)).toBeNull();
	const modified = filamentChangeCapability(['gcode_macro M600', 'pause_resume'], {
		...config,
		'gcode_macro M600': { gcode: 'PAUSE' }
	})!;
	expect(modified.fingerprint).not.toBe(cap.fingerprint);
	expect(
		filamentChangeCapability(['pause_resume', 'gcode_macro M600'], {
			pause_resume: {},
			'gcode_macro M600': { gcode: 'PAUSE\nG1 E-50' }
		})?.fingerprint
	).toBe(cap.fingerprint);
	expect(
		filamentChangeCapability(['pause_resume', 'gcode_macro M600'], {
			...config,
			stepper_z: { position_max: '100' }
		})?.fingerprint
	).not.toBe(cap.fingerprint);
	const settings = {
		...defaultFilamentChangeSettings,
		mode: 'printer' as const,
		reviewed: true,
		fingerprint: cap.fingerprint
	};
	expect(filamentSetupReason(settings, cap)).toBeNull();
	expect(filamentSetupReason(settings, modified)).toContain('changed');
	expect(filamentSetupReason({ ...settings, reviewed: false }, cap)).toContain('Review');
	expect(filamentSetupReason({ ...settings, mode: 'assisted' }, cap)).toContain('not enabled');
});
it('keeps pause_resume telemetry independent from print_stats guesses', () => {
	const previous = emptyMoonrakerSnapshot();
	expect(
		normalizeMoonrakerStatus(
			{ pause_resume: { is_paused: true }, print_stats: { state: 'printing' } },
			previous
		).paused
	).toBe(true);
	expect(normalizeMoonrakerStatus({}, previous).paused).toBeNull();
});
it('isolates printers and uses revision compare-and-swap for concurrent setup edits', async () => {
	const runtime = ManagedRuntime.make(
		FilamentChangeStoreLive.pipe(Layer.provide(SqliteClient.layer({ filename: ':memory:' })))
	);
	try {
		const store = await runtime.runPromise(FilamentChangeStore);
		expect(await runtime.runPromise(store.get('printer-a'))).toEqual(defaultFilamentChangeSettings);
		expect(await runtime.runPromise(store.put('printer-a', defaultFilamentChangeSettings))).toBe(
			true
		);
		const first = await runtime.runPromise(store.get('printer-a'));
		expect(first.revision).toBe(1);
		const results = await Promise.all([
			runtime.runPromise(store.put('printer-a', { ...first, changeMacro: 'FIRST' })),
			runtime.runPromise(store.put('printer-a', { ...first, changeMacro: 'SECOND' }))
		]);
		expect(results.sort()).toEqual([false, true]);
		expect((await runtime.runPromise(store.get('printer-a'))).revision).toBe(2);
		expect(await runtime.runPromise(store.put('printer-a', defaultFilamentChangeSettings))).toBe(
			false
		);
		expect(await runtime.runPromise(store.put('missing', { ...first, revision: 9 }))).toBe(false);
		expect(await runtime.runPromise(store.get('printer-b'))).toEqual(defaultFilamentChangeSettings);
	} finally {
		await runtime.dispose();
	}
});

it('retains setup plans through a backend restart', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'perilune-filament-'));
	const filename = join(directory, 'state.sqlite');
	const make = () =>
		ManagedRuntime.make(
			FilamentChangeStoreLive.pipe(Layer.provide(SqliteClient.layer({ filename })))
		);
	let runtime = make();
	try {
		let store = await runtime.runPromise(FilamentChangeStore);
		await runtime.runPromise(
			store.put('printer', { ...defaultFilamentChangeSettings, changeMacro: 'CUSTOM_CHANGE' })
		);
		await runtime.dispose();
		runtime = make();
		store = await runtime.runPromise(FilamentChangeStore);
		expect(await runtime.runPromise(store.get('printer'))).toMatchObject({
			revision: 1,
			changeMacro: 'CUSTOM_CHANGE'
		});
	} finally {
		await runtime.dispose();
		await rm(directory, { recursive: true, force: true });
	}
});

it('prevents setup replacement while any action reservation or filament session owns the printer', async () => {
	const runtime = ManagedRuntime.make(
		FilamentChangeStoreLive.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })))
	);
	try {
		const store = await runtime.runPromise(FilamentChangeStore);
		const sql = await runtime.runPromise(SqlClient);
		await runtime.runPromise(
			sql`INSERT INTO live_action_reservation(target,action_id) VALUES('printer','pending')`
		);
		expect(await runtime.runPromise(store.put('printer', defaultFilamentChangeSettings))).toBe(
			false
		);
		await runtime.runPromise(sql`DELETE FROM live_action_reservation`);
		await runtime.runPromise(
			sql`INSERT INTO filament_change_sessions(target,state) VALUES('printer','{"stage":"review"}')`
		);
		expect(await runtime.runPromise(store.put('printer', defaultFilamentChangeSettings))).toBe(
			false
		);
		await runtime.runPromise(sql`UPDATE filament_change_sessions SET state='{"stage":"finished"}'`);
		expect(await runtime.runPromise(store.put('printer', defaultFilamentChangeSettings))).toBe(
			true
		);
	} finally {
		await runtime.dispose();
	}
});
