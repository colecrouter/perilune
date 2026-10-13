import { createServer, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { Effect, Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import { WebSocketServer, type WebSocket } from 'ws';
import {
	MoonrakerConfig,
	MoonrakerService,
	MoonrakerServiceLive,
	emptyMoonrakerSnapshot,
	normalizeMoonrakerStatus
} from './moonraker.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function simulator(
	options: {
		objects?: string[];
		klippy?: string;
		ignoreInfoAfter?: number;
		failIdentify?: boolean;
		delaySubscribeMs?: number;
		shutdownDuringSubscribe?: boolean;
		deltaDuringSubscribe?: boolean;
	} = {}
) {
	const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
	await new Promise<void>((resolve) => server.once('listening', resolve));
	cleanups.push(
		() =>
			new Promise<void>((resolve) => {
				for (const client of server.clients) client.terminate();
				server.close(() => resolve());
			})
	);
	const address = server.address();
	if (typeof address === 'string' || !address) throw new Error('Missing simulator address');
	const methods: string[] = [];
	const clients: WebSocket[] = [];
	let klippy = options.klippy ?? 'ready';
	let infoCount = 0;
	const initial = {
		print_stats: {
			filename: 'fixture.gcode',
			state: 'printing',
			print_duration: 600,
			info: { current_layer: 5, total_layer: 100 }
		},
		virtual_sdcard: { progress: 0.25 },
		extruder: { temperature: 205, target: 210 },
		heater_bed: { temperature: 60, target: 60 }
	};
	server.on('connection', (socket) => {
		clients.push(socket);
		socket.on('message', (data) => {
			const message = JSON.parse(
				Buffer.isBuffer(data) ? data.toString() : Buffer.from(data as ArrayBuffer).toString()
			) as {
				id: number;
				method: string;
				params?: { objects?: Record<string, string[]>; url?: string };
			};
			methods.push(message.method);
			let result: unknown;
			switch (message.method) {
				case 'server.connection.identify':
					expect(message.params?.url).toBe('https://github.com/colecrouter/perilune');
					if (options.failIdentify) {
						socket.send(
							JSON.stringify({
								jsonrpc: '2.0',
								id: message.id,
								error: { code: -32602, message: 'Private authentication detail' }
							})
						);
						return;
					}
					result = { connection_id: 1 };
					break;
				case 'server.info':
					if (++infoCount > (options.ignoreInfoAfter ?? Infinity)) return;
					result = { klippy_state: klippy };
					break;
				case 'printer.objects.list':
					result = { objects: options.objects ?? Object.keys(initial) };
					break;
				case 'printer.objects.subscribe':
					if (options.shutdownDuringSubscribe) {
						klippy = 'shutdown';
						socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'notify_klippy_shutdown' }));
					}
					if (options.deltaDuringSubscribe)
						socket.send(
							JSON.stringify({
								jsonrpc: '2.0',
								method: 'notify_status_update',
								params: [{ extruder: { temperature: 208 } }, 101]
							})
						);
					result = {
						eventtime: 100,
						status: Object.fromEntries(
							Object.entries(initial).filter(([name]) => name in (message.params?.objects ?? {}))
						)
					};
					break;
				default:
					throw new Error(`Read-only allowlist violation: ${message.method}`);
			}
			const send = () => {
				if (socket.readyState === 1)
					socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
			};
			if (message.method === 'printer.objects.subscribe' && options.delaySubscribeMs)
				setTimeout(send, options.delaySubscribeMs);
			else send();
		});
	});
	const runtime = ManagedRuntime.make(
		MoonrakerServiceLive.pipe(
			Layer.provide(
				Layer.succeed(MoonrakerConfig, {
					url: `ws://127.0.0.1:${address.port}`,
					requestTimeoutMs: 100,
					heartbeatMs: 50,
					reconnectMinMs: 20,
					reconnectMaxMs: 50
				})
			)
		)
	);
	cleanups.push(() => runtime.dispose());
	const service = await runtime.runPromise(MoonrakerService);
	return {
		methods,
		clients,
		runtime,
		snapshot: () => runtime.runPromise(SubscriptionRef.get(service.state)),
		notify: (method: string, params: unknown[] = []) => {
			for (const client of server.clients)
				client.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
		},
		setKlippy: (next: string) => {
			klippy = next;
		}
	};
}

