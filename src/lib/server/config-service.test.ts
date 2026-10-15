import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { afterEach, expect, it } from 'vite-plus/test';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import {
	ConfigurationService,
	ConfigurationServiceLive,
	ConfigurationSettings,
	type ConfigActor
} from './config-service.js';
const owner: ConfigActor = { id: 'owner', name: 'Owner', authorized: () => true };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const f of cleanup.splice(0).reverse()) await f();
});
async function app(url = '', requestTimeoutMs = 1000, slowTransactions = false) {
	const database = SqliteClient.layer({ filename: ':memory:' });
	const sqlLayer = slowTransactions
		? Layer.effect(
				SqlClient,
				Effect.map(
					SqlClient,
					(client) =>
						new Proxy(client, {
							get(target, key) {
								if (key === 'withTransaction')
									return (effect: Effect.Effect<unknown, unknown, unknown>) =>
										target.withTransaction(effect).pipe(Effect.delay('20 millis'));
								return Reflect.get(target, key);
							}
						})
				)
			).pipe(Layer.provide(database))
		: database;
	const runtime = ManagedRuntime.make(
		ConfigurationServiceLive.pipe(
			Layer.provide(
				Layer.succeed(ConfigurationSettings, {
					moonrakerUrl: url,
					apiKey: 'fixture-key',
					requestTimeoutMs
				})
			),
			Layer.provideMerge(sqlLayer)
		)
	);
	cleanup.push(() => runtime.dispose());
	const service = await runtime.runPromise(ConfigurationService);
	return {
		runtime,
		service,
		read: (path = 'printer.cfg', actor = owner) => runtime.runPromise(service.read(path, actor)),
		save: async (text: string, expectedVersion: string, id = randomUUID(), actor = owner) =>
			runtime.runPromise(service.save({ id, path: 'printer.cfg', text, expectedVersion }, actor))
	};
}
it('atomically saves source and backups, fences stale owners, and deduplicates acknowledgement retries', async () => {
	const a = await app();
	const original = await a.read();
	const text = original.text.replace('max_velocity: 200', 'max_velocity: 180');
	const id = randomUUID();
	const saved = await a.save(text, original.version, id);
	const duplicate = await a.save(text, original.version, id);
	expect(duplicate).toEqual(saved);
	const current = await a.read();
	expect(current.text).toBe(text);
	expect(current.backups).toHaveLength(1);
	expect(
		await a.runtime.runPromise(a.service.backup('printer.cfg', current.backups[0]!.id, owner))
	).toBe(original.text);
	await expect(a.save(text + '# stale\n', original.version)).rejects.toThrow('changed');
	await expect(a.save(text, original.version, id, { ...owner, id: 'other' })).rejects.toThrow(
		'another request'
	);
	const restored = await a.save(original.text, current.version);
	expect(restored.version).not.toBe(original.version);
	expect((await a.read()).backups).toHaveLength(2);
});
it('rollback leaves no orphan backup or receipt, then the same request can be saved once', async () => {
	const a = await app();
	const original = await a.read();
	const text = original.text.replace('max_accel: 2500', 'max_accel: 2000');
	const id = randomUUID();
	await a.runtime.runPromise(
		Effect.flatMap(
			SqlClient,
			(sql) =>
				sql`CREATE TRIGGER fixture_failure BEFORE UPDATE ON config_files BEGIN SELECT RAISE(ABORT,'fixture failure'); END`
		)
	);
	await expect(a.save(text, original.version, id)).rejects.toThrow('storage');
	expect((await a.read()).backups).toHaveLength(0);
	expect((await a.read()).version).toBe(original.version);
	await a.runtime.runPromise(Effect.flatMap(SqlClient, (sql) => sql`DROP TRIGGER fixture_failure`));
	await a.save(text, original.version, id);
	expect((await a.read()).backups).toHaveLength(1);
});
it('rejects revoked ownership, modified generated blocks, and out-of-root paths', async () => {
	const a = await app();
	const original = await a.read();
	await expect(a.read('printer.cfg', { ...owner, authorized: () => false })).rejects.toThrow(
		'owner'
	);
	await expect(
		a.save(original.text.replace('z_offset = 1.200', 'z_offset = 0'), original.version)
	).rejects.toThrow('unchanged');
	await expect(a.read('../printer.cfg')).rejects.toThrow('folder');
	let checks = 0;
	await expect(
		a.save(
			original.text.replace('max_velocity: 200', 'max_velocity: 180'),
			original.version,
			randomUUID(),
			{ ...owner, authorized: () => ++checks < 3 }
		)
	).rejects.toThrow('owner');
	expect((await a.read()).version).toBe(original.version);
	expect((await a.read()).backups).toHaveLength(0);
});
it('bounds pending saves and retains the latest twenty backups', async () => {
	const a = await app('', 1000, true);
	let original = await a.read();
	const requests = Array.from({ length: 15 }, (_, i) =>
		a.save(original.text.replace('max_velocity: 200', `max_velocity: ${100 + i}`), original.version)
	);
	const outcomes = await Promise.allSettled(requests);
	expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
	expect(
		outcomes.some((r) => r.status === 'rejected' && String(r.reason).includes('queue is full'))
	).toBe(true);
	for (let i = 0; i < 22; i++) {
		original = await a.read();
		await a.save(
			original.text.replace(/max_velocity: \d+/, `max_velocity: ${300 + i}`),
			original.version
		);
	}
	expect((await a.read()).backups).toHaveLength(20);
});
async function upstream() {
	let mode = 'normal';
	let onRead: () => void = () => {};
	const requests: Array<{ url: string; key: string | undefined; method: string | undefined }> = [];
	const content = '[printer]\nmax_velocity: 200\n# fixture-private-value\n';
	const server = createServer((request, response: ServerResponse) => {
		requests.push({
			url: request.url!,
			key: request.headers['x-api-key'] as string | undefined,
			method: request.method
		});
		if (request.url === '/server/files/list?root=config') {
			if (mode === 'bad-json') {
				response.end('fixture-private-invalid-json');
				return;
			}
			response.setHeader('Content-Type', 'application/json');
			response.end(
				JSON.stringify({
					result: [
						{ path: 'printer.cfg', size: content.length, modified: 1, permissions: 'rw' },
						{ path: '../outside.cfg', size: 1, modified: 1, permissions: 'rw' },
						{ path: 'hidden.cfg', size: 1, permissions: '' },
						null
					]
				})
			);
			return;
		}
		if (request.url === '/server/files/config/printer.cfg') {
			if (mode === 'redirect') {
				response.writeHead(302, { Location: '/trap' });
				response.end();
				return;
			}
			if (mode === 'oversized') {
				response.end('x'.repeat(256 * 1024 + 1));
				return;
			}
			if (mode === 'hang') return;
			if (mode === 'revoked') {
				response.write(content.slice(0, 10));
				onRead();
				response.end(content.slice(10));
				return;
			}
			response.end(content);
			return;
		}
		response.statusCode = 404;
		response.end();
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as { port: number }).port;
	cleanup.push(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return {
		url: `ws://127.0.0.1:${port}/websocket`,
		requests,
		content,
		setMode: (value: string) => (mode = value),
		setRead: (callback: () => void) => (onRead = callback)
	};
}
it('live reads use a bounded fixed root and private headers, never write and suppress revoked results', async () => {
	const fixture = await upstream();
	const a = await app(fixture.url);
	expect(await a.runtime.runPromise(a.service.list(owner))).toEqual([
		{ path: 'printer.cfg', updatedAt: 1000, version: '' }
	]);
	expect(await a.read()).toMatchObject({ text: fixture.content, source: 'moonraker', backups: [] });
	await expect(a.save('new', 'revision')).rejects.toThrow('not enabled');
	await expect(a.read('../outside.cfg')).rejects.toThrow('folder');
	expect(fixture.requests.every((r) => r.method === 'GET' && r.key === 'fixture-key')).toBe(true);
	expect(fixture.requests.some((r) => r.url.includes('outside'))).toBe(false);
	let allowed = true;
	fixture.setMode('revoked');
	fixture.setRead(() => (allowed = false));
	await expect(a.read('printer.cfg', { ...owner, authorized: () => allowed })).rejects.toThrow(
		'owner'
	);
});
it('live redirects, oversized bodies, malformed listings, and timeouts fail safely', async () => {
	const fixture = await upstream();
	const a = await app(fixture.url, 100);
	fixture.setMode('redirect');
	await expect(a.read()).rejects.toThrow('could not be reached');
	expect(fixture.requests.some((r) => r.url === '/trap')).toBe(false);
	fixture.setMode('oversized');
	await expect(a.read()).rejects.toThrow('size');
	fixture.setMode('bad-json');
	await expect(a.read()).rejects.toThrow('could not be decoded');
	fixture.setMode('hang');
	await expect(a.read()).rejects.toThrow('could not be reached');
});
