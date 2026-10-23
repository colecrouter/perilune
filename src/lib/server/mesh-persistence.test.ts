import { afterEach, expect, it, vi } from 'vite-plus/test';
import { Effect, Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { createHash } from 'node:crypto';
import {
	MeshPersistence,
	MeshPersistenceLive,
	meshPending,
	savedMesh
} from './mesh-persistence.js';
import {
	ConfigurationService,
	ConfigurationSettings,
	ConfigurationError
} from './config-service.js';
import { MoonrakerService, emptyMoonrakerSnapshot, type MoonrakerSnapshot } from './moonraker.js';
import { pendingConfigurationText } from './pending-configuration.js';
import type { ConfigSources } from '#lib/domain/config-sources.js';
const owner = { id: 'fixture-owner', name: 'Owner', authorized: () => true };
const original = {
	min_x: '0',
	min_y: '0',
	max_x: '100',
	max_y: '100',
	points: '0,0\n0,0',
	x_count: '2',
	y_count: '2',
	mesh_x_pps: '2',
	mesh_y_pps: '2',
	algo: 'lagrange',
	tension: '0.2',
	version: '1'
};
const measured = { ...original, points: '0.1,0.2\n0.3,0.4' };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const f of cleanup.splice(0).reverse()) await f();
	vi.unstubAllGlobals();
});
async function fixture() {
	let config: Record<string, any> = {
		'bed_mesh default': { ...original },
		'bed_mesh alternate': { ...original }
	};
	let pending: Record<string, any> = {};
	let pendingFlag = false;
	let startup = true;
	let corrupt = false;
	let hiddenGenerated = false;
	let badUpload = false,
		lostUpload = false;
	let macro = '';
	const hash = (s: string) => createHash('sha256').update(s).digest('hex');
	const sources = (): ConfigSources => ({
		root: 'printer.cfg',
		fingerprint: hash(text),
		dependencies: [{ path: 'printer.cfg', version: hash(text) }],
		definitions: Object.entries(config).flatMap(([section, values]) =>
			Object.entries(values).map(([option, value]) => ({
				path: 'printer.cfg',
				line: 1,
				section,
				option,
				value: String(value),
				generated: !(hiddenGenerated && section === 'probe'),
				multiline: String(value).includes('\n')
			}))
		)
	});
	let text = pendingConfigurationText(
		'# Fixture\n',
		{ root: 'printer.cfg', fingerprint: '', dependencies: [], definitions: [] },
		config
	);
	const state = await Effect.runPromise(
		SubscriptionRef.make<MoonrakerSnapshot>({
			...emptyMoonrakerSnapshot(),
			connection: 'connected' as const,
			klippy: 'ready' as const,
			telemetryReady: true,
			generation: 1,
			restartSerial: 0
		})
	);
	const writes: string[] = [];
	vi.stubGlobal('fetch', async (input: URL, init: RequestInit) => {
		const url = new URL(input);
		if (init.method === 'POST') {
			writes.push(url.pathname);
			if (init.body instanceof FormData) {
				text = badUpload ? '# Wrong bytes\n' : await (init.body.get('file') as Blob).text();
				if (lostUpload) throw Error('Lost upload acknowledgement');
				return Response.json({ result: {} });
			}
			const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
			if (body.script === 'SAVE_CONFIG') {
				const removed = Object.entries(pending)
					.filter(([, v]) => v === null)
					.map(([k]) => k);
				text = pendingConfigurationText(
					text,
					sources(),
					Object.fromEntries(Object.entries(pending).filter(([, v]) => v !== null)),
					removed
				);
				for (const [section, value] of Object.entries(pending)) {
					if (value === null) delete config[section];
					else config[section] = value;
				}
			}
			if (url.pathname === '/printer/restart' && !text.includes('#*#')) {
				for (const [section, value] of Object.entries(pending))
					if (value === null) delete config[section];
			}
			pending = {};
			pendingFlag = false;
			if (corrupt) config['bed_mesh default'].algo = 'bicubic';
			if (startup)
				await Effect.runPromise(
					SubscriptionRef.update(state, (s) => ({
						...s,
						restartSerial: (s.restartSerial ?? 0) + 1,
						generation: s.generation + 1
					}))
				);
		}
		return Response.json({
			result: {
				status: {
					configfile: {
						config: {
							...config,
							...(macro ? { 'gcode_macro START_PRINT': { gcode: macro } } : {})
						},
						save_config_pending: pendingFlag,
						save_config_pending_items: pending
					},
					print_stats: { state: 'complete' },
					idle_timeout: { state: 'Idle' },
					manual_probe: { is_active: false },
					heaters: { available_heaters: [] }
				}
			}
		});
	});
	const files = Layer.succeed(ConfigurationService, {
		sources: () => Effect.succeed(sources()),
		read: () =>
			Effect.succeed({
				path: 'printer.cfg',
				version: hash(text),
				text,
				source: 'moonraker' as const,
				backups: [],
				updatedAt: 0
			}),
		list: () => Effect.succeed([]),
		backup: () => Effect.succeed(''),
		save: () => Effect.fail(new ConfigurationError({ message: 'Unused' }))
	});
	const runtime = ManagedRuntime.make(
		MeshPersistenceLive.pipe(
			Layer.provide(files),
			Layer.provide(SqliteClient.layer({ filename: ':memory:' })),
			Layer.provide(
				Layer.succeed(ConfigurationSettings, { moonrakerUrl: 'http://fixture.invalid' })
			),
			Layer.provide(
				Layer.succeed(MoonrakerService, {
					state,
					command: () => Effect.void,
					refresh: () => SubscriptionRef.get(state)
				})
			)
		)
	);
	cleanup.push(() => runtime.dispose());
	const service = await runtime.runPromise(MeshPersistence);
	const candidate = savedMesh({ 'bed_mesh default': measured }, 'default')!;
	return {
		runtime,
		service,
		state,
		writes,
		candidate,
		originalText: text,
		readText: () => text,
		corruptUpload: () => {
			badUpload = true;
		},
		loseUploadAcknowledgement: () => {
			lostUpload = true;
		},
		withOverriddenGenerated: (comment = '') => {
			hiddenGenerated = true;
			config.probe = { z_offset: '1' };
			text =
				text.replace('# Fixture\n', '# Fixture\n[probe]\nz_offset: 1\n') +
				'#*#\n#*# [probe]' +
				comment +
				'\n#*# z_offset = 999\n';
		},
		onlyDefault: () => {
			delete config['bed_mesh alternate'];
			text = pendingConfigurationText(
				'# Fixture\n',
				{ root: 'printer.cfg', fingerprint: '', dependencies: [], definitions: [] },
				config
			);
		},
		changeLoaded: (name: string, values: Record<string, string>) => {
			config['bed_mesh ' + name] = values;
		},
		setText: (v: string) => {
			text = v;
		},
		stage: (value: Record<string, any>) => {
			pending = value;
			pendingFlag = true;
		},
		macro: (v: string) => {
			macro = v;
		},
		corruptOnRestart: () => {
			corrupt = true;
		},
		noStartup: () => {
			startup = false;
		}
	};
}
it('saves only the reviewed mesh and verifies durable bytes plus startup notification', async () => {
	const f = await fixture();
	await f.runtime.runPromise(
		f.service.capture('save', owner, savedMesh({ 'bed_mesh default': original }, 'default'))
	);
	f.stage({ 'bed_mesh default': measured });
	await f.runtime.runPromise(
		f.service.finish('save', owner, f.candidate, ['default'], false, () => true)
	);
	expect(f.writes).toEqual(['/printer/gcode/script']);
	expect(f.readText()).toContain('0.1,0.2');
	expect(await f.runtime.runPromise(f.service.reconcile('save', owner))).toBe('saved');
});
it('discards without writing the saved file and verifies cleared pending settings', async () => {
	const f = await fixture();
	await f.runtime.runPromise(f.service.capture('discard', owner, null));
	f.stage({ 'bed_mesh default': measured });
	await f.runtime.runPromise(
		f.service.finish('discard', owner, f.candidate, ['default'], true, () => true)
	);
	expect(f.writes).toEqual(['/printer/restart']);
	expect(f.readText()).toBe(f.originalText);
});
it('blocks unrelated pending changes and changed saved source before any restart', async () => {
	const f = await fixture();
	await f.runtime.runPromise(f.service.capture('conflict', owner, null));
	f.stage({ 'bed_mesh default': measured, extruder: { pid_kp: '30' } });
	await expect(
		f.runtime.runPromise(
			f.service.finish('conflict', owner, f.candidate, ['default'], false, () => true)
		)
	).rejects.toThrow(/Unrelated/);
	expect(f.writes).toEqual([]);
	f.stage({ 'bed_mesh default': measured });
	f.setText(f.originalText + '# external change\n');
	await expect(
		f.runtime.runPromise(
			f.service.finish('conflict', owner, f.candidate, ['default'], true, () => true)
		)
	).rejects.toThrow(/configuration changed/);
	expect(f.writes).toEqual([]);
});
it('requires identical interpolation settings, not just points', () => {
	const candidate = savedMesh({ 'bed_mesh default': measured }, 'default')!;
	expect(() =>
		meshPending({ 'bed_mesh default': { ...measured, algo: 'bicubic' } }, candidate, ['default'])
	).toThrow(/no longer match/);
});
it('supports reviewed section removal while preserving other saved profiles', async () => {
	const f = await fixture();
	await f.runtime.runPromise(f.service.capture('delete', owner, null));
	await f.runtime.runPromise(f.service.prepareRemoval('delete', owner, 'alternate'));
	f.stage({ 'bed_mesh alternate': null });
	await f.runtime.runPromise(
		f.service.finish('delete', owner, f.candidate, [], false, () => true, ['alternate'])
	);
	expect(f.readText()).not.toContain('[bed_mesh alternate]');
	expect(f.readText()).toContain('[bed_mesh default]');
	expect(f.writes).toEqual(['/printer/gcode/script']);
});
it('blocks deletion when a known macro refers to the target and when authorization changes', async () => {
	const f = await fixture();
	f.macro('BED_MESH_PROFILE LOAD=alternate');
	await f.runtime.runPromise(f.service.capture('ref', owner, null));
	await expect(
		f.runtime.runPromise(f.service.prepareRemoval('ref', owner, 'alternate'))
	).rejects.toThrow(/macro refers/);
	f.stage({ 'bed_mesh default': measured });
	await expect(
		f.runtime.runPromise(
			f.service.finish(
				'ref',
				{ ...owner, authorized: () => false },
				f.candidate,
				['default'],
				false,
				() => true
			)
		)
	).rejects.toThrow(/owner/);
	expect(f.writes).toEqual([]);
});
it('does not accept a websocket generation change as proof of Klipper restart', async () => {
	const f = await fixture();
	await f.runtime.runPromise(f.service.capture('restart', owner, null));
	f.stage({ 'bed_mesh default': measured });
	f.noStartup();
	const abort = new AbortController();
	let completed = false;
	const result = f.runtime
		.runPromise(
			f.service.finish('restart', owner, f.candidate, ['default'], false, () => true),
			{ signal: abort.signal }
		)
		.then(
			() => {
				completed = true;
			},
			() => {}
		);
	await expect.poll(() => f.writes.length).toBe(1);
	await f.runtime.runPromise(
		SubscriptionRef.update(f.state, (s) => ({ ...s, generation: s.generation + 1 }))
	);
	expect(completed).toBe(false);
	abort.abort();
	await result;
	expect(f.writes).toHaveLength(1);
});
it('discard reconciles an intended optional copy whether or not its acknowledgement arrived', async () => {
	const f = await fixture();
	for (const present of [false, true]) {
		const id = present ? 'present-copy' : 'absent-copy';
		await f.runtime.runPromise(f.service.capture(id, owner, null));
		f.stage({ 'bed_mesh default': measured, ...(present ? { 'bed_mesh spare': measured } : {}) });
		await f.runtime.runPromise(
			f.service.check(id, owner, f.candidate, ['default', 'spare'], undefined, true)
		);
		await f.runtime.runPromise(
			f.service.finish(id, owner, f.candidate, ['default', 'spare'], true, () => true)
		);
		expect(f.readText()).toBe(f.originalText);
	}
	expect(f.writes).toEqual(['/printer/restart', '/printer/restart']);
});

