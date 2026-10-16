import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import { authenticate } from './smoke-auth-helper.mjs';
// Synthetic protocol fixture only: no physical printer endpoint is used.
const directory = await mkdtemp(join(tmpdir(), 'perilune-live-actions-'));
const filename = join(directory, 'state.sqlite');
const status = {
	toolhead: {
		position: [100, 100, 20],
		axis_minimum: [-5, -5, 0],
		axis_maximum: [220, 220, 250],
		homed_axes: 'xyz'
	},
	idle_timeout: { state: 'Idle' },
	print_stats: { state: 'complete', filename: 'fixture.gcode', print_duration: 0 },
	virtual_sdcard: { progress: 0 },
	extruder: { temperature: 25, target: 0 },
	heater_bed: { temperature: 25, target: 0 },
	configfile: {
		config: {
			extruder: { min_temp: '0', max_temp: '280' },
			heater_bed: { min_temp: '0', max_temp: '130' }
		},
		save_config_pending: false
	}
};
const upstream = createServer((req, res) => {
	res.setHeader('Content-Type', 'application/json');
	if (req.url.startsWith('/server/files/list'))
		res.end(JSON.stringify({ result: [{ path: 'fixture.gcode', size: 42, modified: 1 }] }));
	else if (req.url.startsWith('/server/files/metadata'))
		res.end(JSON.stringify({ result: { size: 42, modified: 1 } }));
	else {
		res.statusCode = 404;
		res.end('{}');
	}
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const protocol = new WebSocketServer({ server: upstream });
let connections = 0,
	drop = false;
const operations = [];
const publish = () => {
	for (const socket of protocol.clients)
		if (socket.readyState === 1)
			socket.send(
				JSON.stringify({
					jsonrpc: '2.0',
					method: 'notify_status_update',
					params: [status, Date.now()]
				})
			);
};
protocol.on('connection', (socket) => {
	connections++;
	socket.on('message', (bytes) => {
		const req = JSON.parse(bytes.toString());
		let result = {};
		switch (req.method) {
			case 'server.info':
				result = { klippy_state: 'ready' };
				break;
			case 'printer.objects.list':
				result = { objects: Object.keys(status) };
				break;
			case 'printer.objects.subscribe':
			case 'printer.objects.query':
				result = { status, eventtime: Date.now() };
				break;
			case 'printer.gcode.help':
				result = {};
				break;
			case 'printer.gcode.script': {
				operations.push({ method: req.method, ...req.params });
				if (drop) {
					socket.terminate();
					return;
				}
				const script = req.params.script;
				for (const m of script.matchAll(/HEATER=(heater_bed|extruder) TARGET=([\d.]+)/g))
					status[m[1]].target = Number(m[2]);
				if (script === 'M84') status.toolhead.homed_axes = '';
				if (script.startsWith('G28')) status.toolhead.homed_axes = 'xyz';
				if (script === 'TURN_OFF_HEATERS') {
					status.heater_bed.target = 0;
					status.extruder.target = 0;
				}
				publish();
				break;
			}
			case 'printer.print.start':
			case 'printer.print.pause':
			case 'printer.print.resume':
			case 'printer.print.cancel': {
				operations.push({ method: req.method, ...req.params });
				if (drop) {
					socket.terminate();
					return;
				}
				status.print_stats.state = req.method.endsWith('pause')
					? 'paused'
					: req.method.endsWith('cancel')
						? 'cancelled'
						: 'printing';
				if (req.method.endsWith('start')) status.print_stats.filename = req.params.filename;
				if (req.method.endsWith('cancel')) {
					status.extruder.target = 0;
					status.heater_bed.target = 0;
				}
				publish();
				break;
			}
		}
		socket.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }));
	});
});
const port = '4198',
	base = `http://127.0.0.1:${port}`;
