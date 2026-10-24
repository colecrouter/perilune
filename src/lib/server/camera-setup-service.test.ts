import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { Effect, Layer, ManagedRuntime } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { CameraService, CameraServiceLive, CameraConfig } from './camera.js';
import {
	CameraSetupService,
	CameraSetupServiceLive,
	CameraSetupSettings
} from './camera-setup-service.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(filename = ':memory:', discoveryDelay = 0, mediaUnavailable = false) {
	const streams = new Map<string, string>();
	const server = createServer((request, response) => {
		const url = new URL(request.url!, 'http://fixture.invalid');
		const src = url.searchParams.get('src')!;
		if (url.pathname === '/api/v4l2') {
			setTimeout(() => {
				response.end(
					JSON.stringify({
						sources: [
							{
								url: 'v4l2:device?video=/dev/video0&input_format=mjpeg&video_size=640x480&framerate=30'
							}
						]
					})
				);
			}, discoveryDelay);
			return;
		}
		if (url.pathname === '/snapshot.jpg') {
			response.writeHead(200, { 'Content-Type': 'image/jpeg' });
			response.end(new Uint8Array([255, 216, 255]));
			return;
		}
		if (request.method === 'PATCH') {
			streams.set(url.searchParams.get('name')!, src);
			response.end();
			return;
		}
		if (request.method === 'DELETE') {
			streams.delete(src);
			response.end();
			return;
		}
		if (url.pathname === '/api/streams') {
			response.writeHead(streams.has(src) ? 200 : 404);
			response.end('{}');
			return;
		}
		if (mediaUnavailable || !streams.has(src) || !src.endsWith('_compatible')) {
			response.writeHead(502);
			response.end();
			return;
		}
		response.writeHead(200, { 'Content-Type': 'video/mp4; codecs="avc1.64001f"' });
		response.write(
			readFileSync(new URL('../../../scripts/fixtures/camera/init.mp4', import.meta.url))
		);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw Error();
	cleanup.push(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	const cameraLayer = CameraServiceLive.pipe(
		Layer.provide(Layer.succeed(CameraConfig, { baseUrl: '' }))
	);
	const makeRuntime = () =>
		ManagedRuntime.make(
			CameraSetupServiceLive.pipe(
				Layer.provide(
					Layer.succeed(CameraSetupSettings, {
						baseUrl: `http://127.0.0.1:${address.port}/`,
						retryMs: 20
					})
				),
				Layer.provide(SqliteClient.layer({ filename })),
				Layer.provideMerge(cameraLayer)
			)
		);
	const runtime = makeRuntime();
	cleanup.push(() => runtime.dispose());
	const service = await runtime.runPromise(CameraSetupService);
	const camera = await runtime.runPromise(CameraService);
	return {
		runtime,
		service,
		camera,
		streams,
		makeRuntime,
		base: `http://127.0.0.1:${address.port}/`
	};
}
const input = {
	kind: 'network',
	name: 'Fixture camera',
	streamUrl: 'rtsp://camera.example.invalid/private',
	rotation: 0,
	flipHorizontal: false,
	flipVertical: false
};
it('keeps tests separate from the active camera and commits only a tested token', async () => {
	const f = await fixture();
	const tested = await f.runtime.runPromise(f.service.test('owner', input));
	expect(await f.runtime.runPromise(f.camera.getDescriptor)).toMatchObject({ configured: false });
	await expect(
		f.runtime.runPromise(f.service.save('other', tested.token, () => true))
	).rejects.toThrow();
	const saved = await f.runtime.runPromise(f.service.save('owner', tested.token, () => true));
	expect(saved).toMatchObject({ name: 'Fixture camera', status: 'ready', revision: 1 });
	const descriptor = await f.runtime.runPromise(f.camera.getDescriptor);
	expect(descriptor).toMatchObject({ configured: true, mseUrl: '/api/camera/stream.mp4' });
	expect(descriptor.qualities).toHaveLength(1);
	expect(JSON.stringify(descriptor)).not.toMatch(/camera.example.invalid|private|127.0.0.1/);
	await expect(
		f.runtime.runPromise(f.service.save('owner', tested.token, () => true))
	).rejects.toThrow();
});
it('rejects stale concurrent tests and rechecks owner authorization inside the save gate', async () => {
	const f = await fixture();
	const first = await f.runtime.runPromise(f.service.test('owner', input));
	const second = await f.runtime.runPromise(
		f.service.test('owner', { ...input, name: 'Other draft' })
	);
	await expect(
		f.runtime.runPromise(f.service.save('owner', first.token, () => false))
	).rejects.toThrow();
	await f.runtime.runPromise(f.service.save('owner', first.token, () => true));
	await expect(
		f.runtime.runPromise(f.service.save('owner', second.token, () => true))
	).rejects.toThrow();
	expect((await f.runtime.runPromise(f.service.status)).name).toBe('Fixture camera');
});
it('bounds pending draft tests', async () => {
	const f = await fixture();
	for (let i = 0; i < 4; i++) await f.runtime.runPromise(f.service.test('owner', input));
	await expect(f.runtime.runPromise(f.service.test('owner', input))).rejects.toThrow(
		'Another camera test is pending'
	);
});
it('rejects cancelled tests without allowing a save', async () => {
	const f = await fixture();
	const controller = new AbortController();
	controller.abort();
	await expect(
		f.runtime.runPromise(f.service.test('owner', input, controller.signal))
	).rejects.toThrow();
	expect((await f.runtime.runPromise(f.service.status)).name).toBeNull();
});

it('restores persisted selection and profiles after both services restart', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'perilune-camera-settings-'));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const f = await fixture(join(directory, 'state.sqlite'));
	const tested = await f.runtime.runPromise(f.service.test('owner', input));
	await f.runtime.runPromise(f.service.save('owner', tested.token, () => true));
	await f.runtime.dispose();
	f.streams.clear();
	const restarted = f.makeRuntime();
	cleanup.push(() => restarted.dispose());
	const setup = await restarted.runPromise(CameraSetupService);
	await expect.poll(async () => (await restarted.runPromise(setup.status)).status).toBe('ready');
	expect((await restarted.runPromise(setup.status)).name).toBe('Fixture camera');
	expect(f.streams.size).toBe(4);
});
it('disconnects with a revision check and invalidates older draft saves', async () => {
	const f = await fixture();
	const first = await f.runtime.runPromise(f.service.test('owner', input));
	await f.runtime.runPromise(f.service.save('owner', first.token, () => true));
	const draft = await f.runtime.runPromise(f.service.test('owner', input));
	await expect(f.runtime.runPromise(f.service.reset(0, () => true))).rejects.toThrow();
	expect((await f.runtime.runPromise(f.service.reset(1, () => true))).name).toBeNull();
	expect((await f.runtime.runPromise(f.camera.getDescriptor)).configured).toBe(false);
	await expect(
		f.runtime.runPromise(f.service.save('owner', draft.token, () => true))
	).rejects.toThrow();
});

