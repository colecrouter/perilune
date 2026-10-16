import { pendingConfigurationText } from './pending-configuration.js';
import { resolveConfigSources } from './config-sources.js';
import { printerInterlock } from './printer-admission.js';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';
import { Effect, Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import {
	ConfigurationApplicationService,
	ConfigurationApplicationServiceLive,
	ConfigurationApplicationSettings
} from './config-application-service.js';
import {
	ConfigurationService,
	ConfigurationServiceLive,
	ConfigurationSettings,
	type ConfigActor
} from './config-service.js';
import { PrinterService } from './printer-service.js';
import type { TemperatureSample } from '#lib/domain/temperature.js';
import { initialLiveSnapshot } from '#lib/domain/printer.js';
const owner: ConfigActor = { id: 'owner', name: 'Owner', authorized: () => true };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const f of cleanup.splice(0).reverse()) await f();
});
async function fixture() {
	const f = {
		text: '[printer]\nmax_velocity: 200\n',
		uploads: 0,
		restarts: 0,
		ticks: 0,
		error: false,
		dropped: false,
		noTransition: false,
		serverStartupOnly: false,
		transient: false,
		pending: false,
		manifest: { probe: { z_offset: '1.250' } },
		saves: 0,
		changePendingOnRead: false,
		mainPath: '/private/config/printer.cfg',
		target: 0,
		manualProbe: false,
		extraTarget: 0,
		uploadAck: undefined as (() => Promise<void>) | undefined
	};
	const server = createServer((request, response) => {
		void (async () => {
			response.setHeader('Content-Type', 'application/json');
			let result: unknown;
			if (request.url === '/server/files/roots')
				result = [{ name: 'config', path: '/private/config', permissions: 'rw' }];
			else if (request.url === '/server/files/list?root=config')
				result = [{ path: 'printer.cfg', size: f.text.length, modified: 1, permissions: 'rw' }];
			else if (request.url === '/server/files/config/printer.cfg') {
				if (f.changePendingOnRead) {
					f.manifest.probe.z_offset = '2.500';
					f.changePendingOnRead = false;
				}
				response.end(f.text);
				return;
			} else if (request.url?.startsWith('/printer/objects/query'))
				result = {
					status: {
						print_stats: { state: 'standby' },
						idle_timeout: { state: 'Idle' },
						configfile: { save_config_pending: f.pending, save_config_pending_items: f.manifest },
						heaters: { available_heaters: ['extruder', 'heater_bed', 'heater_generic chamber'] },
						manual_probe: { is_active: f.manualProbe },
						'heater_generic chamber': { target: f.extraTarget },
						extruder: { target: f.target },
						heater_bed: { target: 0 }
					}
				};
			else if (request.url === '/printer/info')
				result = {
					state: f.ticks > 0 ? 'startup' : f.error ? 'error' : 'ready',
					config_file: f.mainPath,
					state_message: f.error
						? "Option 'bad' is not valid in section 'printer'"
						: 'Printer is ready'
				};
			else if (request.url === '/printer/gcode/script') {
				let body = '';
				for await (const part of request) body += part;
				if (JSON.parse(body).script !== 'SAVE_CONFIG') throw Error('unexpected script');
				f.saves++;
				const sources = await resolveConfigSources('printer.cfg', ['printer.cfg'], async () => ({
					path: 'printer.cfg',
					text: f.text,
					version: f.text,
					source: 'moonraker',
					backups: [],
					updatedAt: 0
				}));
				f.text = pendingConfigurationText(f.text, sources, f.manifest);
				f.pending = false;
				f.ticks = 2;
				if (f.dropped) {
					request.socket.destroy();
					return;
				}
				result = 'ok';
			} else if (request.url === '/server/info') {
				if (f.transient) {
					f.transient = false;
					response.statusCode = 503;
					response.end('{}');
					return;
				}
				result = {
					klippy_state:
						f.serverStartupOnly || f.ticks-- > 0 ? 'startup' : f.error ? 'error' : 'ready'
				};
			} else if (request.url === '/server/files/upload') {
				const chunks: Uint8Array[] = [];
				for await (const chunk of request) chunks.push(chunk);
				const body = new Request('http://fixture.test', {
					method: 'POST',
					headers: { 'Content-Type': String(request.headers['content-type']) },
					body: new Blob([Uint8Array.from(Buffer.concat(chunks))])
				});
				const form = await body.formData();
				f.text = await (form.get('file') as File).text();
				f.uploads++;
				if (f.dropped) {
					f.dropped = false;
					request.socket.destroy();
					return;
				}
				await f.uploadAck?.();
				result = { item: { path: 'printer.cfg', root: 'config' } };
			} else if (request.url === '/printer/restart') {
				f.restarts++;
				f.ticks = f.noTransition ? 0 : 2;
				f.error = f.text.includes('bad:');
				result = 'ok';
			} else {
				response.statusCode = 404;
				result = {};
			}
			response.end(JSON.stringify({ result }));
		})().catch(() => {
			response.statusCode = 500;
			response.end('{}');
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address() as { port: number };
	cleanup.push(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return { f, url: `ws://127.0.0.1:${address.port}/websocket` };
}
async function app(
	url: string,
	filename = ':memory:',
	enabled = true,
	klipperWorkingDirectory?: string
) {
	const database = SqliteClient.layer({ filename });
	const settings = Layer.succeed(ConfigurationSettings, {
		moonrakerUrl: url,
		requestTimeoutMs: 500,
		klipperWorkingDirectory
	});
	const config = ConfigurationServiceLive.pipe(Layer.provide(settings), Layer.provide(database));
	const state = await Effect.runPromise(SubscriptionRef.make(initialLiveSnapshot()));
	const printer = Layer.succeed(PrinterService, {
		state,
		temperatureHistory: await Effect.runPromise(SubscriptionRef.make<TemperatureSample[]>([])),
		submit: () => Effect.die('Unused'),
		setConnection: () => Effect.void,
		reset: Effect.void,
		ingest: () => Effect.void
	});
	const runtime = ManagedRuntime.make(
		ConfigurationApplicationServiceLive.pipe(
			Layer.provideMerge(config),
			Layer.provide(settings),
			Layer.provide(printer),
			Layer.provide(
				Layer.succeed(ConfigurationApplicationSettings, { enabled, verifyMs: 160, pollMs: 10 })
			),
			Layer.provideMerge(database)
		)
	);
	cleanup.push(() => runtime.dispose());
	const service = await runtime.runPromise(ConfigurationApplicationService);
	const fileService = await runtime.runPromise(ConfigurationService);
	const read = () => runtime.runPromise(fileService.read('printer.cfg', owner));
	const status = () => runtime.runPromise(service.status(owner));
	const submit = async (text: string, id = randomUUID(), actor = owner) => {
		const current = await read();
		return runtime.runPromise(
			service.submit(
				{ id, path: current.path, text, expectedVersion: current.version, confirmedRestart: true },
				actor
			)
		);
	};
	const terminal = async () => {
		await expect
			.poll(
				async () =>
					['queued', 'writing', 'restarting'].includes((await status()).application?.phase ?? ''),
				{ timeout: 4000 }
			)
			.toBe(false);
		return (await status()).application!;
	};
	return { runtime, service, read, status, submit, terminal, state };
}
it('persists snapshots before dispatch, verifies fresh startup, deduplicates, and reverts exact bytes', async () => {
	const { f, url } = await fixture(),
		a = await app(url),
		before = f.text,
		id = randomUUID();
	const request = {
		id,
		path: 'printer.cfg',
		expectedVersion: (await a.read()).version,
		text: before.replace('200', '180'),
		confirmedRestart: true as const
	};
	await a.runtime.runPromise(a.service.submit(request, owner));
	expect(await a.runtime.runPromise(a.service.snapshot(id, 'before', owner))).toBe(before);
	expect((await a.terminal()).phase).toBe('ready');
	await a.runtime.runPromise(a.service.submit(request, owner));
	expect(f.uploads).toBe(1);
	expect(f.restarts).toBe(1);
	await a.runtime.runPromise(
		a.service.submit({ id: randomUUID(), revertOf: id, confirmedRestart: true }, owner)
	);
	expect((await a.terminal()).phase).toBe('ready');
	expect(f.text).toBe(before);
	expect(f.restarts).toBe(2);
});
it('keeps complete startup errors available and refuses to overwrite external edits on revert', async () => {
	const { f, url } = await fixture(),
		a = await app(url);
	const saved = await a.submit(f.text + 'bad: 1\n');
	const result = await a.terminal();
	expect(result.phase).toBe('error');
	expect(result.diagnostic).toContain("Option 'bad'");
	f.text += '# changed elsewhere\n';
	await a.runtime.runPromise(
		a.service.submit({ id: randomUUID(), revertOf: saved.id, confirmedRestart: true }, owner)
	);
	const reverted = await a.terminal();
	expect(reverted.phase).toBe('error');
	expect(f.uploads).toBe(1);
	expect(reverted.message).toContain('changed');
});
it('does not replay a dropped upload acknowledgement and permits explicit read-only reconciliation', async () => {
	const { f, url } = await fixture(),
		a = await app(url);
	f.dropped = true;
	const saved = await a.submit(f.text.replace('200', '180'));
	expect((await a.terminal()).phase).toBe('unknown');
	expect(f.uploads).toBe(1);
	expect(f.restarts).toBe(0);
	await expect(a.submit(f.text + '# next\n')).rejects.toThrow('unknown');
	const checked = await a.runtime.runPromise(a.service.check(saved.id, owner));
	expect(checked.writeVerified).toBe(true);
	expect(checked.phase).toBe('error');
	expect(f.uploads).toBe(1);
});
it('never treats a transport error followed by unchanged ready state as restart verification', async () => {
	const { f, url } = await fixture(),
		a = await app(url);
	f.noTransition = true;
	f.transient = true;
	await a.submit(f.text.replace('200', '180'));
	expect((await a.terminal()).phase).toBe('unknown');
	expect(f.restarts).toBe(1);
});
it('fences disabled, revoked, heated and pending-autosave submissions before writes', async () => {
	const { f, url } = await fixture(),
		disabled = await app(url, ':memory:', false);
	await expect(disabled.submit(f.text + '# draft\n')).rejects.toThrow('disabled');
	const a = await app(url);
	f.target = 200;
	await expect(a.submit(f.text + '# draft\n')).rejects.toThrow('heaters');
	f.target = 0;
	f.pending = true;
	await expect(a.submit(f.text + '# draft\n')).rejects.toThrow('SAVE_CONFIG');
	f.pending = false;
	let valid = true;
	await a.submit(f.text + '# draft\n', randomUUID(), { ...owner, authorized: () => valid });
	valid = false;
	expect((await a.terminal()).phase).toBe('error');
	expect(f.uploads).toBe(0);
	await expect(
		a.runtime.runPromise(
			a.service.snapshot('missing', 'before', { ...owner, authorized: () => false })
		)
	).rejects.toThrow('owner');
});
it('recovers interrupted records as unknown across process restarts without replaying commands', async () => {
	const { f, url } = await fixture();
	const directory = await mkdtemp(join(tmpdir(), 'perilune-recovery-test-'));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const filename = join(directory, 'state.sqlite'),
		a = await app(url, filename);
	const id = randomUUID(),
		before = f.text;
	await a.runtime.runPromise(
		Effect.flatMap(
			SqlClient,
			(sql) =>
				sql`INSERT INTO config_applications(id,actor_id,fingerprint,record,before_text,after_text,expires_at) VALUES(${id},${owner.id},'fixture',${JSON.stringify({ id, path: 'printer.cfg', mode: 'apply', target: createHash('sha256').update(url).digest('hex'), phase: 'writing', message: 'Pending', diagnostic: null, createdAt: Date.now(), updatedAt: Date.now(), writeVerified: false, revertOf: null })},${before},${before + '# staged\n'},${Date.now() + 30000})`
		)
	);
	await a.runtime.dispose();
	const b = await app(url, filename);
	expect((await b.status()).application?.phase).toBe('unknown');
	expect((await Effect.runPromise(SubscriptionRef.get(b.state))).configurationBusy).toBe(true);
	await expect(b.submit(f.text + '# next\n')).rejects.toThrow('unknown');
	expect(f.uploads).toBe(0);
	expect(f.restarts).toBe(0);
	expect(await b.runtime.runPromise(b.service.snapshot(id, 'before', owner))).toBe(before);
});
it('rolls back partial admission when snapshot retention fails, leaving no orphan queue or reservation', async () => {
	const { f, url } = await fixture(),
		a = await app(url);
	await a.runtime.runPromise(
		Effect.flatMap(SqlClient, (sql) =>
			Effect.gen(function* () {
				for (let i = 0; i < 20; i++)
					yield* sql`INSERT INTO config_applications(id,actor_id,fingerprint,record,before_text,after_text,expires_at) VALUES(${randomUUID()},'fixture','fixture',${JSON.stringify({ phase: 'ready' })},'','',0)`;
				yield* sql`CREATE TRIGGER fail_retention BEFORE DELETE ON config_applications BEGIN SELECT RAISE(ABORT,'fixture retention failure'); END`;
			})
		)
	);
	await expect(a.submit(f.text + '# new\n')).rejects.toThrow('storage');
	expect((await Effect.runPromise(SubscriptionRef.get(a.state))).configurationBusy).toBe(false);
	expect(f.uploads).toBe(0);
	await a.runtime.runPromise(Effect.flatMap(SqlClient, (sql) => sql`DROP TRIGGER fail_retention`));
	await a.submit(f.text + '# new\n');
	expect((await a.terminal()).phase).toBe('ready');
});
it('a verified restore cannot be toggled back, and an explicit restore retry skips an already-restored upload', async () => {
	const { f, url } = await fixture(),
		a = await app(url),
		before = f.text;
	const applied = await a.submit(before.replace('200', '180'));
	await a.terminal();
	f.noTransition = true;
	const restore = await a.runtime.runPromise(
		a.service.submit({ id: randomUUID(), revertOf: applied.id, confirmedRestart: true }, owner)
	);
	expect((await a.terminal()).phase).toBe('unknown');
	expect(f.text).toBe(before);
	await a.runtime.runPromise(a.service.check(restore.id, owner));
	f.noTransition = false;
	const retry = await a.runtime.runPromise(
		a.service.submit({ id: randomUUID(), revertOf: restore.id, confirmedRestart: true }, owner)
	);
	expect((await a.terminal()).phase).toBe('ready');
	expect(f.text).toBe(before);
	expect(f.uploads).toBe(2);
	await expect(
		a.runtime.runPromise(
			a.service.submit({ id: randomUUID(), revertOf: retry.id, confirmedRestart: true }, owner)
		)
	).rejects.toThrow('latest');
});

it('does not mistake an old ready response during Moonraker startup for a completed restart', async () => {
	const { f, url } = await fixture(),
		a = await app(url);
	f.noTransition = true;
	f.serverStartupOnly = true;
	await a.submit(f.text.replace('200', '180'));
	expect((await a.terminal()).phase).toBe('unknown');
	expect(f.restarts).toBe(1);
});

it('emergency epoch prevents restarting Klipper after a delayed upload acknowledgement', async () => {
	const { f, url } = await fixture(),
		a = await app(url);
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	f.uploadAck = () => held;
	await a.submit(f.text.replace('200', '180'));
	await expect.poll(() => f.uploads).toBe(1);
	printerInterlock(a.state).interrupt();
	release();
	await a.terminal();
	expect(f.restarts).toBe(0);
});

it('rejects fresh manual probes and additional configured heaters before writes', async () => {
	const { f, url } = await fixture(),
		a = await app(url);
	f.manualProbe = true;
	await expect(a.submit(f.text + '# reviewed\n')).rejects.toThrow('manual-probe');
	f.manualProbe = false;
	f.extraTarget = 40;
	await expect(a.submit(f.text + '# reviewed\n')).rejects.toThrow('heaters');
	expect(f.uploads).toBe(0);
	expect(f.restarts).toBe(0);
});
it('reviews all pending settings, sends SAVE_CONFIG once, verifies exact bytes and supports revert', async () => {
	const { f, url } = await fixture(),
		a = await app(url);
	f.pending = true;
	const calibrationRun = randomUUID();
	await a.runtime.runPromise(
		SubscriptionRef.update(a.state, (s) => ({
			...s,
			liveZ: {
				session: {
					id: calibrationRun,
					ownerId: 'owner',
					ownerName: 'Owner',
					version: 2,
					stage: 'staged' as const,
					method: 'probe' as const,
					z: null,
					candidate: 1.25,
					setting: 'probe.z_offset',
					startedAt: Date.now(),
					expiresAt: Date.now() + 60000,
					message: null
				}
			}
		}))
	);
	const review = await a.runtime.runPromise(a.service.reviewPending(owner));
	expect(review.manifest).toEqual(f.manifest);
	const request = {
		id: randomUUID(),
		pending: review.fingerprint,
		sources: review.sources,
		confirmedRestart: true as const
	};
	await a.runtime.runPromise(a.service.submit(request, owner));
	const result = await a.terminal();
	expect(result).toMatchObject({
		phase: 'ready',
		mode: 'calibration',
		writeVerified: true,
		calibrationRun
	});
	expect(f.saves).toBe(1);
	expect(f.uploads).toBe(0);
	expect(f.restarts).toBe(0);
	await a.runtime.runPromise(a.service.submit(request, owner));
	expect(f.saves).toBe(1);
	await a.runtime.runPromise(
		a.service.submit({ id: randomUUID(), revertOf: result.id, confirmedRestart: true }, owner)
	);
	expect(await a.terminal()).toMatchObject({ phase: 'ready', mode: 'revert', calibrationRun });
	expect(f.text).toBe('[printer]\nmax_velocity: 200\n');
});
it('rejects changed pending manifests and source dependencies without saving', async () => {
	const { f, url } = await fixture(),
		a = await app(url);
	f.pending = true;
	const review = await a.runtime.runPromise(a.service.reviewPending(owner));
	f.manifest.probe.z_offset = '2.000';
	await expect(
		a.runtime.runPromise(
			a.service.submit(
				{
					id: randomUUID(),
					pending: review.fingerprint,
					sources: review.sources,
					confirmedRestart: true
				},
				owner
			)
		)
	).rejects.toThrow('Pending settings changed');
	f.manifest.probe.z_offset = '1.250';
	f.text += '# external change\n';
	await expect(
		a.runtime.runPromise(
			a.service.submit(
				{
					id: randomUUID(),
					pending: review.fingerprint,
					sources: review.sources,
					confirmedRestart: true
				},
				owner
			)
		)
	).rejects.toThrow('sources changed');
	expect(f.saves).toBe(0);
});
it('does not replay SAVE_CONFIG after a lost acknowledgement and verifies bytes only through recovery', async () => {
	const { f, url } = await fixture(),
		a = await app(url);
	f.pending = true;
	f.dropped = true;
	const review = await a.runtime.runPromise(a.service.reviewPending(owner));
	await a.runtime.runPromise(
		a.service.submit(
			{
				id: randomUUID(),
				pending: review.fingerprint,
				sources: review.sources,
				confirmedRestart: true
			},
			owner
		)
	);
	const result = await a.terminal();
	expect(result.phase).toBe('unknown');
	expect(result.writeVerified).toBe(false);
	expect(f.saves).toBe(1);
	await a.runtime.runPromise(a.service.check(result.id, owner));
	expect((await a.status()).application?.writeVerified).toBe(true);
	expect(f.saves).toBe(1);
});

it('rechecks pending settings after source reads immediately before SAVE_CONFIG', async () => {
	const { f, url } = await fixture(),
		a = await app(url);
	f.pending = true;
	const review = await a.runtime.runPromise(a.service.reviewPending(owner));
	await a.runtime.runPromise(
		a.service.submit(
			{
				id: randomUUID(),
				pending: review.fingerprint,
				sources: review.sources,
				confirmedRestart: true
			},
			owner
		)
	);
	f.changePendingOnRead = true;
	expect((await a.terminal()).phase).toBe('error');
	expect(f.saves).toBe(0);
});

it('refuses pending saves when Klipper main file is outside the configuration root', async () => {
	const { f, url } = await fixture(),
		a = await app(url);
	f.pending = true;
	f.mainPath = '/etc/printer.cfg';
	await expect(a.runtime.runPromise(a.service.reviewPending(owner))).rejects.toThrow('outside');
	expect(f.saves).toBe(0);
});

it('resolves relative Klipper paths only with an explicit trusted process working directory', async () => {
	for (const cwd of [undefined, 'relative', '/unsafe\npath']) {
		const { f, url } = await fixture(),
			a = await app(url, ':memory:', true, cwd);
		f.pending = true;
		f.mainPath = 'config/printer.cfg';
		await expect(a.runtime.runPromise(a.service.reviewPending(owner))).rejects.toThrow(
			'working directory'
		);
	}
	const { f, url } = await fixture(),
		a = await app(url, ':memory:', true, '/private');
	f.pending = true;
	f.mainPath = 'config/printer.cfg';
	expect((await a.runtime.runPromise(a.service.reviewPending(owner))).path).toBe('printer.cfg');
	f.mainPath = '../etc/printer.cfg';
	await expect(a.runtime.runPromise(a.service.reviewPending(owner))).rejects.toThrow('outside');
});

it('does not associate a calibration save with a mismatched or non-staged Z result', async () => {
	for (const mismatch of ['value', 'setting', 'stage'] as const) {
		const { f, url } = await fixture(),
			a = await app(url);
		f.pending = true;
		await a.runtime.runPromise(
			SubscriptionRef.update(a.state, (s) => ({
				...s,
				liveZ: {
					session: {
						id: randomUUID(),
						ownerId: 'owner',
						ownerName: 'Owner',
						version: 2,
						stage: mismatch === 'stage' ? ('resolved' as const) : ('staged' as const),
						method: 'probe' as const,
						z: null,
						candidate: mismatch === 'value' ? 9 : 1.25,
						setting: mismatch === 'setting' ? 'stepper_z.position_endstop' : 'probe.z_offset',
						startedAt: Date.now(),
						expiresAt: Date.now() + 60000,
						message: null
					}
				}
			}))
		);
		const review = await a.runtime.runPromise(a.service.reviewPending(owner));
		await a.runtime.runPromise(
			a.service.submit(
				{
					id: randomUUID(),
					pending: review.fingerprint,
					sources: review.sources,
					confirmedRestart: true
				},
				owner
			)
		);
		expect((await a.terminal()).calibrationRun).toBeUndefined();
		expect(f.saves).toBe(1);
	}
});