describe('Moonraker read-only protocol', () => {
	it('discovers objects, subscribes and preserves fields in partial status deltas', async () => {
		const printer = await simulator();
		await expect.poll(async () => (await printer.snapshot()).job.filename).toBe('fixture.gcode');
		printer.notify('notify_status_update', [
			{
				extruder: { temperature: 207 },
				print_stats: { info: { current_layer: 6 } }
			},
			101
		]);
		await expect.poll(async () => (await printer.snapshot()).heaters.nozzle.current).toBe(207);
		const snapshot = await printer.snapshot();
		expect(snapshot.heaters.nozzle.target).toBe(210);
		expect(snapshot.job.progress).toBe(25);
		expect(snapshot.job.remainingMinutes).toBe(30);
		expect(snapshot.job.layer).toBe(6);
		expect(snapshot.job.totalLayers).toBe(100);
		expect(printer.methods.slice(0, 4)).toEqual([
			'server.connection.identify',
			'server.info',
			'printer.objects.list',
			'printer.objects.subscribe'
		]);
	});
	it('handles printers without a bed or layer metadata without invented readings', async () => {
		const printer = await simulator({ objects: ['extruder', 'virtual_sdcard'] });
		await expect.poll(async () => (await printer.snapshot()).heaters.nozzle.current).toBe(205);
		const snapshot = await printer.snapshot();
		expect(snapshot.heaters.bed).toEqual({ current: null, target: null });
		expect(snapshot.job.layer).toBeNull();
		expect(snapshot.job.remainingMinutes).toBeNull();
	});
	it('keeps Moonraker connected while Klippy starts and resubscribes after readiness', async () => {
		const printer = await simulator({ klippy: 'startup' });
		await expect.poll(async () => (await printer.snapshot()).klippy).toBe('startup');
		expect(printer.methods).not.toContain('printer.objects.subscribe');
		printer.setKlippy('ready');
		printer.notify('notify_klippy_ready');
		await expect.poll(async () => (await printer.snapshot()).job.filename).toBe('fixture.gcode');
		printer.setKlippy('shutdown');
		printer.notify('notify_klippy_shutdown');
		await expect.poll(async () => (await printer.snapshot()).klippy).toBe('shutdown');
		expect((await printer.snapshot()).job.filename).toBe('fixture.gcode');
		printer.setKlippy('ready');
		printer.notify('notify_klippy_ready');
		await expect
			.poll(() => printer.methods.filter((method) => method === 'printer.objects.subscribe').length)
			.toBe(2);
	});
	it('retains last telemetry during disconnect and establishes a fresh subscription', async () => {
		const printer = await simulator();
		await expect.poll(async () => (await printer.snapshot()).job.filename).toBe('fixture.gcode');
		const generation = (await printer.snapshot()).generation;
		printer.clients[0]?.terminate();
		await expect
			.poll(async () => (await printer.snapshot()).generation)
			.toBeGreaterThan(generation);
		await expect
			.poll(() => printer.methods.filter((method) => method === 'printer.objects.subscribe').length)
			.toBe(2);
		expect((await printer.snapshot()).job.filename).toBe('fixture.gcode');
	});
	it('detects unresponsive sockets through RPC heartbeat deadlines', async () => {
		const printer = await simulator({ ignoreInfoAfter: 1 });
		await expect.poll(async () => (await printer.snapshot()).job.filename).toBe('fixture.gcode');
		await expect.poll(() => printer.clients.length).toBeGreaterThan(1);
		expect((await printer.snapshot()).job.filename).toBe('fixture.gcode');
	});
	it('does not leak authentication errors and closes its socket when runtime is disposed', async () => {
		const printer = await simulator({ failIdentify: true });
		await expect.poll(() => printer.clients.length).toBeGreaterThan(1);
		expect(JSON.stringify(await printer.snapshot())).not.toContain('Private');
		await printer.runtime.dispose();
		const count = printer.clients.length;
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(printer.clients.length).toBe(count);
		expect(printer.clients.every((client) => client.readyState === 3)).toBe(true);
	});
	it('does not publish stale bootstrap after shutdown during subscription', async () => {
		const printer = await simulator({ shutdownDuringSubscribe: true, delaySubscribeMs: 20 });
		await expect.poll(async () => (await printer.snapshot()).klippy).toBe('shutdown');
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect((await printer.snapshot()).job.filename).toBe('');
		expect((await printer.snapshot()).updatedAt).toBeNull();
	});
	it('retains newer deltas that arrive before the subscription response', async () => {
		const printer = await simulator({ deltaDuringSubscribe: true, delaySubscribeMs: 20 });
		await expect.poll(async () => (await printer.snapshot()).heaters.nozzle.current).toBe(208);
		expect((await printer.snapshot()).heaters.nozzle.target).toBe(210);
	});
	it('closes sockets and pending RPC deadlines when disposed during bootstrap', async () => {
		const printer = await simulator({ delaySubscribeMs: 200 });
		await expect.poll(() => printer.methods.includes('printer.objects.subscribe')).toBe(true);
		await printer.runtime.dispose();
		await expect.poll(() => printer.clients.every((client) => client.readyState === 3)).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(printer.clients).toHaveLength(1);
	});
	it('cancels an unopened websocket handshake without starting another session', async () => {
		const sockets: Socket[] = [];
		const server = createServer((socket) => sockets.push(socket));
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		cleanups.push(
			() =>
				new Promise<void>((resolve) => {
					for (const socket of sockets) socket.destroy();
					server.close(() => resolve());
				})
		);
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Missing address');
		const runtime = ManagedRuntime.make(
			MoonrakerServiceLive.pipe(
				Layer.provide(
					Layer.succeed(MoonrakerConfig, {
						url: `ws://127.0.0.1:${address.port}`,
						requestTimeoutMs: 1000
					})
				)
			)
		);
		cleanups.push(() => runtime.dispose());
		const service = await runtime.runPromise(MoonrakerService);
		await expect.poll(() => sockets.length).toBeGreaterThan(0);
		await runtime.dispose();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect((await Effect.runPromise(SubscriptionRef.get(service.state))).generation).toBe(1);
	});
	it('ignores non-finite readings and clamps progress', () => {
		const snapshot = normalizeMoonrakerStatus(
			{ extruder: { temperature: NaN, target: '210' }, virtual_sdcard: { progress: 1.5 } },
			emptyMoonrakerSnapshot()
		);
		expect(snapshot.heaters.nozzle).toEqual({ current: null, target: null });
		expect(snapshot.job.progress).toBe(100);
	});
});