it('scopes preview tokens to the testing session and invalidates them after save or expiry', async () => {
	const f = await fixture();
	const proxy = vi
		.spyOn(f.camera, 'proxyPreview')
		.mockImplementation(() =>
			Effect.succeed(
				new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } })
			)
		);
	const test = await f.runtime.runPromise(f.service.test('owner-session', input));
	const request = new Request('http://app.example.invalid/api/camera/snapshot');
	await expect(
		f.runtime.runPromise(f.service.preview('other-session', test.token, request))
	).rejects.toThrow();
	expect(proxy).not.toHaveBeenCalled();
	expect(
		(await f.runtime.runPromise(f.service.preview('owner-session', test.token, request))).status
	).toBe(200);
	await f.runtime.runPromise(f.service.save('owner-session', test.token, () => true));
	await expect(
		f.runtime.runPromise(f.service.preview('owner-session', test.token, request))
	).rejects.toThrow();
	const expired = await f.runtime.runPromise(f.service.test('owner-session', input));
	const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 301_000);
	try {
		await expect(
			f.runtime.runPromise(f.service.preview('owner-session', expired.token, request))
		).rejects.toThrow();
	} finally {
		clock.mockRestore();
		proxy.mockRestore();
	}
});
it('reconciles a companion restart while the application stays running', async () => {
	const f = await fixture();
	const draft = await f.runtime.runPromise(f.service.test('owner', input));
	await f.runtime.runPromise(f.service.save('owner', draft.token, () => true));
	const generation = (await f.runtime.runPromise(f.camera.getDescriptor)).generation;
	f.streams.clear();
	await expect.poll(() => f.streams.size).toBe(4);
	expect((await f.runtime.runPromise(f.camera.getDescriptor)).generation).toBeGreaterThan(
		generation
	);
});

it('keeps JPEG-only cameras as still images without registering video encoders', async () => {
	const f = await fixture();
	const tested = await f.runtime.runPromise(
		f.service.test('owner', { ...input, kind: 'snapshot', streamUrl: f.base + 'snapshot.jpg' })
	);
	expect(tested.codec).toBe('JPEG');
	expect(f.streams.size).toBe(0);
	await f.runtime.runPromise(f.service.save('owner', tested.token, () => true));
	const descriptor = await f.runtime.runPromise(f.camera.getDescriptor);
	expect(descriptor).toMatchObject({
		configured: true,
		snapshotOnly: true,
		streamUrl: null,
		mseUrl: null,
		snapshotUrl: '/api/camera/snapshot'
	});
	expect(descriptor.qualities).toBeUndefined();
});

it('tests and persists an enumerated USB profile through the normal lifecycle', async () => {
	const f = await fixture();
	const service = await f.runtime.runPromise(CameraSetupService);
	const [device] = await f.runtime.runPromise(service.devices());
	expect(device.input.kind).toBe('local');
	const tested = await f.runtime.runPromise(service.test('owner', device.input));
	await f.runtime.runPromise(service.save('owner', tested.token, () => true));
	expect((await f.runtime.runPromise(service.status)).name).toBe(device.input.name);
});

it('bounds discovery and releases its slot after cancellation', async () => {
	const f = await fixture(':memory:', 100);
	const controller = new AbortController();
	const first = f.runtime.runPromise(f.service.devices(controller.signal));
	await expect(f.runtime.runPromise(f.service.devices())).rejects.toThrow('already running');
	controller.abort();
	await expect(first).rejects.toThrow();
	expect(await f.runtime.runPromise(f.service.devices())).toHaveLength(1);
});

it('explains local capture failure without leaking private engine errors and cleans its profiles', async () => {
	const f = await fixture(':memory:', 0, true);
	const [device] = await f.runtime.runPromise(f.service.devices());
	await expect(f.runtime.runPromise(f.service.test('owner', device.input))).rejects.toThrow(
		'Close other camera capture applications'
	);
	expect(f.streams.size).toBe(0);
});