const app = spawn(process.execPath, ['scripts/server.mjs'], {
	env: {
		...process.env,
		HOST: '127.0.0.1',
		PORT: port,
		PERILUNE_ORIGIN: base,
		PERILUNE_DATABASE: filename,
		PERILUNE_MOONRAKER_URL: `ws://127.0.0.1:${upstream.address().port}/websocket`,
		PERILUNE_LIVE_CONTROLS: 'true',
		PERILUNE_LIVE_MESH: 'false',
		PERILUNE_LIVE_CONFIGURATION: 'false',
		PERILUNE_MOONRAKER_API_KEY: '',
		PERILUNE_CAMERA_BASE_URL: '',
		PERILUNE_CAMERA_SOURCE: ''
	},
	stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '',
	browser;
app.stdout.on('data', (c) => {
	logs += c;
});
app.stderr.on('data', (c) => {
	logs += c;
});
try {
	for (let i = 0; ; i++) {
		try {
			if ((await fetch(base + '/health')).ok) break;
		} catch {}
		if (i > 100 || app.exitCode !== null) throw new Error(logs);
		await new Promise((r) => setTimeout(r, 100));
	}
	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	await authenticate(context, base, filename);
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.setDefaultTimeout(15000);
	await page.goto(base);
	await page.getByText(/Live controls enabled · shared across operators/).waitFor();
	await page.getByRole('spinbutton', { name: 'Bed target' }).fill('40');
	await page
		.locator('.heater')
		.filter({ has: page.getByRole('spinbutton', { name: 'Bed target' }) })
		.getByRole('button', { name: 'Set', exact: true })
		.click();
	await page.waitForFunction(() =>
		Array.from(document.querySelectorAll('.activity-list .action-status')).some(
			(e) => e.textContent === 'completed'
		)
	);
	assert.equal(status.heater_bed.target, 40);
	await page.goto(base + '/jobs');
	await page.getByRole('link', { name: /fixture.gcode/ }).click();
	await page.getByRole('button', { name: 'Review & start print', exact: true }).click();
	const start = page.getByRole('dialog');
	await start.getByRole('heading', { name: 'Start this print?', exact: true }).waitFor();
	await start.getByRole('button', { name: /Start/ }).click();
	await page.waitForFunction(() =>
		document.querySelector('.current-job')?.textContent?.includes('printing')
	);
	assert.equal(status.print_stats.state, 'printing');
	await page.goto(base);
	await page.getByRole('button', { name: 'Pause print', exact: true }).click();
	await page.getByRole('button', { name: 'Resume print', exact: true }).waitFor();
	await page.getByRole('button', { name: 'Resume print', exact: true }).click();
	await page.getByRole('button', { name: 'Pause print', exact: true }).waitFor();
	await page.getByRole('button', { name: 'Stop print', exact: true }).click();
	const stop = page.getByRole('dialog');
	// Preserve both targets, even if the configured cancel macro turns them off.
	await stop.getByRole('checkbox', { name: /bed/i }).uncheck();
	assert.equal(await stop.getByRole('checkbox', { name: /nozzle/i }).isDisabled(), true);
	await stop.getByRole('button', { name: 'Stop print', exact: true }).click();
	await page.getByText('cancelled', { exact: true }).first().waitFor();
	await page.waitForFunction(() =>
		Array.from(document.querySelectorAll('.activity-list .action-status')).some(
			(e) => e.textContent === 'completed'
		)
	);
	assert.equal(status.heater_bed.target, 40);
	assert.equal(status.extruder.target, 0);
	const native = await browser.newContext({
		javaScriptEnabled: false,
		storageState: await context.storageState(),
		viewport: { width: 1280, height: 900 }
	});
	const nativePage = await native.newPage();
	const database = new DatabaseSync(filename);
	const idle = async () => {
		for (let i = 0; i < 100; i++) {
			if (
				!database
					.prepare("SELECT count(*) AS n FROM actions WHERE status IN ('queued','sending')")
					.get().n
			)
				return;
			await new Promise((r) => setTimeout(r, 100));
		}
		throw new Error('Live action queue did not settle');
	};
	await nativePage.goto(base + '/jobs');
	await nativePage.getByRole('link', { name: /fixture.gcode/ }).click();
	await nativePage.getByRole('button', { name: 'Review & start print', exact: true }).click();
	await nativePage.getByRole('heading', { name: 'Start this print?', exact: true }).waitFor();
	await nativePage.getByRole('button', { name: 'Start print', exact: true }).click();
	await idle();
	assert.equal(status.print_stats.state, 'printing');
	await nativePage.goto(base);
	await nativePage.getByRole('button', { name: 'Pause print', exact: true }).click();
	await idle();
	assert.equal(status.print_stats.state, 'paused');
	await nativePage.goto(base);
	await nativePage.getByRole('button', { name: 'Resume print', exact: true }).click();
	await idle();
	assert.equal(status.print_stats.state, 'printing');
	await nativePage.goto(base);
	await nativePage.getByRole('button', { name: 'Stop print', exact: true }).click();
	await nativePage.getByRole('checkbox', { name: 'Stop the displayed print' }).check();
	await nativePage.getByRole('button', { name: 'Stop print', exact: true }).click();
	await idle();
	assert.equal(status.print_stats.state, 'cancelled');
	assert.equal(status.heater_bed.target, 0);
	database.close();
	await native.close();
	await page.goto(base + '/controls');
	await page.getByRole('button', { name: 'Disengage motors', exact: true }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Disengage motors', exact: true })
		.click();
	await page.getByRole('button', { name: 'Home All', exact: true }).waitFor({ state: 'visible' });
	await page.getByRole('button', { name: 'Home All', exact: true }).click();
	await page.waitForFunction(
		() =>
			document.querySelector('.home-all')?.disabled &&
			document.querySelector('.home-all')?.title === 'All axes are already homed.'
	);
	drop = true;
	await page.getByRole('button', { name: 'Disengage motors', exact: true }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Disengage motors', exact: true })
		.click();
	await page.getByText('Check the printer before continuing', { exact: true }).waitFor();
	drop = false;
	await page.getByRole('button', { name: 'Review recovery', exact: true }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Printer checked · unlock controls', exact: true })
		.click();
	await page
		.getByText('Check the printer before continuing', { exact: true })
		.waitFor({ state: 'hidden' });
	assert.ok(connections >= 2);
	assert.equal(
		operations.filter((o) => o.script === 'M84').length,
		2,
		'Dropped command was not replayed'
	);
	await page.setViewportSize({ width: 320, height: 800 });
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/live-actions-mobile.png', fullPage: true });
	await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
	assert.deepEqual(errors, []);
	console.log(
		'Live actions smoke passed: enhanced heaters, live catalog/start, pause/resume/cancel, preserved targets, motor release/home, dropped acknowledgement/recovery, no replay and 320px layout.'
	);
} catch (cause) {
	console.error(logs);
	throw cause;
} finally {
	await browser?.close();
	app.kill('SIGTERM');
	await new Promise((r) => (app.exitCode !== null ? r() : app.once('exit', r)));
	for (const c of protocol.clients) c.terminate();
	await new Promise((r) => protocol.close(r));
	await new Promise((r) => upstream.close(r));
	await rm(directory, { recursive: true, force: true });
}