it('reconciliation does not clear an unknown workflow with wrong loaded mesh parameters', async () => {
	const f = await fixture();
	await f.runtime.runPromise(f.service.capture('parameters', owner, null));
	f.stage({ 'bed_mesh default': measured });
	await f.runtime.runPromise(
		f.service.finish('parameters', owner, f.candidate, ['default'], false, () => true)
	);
	f.changeLoaded('default', { ...measured, algo: 'bicubic' });
	await expect(f.runtime.runPromise(f.service.reconcile('parameters', owner))).rejects.toThrow(
		/Loaded mesh parameters/
	);
	f.changeLoaded('default', measured);
	expect(await f.runtime.runPromise(f.service.reconcile('parameters', owner))).toBe('saved');
	expect(f.writes).toHaveLength(1);
});

it('normal discard rejects wrong loaded baseline parameters even when disk bytes are unchanged', async () => {
	const f = await fixture();
	await f.runtime.runPromise(f.service.capture('discard-parameters', owner, null));
	f.stage({ 'bed_mesh default': measured });
	f.corruptOnRestart();
	await expect(
		f.runtime.runPromise(
			f.service.finish('discard-parameters', owner, f.candidate, ['default'], true, () => true)
		)
	).rejects.toThrow(/Loaded configuration differs/);
	expect(f.readText()).toBe(f.originalText);
	expect(f.writes).toEqual(['/printer/restart']);
});

