import { afterEach, expect, it } from 'vite-plus/test';
import { Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import { WebSocketServer } from 'ws';
import {
	MoonrakerConfig,
	MoonrakerService,
	MoonrakerServiceLive,
	meshScript
} from './moonraker.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture() {
	const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
	await new Promise<void>((r) => server.once('listening', r));
	cleanup.push(
		() =>
			new Promise<void>((r) => {
				for (const c of server.clients) c.terminate();
				server.close(() => r());
			})
	);
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('No port');
	const status = {
		print_stats: { state: 'complete' },
		idle_timeout: { state: 'Idle' },
		toolhead: {
			position: [0, 0, 20],
			axis_minimum: [0, 0, 0],
			axis_maximum: [250, 250, 250],
			homed_axes: 'xyz'
		},
		heater_bed: { temperature: 23, target: 0 },
		extruder: { temperature: 23, target: 0 },
		configfile: {
			config: {
				bed_mesh: { mesh_min: '20,20', mesh_max: '200,200', probe_count: '5' },
				probe: { samples: '1' },
				'gcode_macro PRIVATE': { gcode: 'PRIVATE-CONFIG-MUST-NOT-LEAK' }
			},
			save_config_pending: false
		}
	};
	let behavior: 'normal' | 'slow' | 'drop' = 'normal',
		query: 'normal' | 'newer' | 'restart' = 'normal';
	let scripts = 0;
	server.on('connection', (socket) =>
		socket.on('message', (bytes) => {
			const req = JSON.parse(
				Buffer.isBuffer(bytes)
					? bytes.toString()
					: bytes instanceof ArrayBuffer
						? Buffer.from(bytes).toString()
						: Buffer.concat(bytes).toString()
			);
			const reply = (result: unknown) =>
				socket.send(JSON.stringify({ id: req.id, jsonrpc: '2.0', result }));
			const notify = (method: string, params: unknown[]) =>
				socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
			switch (req.method) {
				case 'server.connection.identify':
					reply({});
					break;
				case 'server.info':
					reply({ klippy_state: 'ready' });
					break;
				case 'printer.objects.list':
					reply({ objects: Object.keys(status) });
					break;
				case 'printer.objects.subscribe':
					reply({ status, eventtime: 1 });
					break;
				case 'printer.objects.query':
					if (query === 'newer') {
						notify('notify_status_update', [{ heater_bed: { temperature: 24 } }, 2]);
						setTimeout(() => reply({ status, eventtime: 1 }), 5);
					} else if (query === 'restart') {
						notify('notify_klippy_shutdown', []);
						setTimeout(() => reply({ status, eventtime: 1 }), 5);
					} else reply({ status, eventtime: 1 });
					break;
				case 'printer.gcode.script':
					scripts++;
					if (behavior === 'drop') {
						socket.terminate();
						break;
					}
					if (behavior === 'slow') {
						notify('notify_status_update', [{ heater_bed: { temperature: 25 } }, 3]);
						notify('notify_gcode_response', [
							'// probe: at 20.000,20.000 bed will contact at z=-0.025000'
						]);
						notify('notify_gcode_response', ['// probe at 40.000,35.000 is z=-0.025000']);
						setTimeout(() => reply('ok'), 100);
					} else reply('ok');
					break;
			}
		})
	);
	const runtime = ManagedRuntime.make(
		MoonrakerServiceLive.pipe(
			Layer.provide(
				Layer.succeed(MoonrakerConfig, {
					url: `ws://127.0.0.1:${address.port}/websocket`,
					liveMeshEnabled: true,
					requestTimeoutMs: 30,
					heartbeatMs: 1000,
					reconnectMinMs: 5
				})
			)
		)
	);
	cleanup.push(() => runtime.dispose());
	const transport = await runtime.runPromise(MoonrakerService);
	const snapshot = () => runtime.runPromise(SubscriptionRef.get(transport.state));
	await expect.poll(async () => (await snapshot()).telemetryReady).toBe(true);
	return {
		runtime,
		transport,
		snapshot,
		setBehavior: (v: typeof behavior) => {
			behavior = v;
		},
		setQuery: (v: typeof query) => {
			query = v;
		},
		scripts: () => scripts
	};
}
it('waits beyond the normal RPC timeout while telemetry continues and projects configuration', async () => {
	const f = await fixture(),
		initial = await f.snapshot();
	expect(initial.liveMesh.plan?.columns).toBe(5);
	expect(JSON.stringify(initial)).not.toContain('PRIVATE-CONFIG');
	f.setBehavior('slow');
	const command = f.runtime.runPromise(
		f.transport.command({ type: 'probe', name: 'perilune_run' }, initial.generation)
	);
	await expect.poll(async () => (await f.snapshot()).heaters.bed.current).toBe(25);
	await command;
	expect((await f.snapshot()).probeResponses.map((p) => p.space)).toEqual(['probe', 'nozzle']);
	expect(f.scripts()).toBe(1);
});
it('preserves newer telemetry when an older refresh response arrives', async () => {
	const f = await fixture();
	f.setQuery('newer');
	const result = await f.runtime.runPromise(f.transport.refresh((await f.snapshot()).generation));
	expect(result.heaters.bed.current).toBe(24);
});
it('fences late refresh replies across firmware state changes', async () => {
	const f = await fixture();
	f.setQuery('restart');
	await expect(
		f.runtime.runPromise(f.transport.refresh((await f.snapshot()).generation))
	).rejects.toMatchObject({ sent: false });
});
it('reports post-send disconnect as uncertain without replaying', async () => {
	const f = await fixture(),
		generation = (await f.snapshot()).generation;
	f.setBehavior('drop');
	await expect(
		f.runtime.runPromise(f.transport.command({ type: 'probe', name: 'perilune_run' }, generation))
	).rejects.toMatchObject({ sent: true });
	await expect.poll(async () => (await f.snapshot()).generation).toBeGreaterThan(generation);
	expect(f.scripts()).toBe(1);
	await expect(
		f.runtime.runPromise(f.transport.command({ type: 'home' }, generation))
	).rejects.toMatchObject({ sent: false });
	expect(f.scripts()).toBe(1);
});
it('only builds bounded profile operations and rejects command injection', () => {
	expect(meshScript({ type: 'save', name: 'new-mesh', remove: 'perilune_run' })).toBe(
		'BED_MESH_PROFILE SAVE=new-mesh\nBED_MESH_PROFILE REMOVE=perilune_run\nSAVE_CONFIG'
	);
	expect(() => meshScript({ type: 'probe', name: 'mesh\nG28' })).toThrow(/identifier/);
});
