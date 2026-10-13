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
			'printer.objects.list': { objects: ['heater_bed', 'print_stats', 'virtual_sdcard'] },
			'printer.objects.subscribe': {
				eventtime: 1,
				status: {
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
		PERILUNE_CAMERA_BASE_URL: '',
		PERILUNE_CAMERA_SOURCE: ''
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
	await second.getByText('fixture.gcode', { exact: true }).waitFor();
	await first.getByText('20%', { exact: true }).waitFor();
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
	klippy = 'shutdown';
	notify('notify_klippy_shutdown');
	await first.getByText('Klipper shutdown', { exact: true }).waitFor();
	assert.ok((await first.locator('.heater').last().innerText()).includes('39'));
	for (const socket of protocol.clients) socket.terminate();
	await first.getByText('Reconnecting to Moonraker', { exact: true }).waitFor();
	assert.equal(await first.getByRole('spinbutton', { name: 'Bed target' }).inputValue(), '85');
	temperature = 41;
	klippy = 'ready';
	await first.waitForFunction(() =>
		document.querySelector('.heater:last-child')?.textContent?.includes('41')
	);
	assert.equal(connections, 2, 'One new socket after reconnect');
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