it('deletes the final autosave section with one verified upload and restart instead of a no-op SAVE_CONFIG', async () => {
	const f = await fixture();
	f.onlyDefault();
	await f.runtime.runPromise(f.service.capture('last-section', owner, null));
	await f.runtime.runPromise(f.service.prepareRemoval('last-section', owner, 'default'));
	f.stage({ 'bed_mesh default': null });
	await f.runtime.runPromise(
		f.service.finish('last-section', owner, f.candidate, [], false, () => true, ['default'])
	);
	expect(f.writes).toEqual(['/server/files/upload', '/printer/restart']);
	expect(f.readText()).toBe('# Fixture\n');
	expect(await f.runtime.runPromise(f.service.reconcile('last-section', owner))).toBe('saved');
});

it('reconciles a lost final-section upload acknowledgement without repeating the upload', async () => {
	const f = await fixture();
	f.onlyDefault();
	await f.runtime.runPromise(f.service.capture('upload-ack', owner, null));
	f.stage({ 'bed_mesh default': null });
	f.loseUploadAcknowledgement();
	await f.runtime.runPromise(
		f.service.finish('upload-ack', owner, f.candidate, [], false, () => true, ['default'])
	);
	expect(f.writes).toEqual(['/server/files/upload', '/printer/restart']);
});
it('does not restart after final-section upload bytes fail verification', async () => {
	const f = await fixture();
	f.onlyDefault();
	await f.runtime.runPromise(f.service.capture('upload-bad', owner, null));
	f.stage({ 'bed_mesh default': null });
	f.corruptUpload();
	await expect(
		f.runtime.runPromise(
			f.service.finish('upload-bad', owner, f.candidate, [], false, () => true, ['default'])
		)
	).rejects.toThrow(/No restart was sent/);
	expect(f.writes).toEqual(['/server/files/upload']);
});

