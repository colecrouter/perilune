import { authenticate } from './smoke-auth-helper.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';

// Local protocol fixture only. This script never connects to a physical printer.
const directory = await mkdtemp(join(tmpdir(), 'perilune-live-smoke-'));
const protocol = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await new Promise((resolve) => protocol.once('listening', resolve));
const address = protocol.address();
const port = process.env.PERILUNE_LIVE_TEST_PORT ?? '4182';
const base = `http://127.0.0.1:${port}`;
const methods = [];
let klippy = 'startup';
let temperature = 37;
let connections = 0;
protocol.on('connection', (socket) => {
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
		const allowed = [
			'server.connection.identify',
			'server.info',
			'printer.objects.list',
			'printer.objects.subscribe'
		];
		assert.ok(allowed.includes(request.method), 'Only read-only RPCs allowed');
		if (request.method === 'server.connection.identify') {
			assert.equal(request.params.url, 'https://github.com/colecrouter/perilune');
			assert.equal(request.params.api_key, 'fixture-private-key');
		}
		const results = {
			'server.connection.identify': { connection_id: connections },
			'server.info': { klippy_state: klippy },
			'printer.objects.list': {
				objects: ['heater_bed', 'print_stats', 'virtual_sdcard', 'bed_mesh']
			},
			'printer.objects.subscribe': {
				eventtime: 1,
				status: {
					bed_mesh: {
						profile_name: 'fixture',
						mesh_min: [10, 20],
						mesh_max: [110, 220],
						probed_matrix: [
							[-0.1, 0.2],
							[0.3, 0.4]
						],
						profiles: {
							cold: {
								points: [
									[-0.2, 0.1],
									[0.2, 0.3]
								],
								mesh_params: { min_x: 10, min_y: 20, max_x: 110, max_y: 220 }
							}
						}
					},
					heater_bed: { temperature, target: 0 },
					print_stats: {
						filename: 'fixture.gcode',
						state: 'printing',
						print_duration: 60,
						info: { current_layer: 2, total_layer: 10 }
					},
					virtual_sdcard: { progress: 0.2 }
				}
			}
		};
		socket.send(
			JSON.stringify({ jsonrpc: '2.0', id: request.id, result: results[request.method] })
		);
	});
});
const notify = (method, params = []) => {
	for (const socket of protocol.clients)
		socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
};
const app = spawn(process.execPath, ['scripts/server.mjs'], {
	env: {
		...process.env,
		HOST: '127.0.0.1',
		PORT: port,
		PERILUNE_ORIGIN: base,
		PERILUNE_DATABASE: join(directory, 'state.sqlite'),
		PERILUNE_MOONRAKER_URL: `ws://127.0.0.1:${address.port}/websocket`,
		PERILUNE_MOONRAKER_API_KEY: 'fixture-private-key',
		PERILUNE_CAMERA_COMPANION_URL: ''
	},
	stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '';
app.stdout.on('data', (chunk) => {
	logs += chunk;
});
app.stderr.on('data', (chunk) => {
	logs += chunk;
});
let browser;
try {
	for (let attempt = 0; ; attempt++) {
		try {
			if ((await fetch(`${base}/health`)).ok) break;
		} catch {
			/* startup */
		}
		if (app.exitCode !== null || attempt > 100) throw new Error(`App startup failed: ${logs}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 1505, height: 1045 },
		colorScheme: 'light'
	});
	await authenticate(context, base, join(directory, 'state.sqlite'));
	const first = await context.newPage();
	const second = await context.newPage();
	const errors = [];
	for (const page of [first, second]) {
		page.setDefaultTimeout(10_000);
		page.on('pageerror', (error) => errors.push(error.message));
	}
	await first.goto(base);
	await first.getByText('Klipper startup', { exact: true }).waitFor();
	await first.getByText('Waiting for printer status', { exact: true }).waitFor();
	await first.getByRole('spinbutton', { name: 'Bed target' }).fill('85');
	await second.goto(base);
	assert.equal(connections, 1, 'Browsers share one printer connection');
	klippy = 'ready';
	notify('notify_klippy_ready');
	await second
		.getByRole('region', { name: 'Print status', exact: true })
		.getByText('fixture.gcode', { exact: true })
		.waitFor();
	await first
		.getByRole('region', { name: 'Print status', exact: true })
		.getByText('20%', { exact: true })
		.waitFor();
	assert.equal(await first.getByRole('spinbutton', { name: 'Bed target' }).inputValue(), '85');
	assert.equal(
		await first.getByRole('button', { name: 'Pause print', exact: true }).isDisabled(),
		true
	);
	assert.equal(
		await first.getByRole('button', { name: 'Stop print', exact: true }).isDisabled(),
		true
	);
	for (const button of await first.getByRole('button', { name: 'Read-only', exact: true }).all())
		assert.equal(await button.isDisabled(), true);
	notify('notify_status_update', [
		{ heater_bed: { temperature: 39 }, print_stats: { info: { current_layer: 3 } } },
		2
	]);
	await first.getByText('3 / 10', { exact: true }).waitFor();
	await second.getByText('3 / 10', { exact: true }).waitFor();
	await mkdir('test-results', { recursive: true });
	await first.screenshot({ path: 'test-results/live-fixture-desktop.png', fullPage: true });
	await second.goto(base + '/calibration/mesh');
	await second.getByRole('heading', { name: 'Bed mesh', exact: true }).waitFor();
	await second.getByRole('button', { name: 'X 10.0, Y 20.0: -0.100 mm', exact: true }).waitFor();
	await second.getByRole('combobox', { name: 'Compare with' }).selectOption('profile:cold');
	await second.getByText('Difference range', { exact: true }).waitFor();
	await second.getByRole('spinbutton', { name: 'Row (Y)' }).fill('2');
	await second.getByRole('button', { name: 'Isometric', exact: true }).click();
	const surface = second.locator('.surface-chart');
	await surface.scrollIntoViewIfNeeded();
	await second.getByRole('slider', { name: 'Rotation', exact: true }).waitFor();
	const bounds = await surface.boundingBox();
	assert.ok(bounds);
	await second.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await second.mouse.down();
	await second.mouse.move(bounds.x + bounds.width / 2 + 40, bounds.y + bounds.height / 2 + 10, {
		steps: 6
	});
	await second.mouse.up();
	await second.waitForFunction(
		() => document.querySelector('.surface-controls input[type="range"]')?.value !== '-45'
	);
	assert.notEqual(
		await second.getByRole('slider', { name: 'Rotation', exact: true }).inputValue(),
		'-45',
		'LayerChart drag rotates the view'
	);
	await second.getByRole('button', { name: 'Reset view', exact: true }).click();
	await second.getByRole('button', { name: 'Top-down', exact: true }).click();
	await second.setViewportSize({ width: 320, height: 800 });
	assert.equal(
		await second.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Mesh mobile layout does not overflow'
	);
	await second.getByRole('button', { name: 'More navigation', exact: true }).click();
	await second.getByRole('menuitem', { name: /Bed mesh/ }).waitFor();
	await second.screenshot({ path: 'test-results/mesh-live-mobile.png', fullPage: true });
	await second.keyboard.press('Escape');
	klippy = 'shutdown';
	notify('notify_klippy_shutdown');
	await first.getByText('Klipper shutdown', { exact: true }).waitFor();
	assert.ok((await first.locator('.heater').last().innerText()).includes('39'));
	await second.getByText(/Retained mesh data is stale/).waitFor();
	assert.equal(
		await second.getByRole('combobox', { name: 'Compare with' }).inputValue(),
		'profile:cold'
	);
	// Prepare the next handshake before reconnect can race the browser's banner observation.
	temperature = 41;
	klippy = 'ready';
	for (const socket of protocol.clients) socket.terminate();
	await first.getByText('Reconnecting to Moonraker', { exact: true }).waitFor();
	assert.equal(await first.getByRole('spinbutton', { name: 'Bed target' }).inputValue(), '85');
	await first.waitForFunction(() =>
		Array.from(document.querySelectorAll('.heater')).at(-1)?.textContent?.includes('41')
	);
	assert.equal(connections, 2, 'One new socket after reconnect');
	await second.waitForFunction(() => !document.querySelector('.mesh-inspector .notice'));
	assert.equal(await second.getByRole('spinbutton', { name: 'Row (Y)' }).inputValue(), '2');
	notify('notify_status_update', [
		{ bed_mesh: { profile_name: '', mesh_min: [0, 0], mesh_max: [0, 0], probed_matrix: [[]] } },
		3
	]);
	await second
		.getByText(
			'No active mesh is reported. Inspecting a saved profile does not load it into the printer.'
		)
		.waitFor();
	assert.equal(connections, 2, 'Inspection adds no printer socket');
	await first.setViewportSize({ width: 390, height: 844 });
	await first.screenshot({ path: 'test-results/live-fixture-mobile.png', fullPage: true });
	assert.equal(
		await first.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Live mobile layout does not overflow'
	);
	assert.deepEqual(errors, [], 'No live browser errors');
	const text = await first.locator('body').innerText();
	assert.ok(
		!text.includes('fixture-private-key') && !text.includes(`127.0.0.1:${address.port}`),
		'Private settings are not rendered'
	);
	assert.ok(methods.includes('printer.objects.subscribe'));
	console.log(
		'Live protocol production smoke passed: startup, capabilities, shared socket, deltas, read-only controls, Klipper shutdown, reconnect, preserved drafts, mobile.'
	);
} finally {
	await browser?.close();
	app.kill('SIGTERM');
	await new Promise((resolve) => {
		if (app.exitCode !== null) resolve();
		else app.once('exit', resolve);
	});
	for (const client of protocol.clients) client.terminate();
	await new Promise((resolve) => protocol.close(resolve));
	await rm(directory, { recursive: true, force: true });
}
