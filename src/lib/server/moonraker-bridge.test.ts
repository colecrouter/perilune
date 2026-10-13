import { afterEach, expect, it } from 'vite-plus/test';
import { Layer, ManagedRuntime, Stream, SubscriptionRef } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { WebSocketServer } from 'ws';
import { ActionStoreLive } from './action-store.js';
import { makePrinterService, PrinterService } from './printer-service.js';
import { MoonrakerConfig, MoonrakerServiceLive } from './moonraker.js';
import { MoonrakerBridgeLive } from './moonraker-bridge.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
});

it('bridges live values to two subscribers using one process-owned socket', async () => {
	const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
	await new Promise<void>((resolve) => server.once('listening', resolve));
	cleanup.push(
		() =>
			new Promise<void>((resolve) => {
				for (const client of server.clients) client.terminate();
				server.close(() => resolve());
			})
	);
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Missing server port');
	let connections = 0;
	const methods: string[] = [];
	server.on('connection', (socket) => {
		connections++;
		socket.on('message', (data) => {
			const request = JSON.parse(
				Buffer.isBuffer(data)
					? data.toString()
					: data instanceof ArrayBuffer
						? Buffer.from(data).toString()
						: Buffer.concat(data).toString()
			);
			methods.push(request.method);
			const results: Record<string, unknown> = {
				'server.connection.identify': { connection_id: 1 },
				'server.info': { klippy_state: 'ready' },
				'printer.objects.list': { objects: ['heater_bed', 'print_stats'] },
				'printer.objects.subscribe': {
					eventtime: 1,
					status: {
						heater_bed: { temperature: 37, target: 0 },
						print_stats: { state: 'standby', filename: '' }
					}
				}
			};
			socket.send(
				JSON.stringify({ jsonrpc: '2.0', id: request.id, result: results[request.method] })
			);
		});
	});
	const services = Layer.merge(
		makePrinterService('moonraker').pipe(
			Layer.provide(ActionStoreLive),
			Layer.provide(SqliteClient.layer({ filename: ':memory:' }))
		),
		MoonrakerServiceLive.pipe(
			Layer.provide(
				Layer.succeed(MoonrakerConfig, {
					url: `ws://127.0.0.1:${address.port}/websocket`,
					heartbeatMs: 50
				})
			)
		)
	);
	const runtime = ManagedRuntime.make(MoonrakerBridgeLive.pipe(Layer.provideMerge(services)));
	cleanup.push(() => runtime.dispose());
	const printer = await runtime.runPromise(PrinterService);
	const readers = [1, 2].map(() =>
		Stream.toAsyncIterable(SubscriptionRef.changes(printer.state))[Symbol.asyncIterator]()
	);
	cleanup.push(async () => {
		for (const reader of readers) await reader.return?.();
	});
	const readLive = async (reader: (typeof readers)[number]) => {
		for (;;) {
			const item = await reader.next();
			if (item.done) throw new Error('Stream ended');
			if (item.value.telemetryAt !== null) return item.value;
		}
	};
	const values = await Promise.all(readers.map(readLive));
	expect(values.map((value) => value.heaters.bed.current)).toEqual([37, 37]);
	expect(values[0].heaters.nozzle.current).toBeNull();
	expect(connections).toBe(1);
	const delta = JSON.stringify({
		jsonrpc: '2.0',
		method: 'notify_status_update',
		params: [{ heater_bed: { temperature: 39 } }, 2]
	});
	for (const socket of server.clients) socket.send(delta);
	await expect
		.poll(
			async () => (await runtime.runPromise(SubscriptionRef.get(printer.state))).heaters.bed.current
		)
		.toBe(39);
	await readers[0].return?.();
	expect(connections).toBe(1);
	expect(
		methods.every((method) =>
			[
				'server.connection.identify',
				'server.info',
				'printer.objects.list',
				'printer.objects.subscribe'
			].includes(method)
		)
	).toBe(true);
});