it('does not remove an unrelated raw generated section hidden by an editable override', async () => {
	const f = await fixture();
	f.onlyDefault();
	f.withOverriddenGenerated();
	const before = f.readText();
	await f.runtime.runPromise(f.service.capture('hidden-generated', owner, null));
	await expect(
		f.runtime.runPromise(f.service.prepareRemoval('hidden-generated', owner, 'default'))
	).rejects.toThrow(/Other generated configuration requires review/);
	expect(f.writes).toEqual([]);
	expect(f.readText()).toBe(before);
});

it('retains unrelated generated sections with hash or semicolon comments on their headers', async () => {
	for (const comment of [' # retained calibration', ' ; retained calibration']) {
		const f = await fixture();
		f.onlyDefault();
		f.withOverriddenGenerated(comment);
		const before = f.readText();
		await f.runtime.runPromise(f.service.capture('commented-header', owner, null));
		await expect(
			f.runtime.runPromise(f.service.prepareRemoval('commented-header', owner, 'default'))
		).rejects.toThrow(/Other generated configuration requires review/);
		expect(f.writes).toEqual([]);
		expect(f.readText()).toBe(before);
	}
});

it('saves a new mesh with its owned temporary tombstone and preserves every baseline profile', async () => {
	const f = await fixture();
	await f.runtime.runPromise(f.service.capture('new', owner, null, null, 'perilune_new'));
	f.stage({ 'bed_mesh perilune_new': null, 'bed_mesh fresh': measured });
	await f.runtime.runPromise(
		f.service.finish('new', owner, f.candidate, ['fresh'], false, () => true)
	);
	expect(f.readText()).toContain('[bed_mesh default]');
	expect(f.readText()).toContain('[bed_mesh alternate]');
	expect(f.readText()).toContain('[bed_mesh fresh]');
	expect(f.readText()).not.toContain('perilune_new');
	expect(await f.runtime.runPromise(f.service.reconcile('new', owner))).toBe('saved');
	expect(f.writes).toHaveLength(1);
});
it('new discard accepts an owned tombstone or empty pending state but refuses unrelated entries', async () => {
	const f = await fixture();
	await f.runtime.runPromise(f.service.capture('new', owner, null, null, 'perilune_new'));
	f.stage({ 'bed_mesh perilune_new': null });
	await f.runtime.runPromise(
		f.service.check('new', owner, f.candidate, ['perilune_new', 'fresh'], undefined, 'all')
	);
	f.stage({});
	await f.runtime.runPromise(
		f.service.check('new', owner, f.candidate, ['perilune_new', 'fresh'], undefined, 'all')
	);
	f.stage({ probe: { z_offset: '1' } });
	await expect(
		f.runtime.runPromise(
			f.service.finish('new', owner, f.candidate, ['perilune_new', 'fresh'], true, () => true)
		)
	).rejects.toThrow();
	expect(f.writes).toHaveLength(0);
	f.stage({ 'bed_mesh perilune_new': null });
	await f.runtime.runPromise(
		f.service.finish('new', owner, f.candidate, ['perilune_new', 'fresh'], true, () => true)
	);
	expect(f.readText()).toBe(f.originalText);
	expect(f.writes).toEqual(['/printer/restart']);
});
it('new names must be absent from loaded and raw configuration sources', async () => {
	const f = await fixture();
	await f.runtime.runPromise(f.service.capture('new', owner, null, null, 'perilune_new'));
	await expect(
		f.runtime.runPromise(f.service.prepareName('new', owner, 'default'))
	).rejects.toThrow(/already/);
	const g = await fixture();
	g.setText(g.originalText + '#*# [bed_mesh perilune_hidden] # retained\n#*# points = 0,0\n');
	await expect(
		g.runtime.runPromise(g.service.capture('hidden', owner, null, null, 'perilune_hidden'))
	).rejects.toThrow(/already/);
	expect(g.writes).toHaveLength(0);
});
