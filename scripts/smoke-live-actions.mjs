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
		position: [100, 100, 20, 100],
		extruder: 'extruder',
		axis_minimum: [-5, -5, 0],
		axis_maximum: [220, 220, 250],
		homed_axes: 'xyz'
	},
	idle_timeout: { state: 'Idle' },
	manual_probe: { is_active: false, z_position: 20 },
	print_stats: { state: 'complete', filename: 'fixture.gcode', print_duration: 0 },
	virtual_sdcard: { progress: 0 },
	extruder: { temperature: 25, target: 0, can_extrude: true },
	heater_bed: { temperature: 25, target: 0 },
	configfile: {
		config: {
			bltouch: { x_offset: '-24', y_offset: '-13', z_offset: '1.2' },
			extruder: { min_temp: '0', max_temp: '280' },
			heater_bed: { min_temp: '0', max_temp: '130' }
		},
		save_config_pending: false,
		save_config_pending_items: {}
	}
};
let safetyShutdown = false;
const safetyRequests = [];
const upstream = createServer((req, res) => {
	res.setHeader('Content-Type', 'application/json');
	if (
		req.method === 'POST' &&
		[
			'/printer/emergency_stop',
			'/printer/print/cancel',
			'/printer/gcode/script',
			'/printer/firmware_restart'
		].includes(req.url)
	) {
		safetyRequests.push(req.url);
		if (req.url === '/printer/emergency_stop') {
			safetyShutdown = true;
			for (const socket of protocol.clients)
				if (socket.readyState === 1)
					socket.send(
						JSON.stringify({ jsonrpc: '2.0', method: 'notify_klippy_shutdown', params: [] })
					);
		}
		if (req.url === '/printer/firmware_restart') {
			status.extruder.target = 0;
			status.heater_bed.target = 0;
			status.print_stats.state = 'standby';
			for (const socket of protocol.clients)
				if (socket.readyState === 1)
					socket.send(
						JSON.stringify({ jsonrpc: '2.0', method: 'notify_klippy_disconnected', params: [] })
					);
			setTimeout(() => {
				safetyShutdown = false;
				for (const socket of protocol.clients)
					if (socket.readyState === 1)
						socket.send(
							JSON.stringify({ jsonrpc: '2.0', method: 'notify_klippy_ready', params: [] })
						);
			}, 100);
		}
		if (req.url === '/printer/print/cancel') status.print_stats.state = 'cancelled';
		if (req.url === '/printer/gcode/script') {
			status.extruder.target = 0;
			status.heater_bed.target = 0;
		}
		publish();
		res.end(JSON.stringify({ result: 'ok' }));
	} else if (req.url === '/printer/info')
		res.end(JSON.stringify({ result: { state: safetyShutdown ? 'shutdown' : 'ready' } }));
	else if (req.url.startsWith('/server/files/list'))
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
	drop = false,
	stagedResume = false;
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
				result = { klippy_state: safetyShutdown ? 'shutdown' : 'ready' };
				break;
			case 'printer.objects.list':
				result = { objects: Object.keys(status) };
				break;
			case 'printer.objects.subscribe':
			case 'printer.objects.query':
				result = { status, eventtime: Date.now() };
				break;
			case 'printer.gcode.help':
				result = { PID_CALIBRATE: 'native', TURN_OFF_HEATERS: 'native' };
				break;
			case 'printer.gcode.script': {
				operations.push({ method: req.method, ...req.params });
				if (drop) {
					socket.terminate();
					return;
				}
				const script = req.params.script;
				if (script.startsWith('PROBE_CALIBRATE')) {
					status.manual_probe.is_active = true;
					status.manual_probe.z_position = 5;
				}
				if (script.startsWith('TESTZ'))
					status.manual_probe.z_position += Number(script.match(/Z=(-?[\d.]+)/)[1]);
				if (script.startsWith('ABORT')) status.manual_probe.is_active = false;
				if (script.startsWith('ACCEPT')) {
					status.manual_probe.is_active = false;
					status.configfile.save_config_pending = true;
					status.configfile.save_config_pending_items = { bltouch: { z_offset: '1.234' } };
				}

				const extrusion = script.match(/G1 E(-?[\d.]+) F60/);
				if (extrusion) status.toolhead.position[3] += Number(extrusion[1]);
				for (const m of script.matchAll(/HEATER=(heater_bed|extruder) TARGET=([\d.]+)/g))
					status[m[1]].target = Number(m[2]);
				if (script === 'M84') status.toolhead.homed_axes = '';
				if (script.startsWith('G28')) status.toolhead.homed_axes = 'xyz';
				if (script.startsWith('PID_CALIBRATE')) {
					assert.equal(script, 'PID_CALIBRATE HEATER=extruder TARGET=200\nTURN_OFF_HEATERS');
					status.configfile.save_config_pending = true;
					status.configfile.save_config_pending_items = {
						extruder: { control: 'pid', pid_kp: '20', pid_ki: '1.2', pid_kd: '80' }
					};
				}
				if (script.endsWith('TURN_OFF_HEATERS')) {
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
				status.print_stats.state =
					req.method.endsWith('pause') || (stagedResume && req.method.endsWith('resume'))
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
		PERILUNE_LIVE_PID: 'true',
		PERILUNE_LIVE_CONSOLE: 'true',
		PERILUNE_LIVE_FILAMENT: 'true',
		PERILUNE_LIVE_Z_CALIBRATION: 'true',
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
	page.on('pageerror', (e) => {
		errors.push(e.message);
		console.error('Browser error at', page.url(), e.stack);
	});
	page.setDefaultTimeout(15000);
	await page.goto(base);
	await page.getByText(/Live controls enabled · shared across operators/).waitFor();
	await page.goto(base + '/calibration/pid');
	await page.getByRole('checkbox', { name: /I am attending/ }).check();
	await page.getByRole('button', { name: 'Start heater calibration', exact: true }).click();
	await page
		.getByRole('heading', { name: 'Review the proposed PID settings', exact: true })
		.waitFor();
	assert.equal(status.extruder.target, 0);
	assert.equal(operations.filter((op) => op.script?.startsWith('PID_CALIBRATE')).length, 1);
	await page.reload();
	await page
		.getByRole('heading', { name: 'Review the proposed PID settings', exact: true })
		.waitFor();
	await page.setViewportSize({ width: 320, height: 800 });
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/pid-result-mobile.png', fullPage: true });
	status.configfile.save_config_pending = false;
	status.configfile.save_config_pending_items = {};
	publish();
	await page.getByRole('heading', { name: 'Pending settings changed', exact: true }).waitFor();
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(base);
	await page.getByRole('spinbutton', { name: 'Bed target' }).fill('40');
	await page
		.locator('.heater')
		.filter({ has: page.getByRole('spinbutton', { name: 'Bed target' }) })
		.getByRole('button', { name: 'Set', exact: true })
		.click();
	await page.goto(base + '/activity');
	await page
		.locator('article')
		.filter({ has: page.getByRole('link', { name: 'Set bed to 40°C', exact: true }) })
		.getByText('completed', { exact: true })
		.waitFor();
	assert.equal(status.heater_bed.target, 40);
	await page.goto(base + '/jobs');
	await page.getByRole('link', { name: /fixture.gcode/ }).click();
	await page.getByRole('button', { name: 'Review & start print', exact: true }).click();
	const start = page.getByRole('dialog');
	await start.getByRole('heading', { name: 'Start this print?', exact: true }).waitFor();
	await start.getByRole('button', { name: /Start/ }).click();
	await page.waitForFunction(
		() => document.querySelector('[aria-label="Current job"]')?.dataset.jobState === 'printing'
	);
	assert.equal(status.print_stats.state, 'printing');
	await page.goto(base);
	await page.getByRole('button', { name: 'Pause print', exact: true }).click();
	await page.getByRole('button', { name: 'Resume print', exact: true }).waitFor();
	stagedResume = true;
	await page.getByRole('button', { name: 'Resume print', exact: true }).click();
	await page
		.getByRole('region', { name: 'Current job', exact: true })
		.getByText('Resume macro completed; the print remains paused.', { exact: false })
		.waitFor();
	assert.equal(status.print_stats.state, 'paused');
	assert.equal(
		await page.getByText('Check the printer before continuing', { exact: true }).count(),
		0
	);
	stagedResume = false;
	await page.getByRole('button', { name: 'Resume print', exact: true }).click();
	await page.getByRole('button', { name: 'Pause print', exact: true }).waitFor();
	await page.getByRole('button', { name: 'Stop print', exact: true }).click();
	const stop = page.getByRole('dialog');
	// Preserve both targets, even if the configured cancel macro turns them off.
	await stop.getByRole('checkbox', { name: /bed/i }).uncheck();
	assert.equal(await stop.getByRole('checkbox', { name: /nozzle/i }).isDisabled(), true);
	await stop.getByRole('button', { name: 'Stop print', exact: true }).click();
	await page.getByRole('heading', { name: 'Print stopped', exact: true }).waitFor();
	await page.goto(base + '/activity');
	await page
		.locator('article')
		.filter({ has: page.getByRole('link', { name: 'Stop print', exact: true }) })
		.getByText('completed', { exact: true })
		.waitFor();
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
	// Keep the authenticated no-JS context for the recovery safety forms below.
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

	status.extruder.temperature = 210;
	status.extruder.target = 210;
	publish();
	await page.goto(base + '/calibration/extrusion');
	await page.getByRole('spinbutton', { name: 'Current rotation distance (mm)' }).fill('7.5');
	await page.getByRole('checkbox', { name: /Filament is loaded/ }).check();
	await page.getByRole('checkbox', { name: /nozzle has clearance/ }).check();
	await page.getByRole('button', { name: 'Extrude 50 mm · live printer' }).click();
	await page.getByRole('spinbutton', { name: 'Remaining distance (mm)' }).waitFor();
	await page.getByRole('spinbutton', { name: 'Remaining distance (mm)' }).fill('22');
	await page.getByRole('button', { name: 'Calculate proposal', exact: true }).click();
	await page.getByRole('heading', { name: '7.200 mm rotation distance' }).waitFor();
	await page.getByRole('button', { name: 'Finish measurement', exact: true }).click();
	await page
		.getByText('Measurement finished. The proposal remains unapplied.', { exact: true })
		.waitFor();
	assert.equal(status.toolhead.position[3], 150);
	assert.equal(status.extruder.target, 0);

	await page.goto(base + '/calibration');
	await page.getByRole('checkbox', { name: 'The nozzle and bed are clean' }).check();
	await page
		.getByRole('checkbox', { name: 'The bed is clear and I am watching the printer' })
		.check();
	await page
		.getByRole('checkbox', { name: 'I have paper ready and understand that adjustment moves Z' })
		.check();
	await page.getByRole('button', { name: 'Begin paper test', exact: true }).click();
	await page.getByRole('button', { name: 'Z +', exact: true }).waitFor();
	await page.getByRole('button', { name: 'Z +', exact: true }).click();
	await page.getByText('5.010 mm', { exact: true }).waitFor();
	await page.getByRole('radio', { name: 'Coarse approach', exact: true }).check();
	await page.getByRole('radio', { name: '1', exact: true }).check();
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/live-z-approach-desktop.png', fullPage: true });
	await page.setViewportSize({ width: 320, height: 800 });
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Z approach fits 320px'
	);
	await page.screenshot({ path: 'test-results/live-z-approach-mobile.png', fullPage: true });
	await page.getByRole('button', { name: 'Z −', exact: true }).click();
	await page.getByText('4.010 mm', { exact: true }).waitFor();
	await page.getByRole('radio', { name: 'Fine tuning', exact: true }).check();
	assert.equal(await page.getByRole('radio', { name: '0.01', exact: true }).isChecked(), true);
	await page.setViewportSize({ width: 1440, height: 1000 });

	await page.getByRole('button', { name: 'Abort paper test…', exact: true }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Abort paper test', exact: true })
		.click();
	await page
		.getByText('Manual probing aborted. No calibration setting was saved.', { exact: true })
		.waitFor();
	assert.equal(status.manual_probe.is_active, false);
	assert.equal(status.configfile.save_config_pending, false);
	await page.getByRole('button', { name: 'Begin paper test', exact: true }).click();
	await page.getByRole('checkbox', { name: /I checked the paper drag/ }).check();
	await page.getByRole('button', { name: 'Accept height · stage result', exact: true }).click();
	await page.getByRole('heading', { name: 'Accepted · waiting to save', exact: true }).waitFor();
	await page
		.getByRole('region', { name: 'Z calibration result' })
		.getByText('5.000 mm', { exact: true })
		.waitFor();
	status.configfile.save_config_pending = false;
	status.configfile.save_config_pending_items = {};
	publish();
	await page.getByRole('heading', { name: 'Accepted result', exact: true }).waitFor();
	await page.getByText(/that alone does not prove/).waitFor();
	await page.reload();
	await page.getByRole('heading', { name: 'Accepted result', exact: true }).waitFor();
	await page.setViewportSize({ width: 320, height: 800 });
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Z result fits 320px'
	);
	await page.screenshot({ path: 'test-results/live-z-result-mobile.png', fullPage: true });
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto(base + '/controls');
	drop = true;
	await page.getByRole('button', { name: 'Disengage motors', exact: true }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Disengage motors', exact: true })
		.click();
	await page
		.getByRole('link', { name: 'Check the printer and review recovery →', exact: true })
		.waitFor();

	drop = false;
	// Recovery safety is a separate workflow, never a replay of the lost motor command.
	const recoveryBefore = database
		.prepare('SELECT action_id FROM live_action_reservation LIMIT 1')
		.get();
	status.print_stats.state = 'printing';
	status.print_stats.print_duration = 1;
	status.heater_bed.target = 40;
	status.extruder.target = 50;
	publish();
	await page.getByRole('link', { name: 'Stop current job', exact: true }).waitFor();
	await page.getByRole('link', { name: 'Stop current job', exact: true }).click();
	const safetyDialog = page.getByRole('dialog');
	await safetyDialog.getByRole('button', { name: 'Stop job', exact: true }).click();
	await safetyDialog.waitFor({ state: 'hidden' });
	await page.getByRole('link', { name: 'Activity', exact: true }).click();
	await page.getByRole('heading', { name: 'Printer activity', exact: true }).waitFor();
	await page
		.locator('article')
		.filter({
			has: page.getByRole('link', { name: 'Stop current job during recovery', exact: true })
		})
		.getByText('completed', { exact: true })
		.waitFor();
	await page.getByRole('link', { name: '← Return to overview', exact: true }).click();
	assert.equal(status.print_stats.state, 'cancelled');
	await nativePage.goto(base);
	await nativePage.getByRole('link', { name: 'Turn off heaters', exact: true }).click();
	await nativePage.getByRole('button', { name: 'Turn off heaters', exact: true }).click();
	await nativePage
		.getByRole('heading', { name: 'Turn off heaters during recovery', exact: true })
		.waitFor();
	for (let i = 0; i < 100 && status.extruder.target !== 0; i++)
		await new Promise((r) => setTimeout(r, 50));
	assert.equal(status.extruder.target, 0);
	assert.equal(status.heater_bed.target, 0);
	assert.deepEqual(
		database.prepare('SELECT action_id FROM live_action_reservation LIMIT 1').get(),
		recoveryBefore
	);
	assert.deepEqual(safetyRequests, ['/printer/print/cancel', '/printer/gcode/script']);
	await page.goto(base + '/activity#recovery');
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

	await page.getByRole('button', { name: 'Emergency stop', exact: true }).click();
	await page.getByText('Emergency interlock active.', { exact: false }).waitFor();
	assert.equal(
		await page.getByRole('dialog').count(),
		0,
		'Emergency shutdown has no blocking confirmation dialog'
	);
	await page.getByRole('link', { name: 'Activity', exact: true }).click();
	await page
		.locator('article')
		.filter({ has: page.getByRole('link', { name: 'Emergency stop', exact: true }) })
		.getByText('completed', { exact: true })
		.waitFor();
	await page.getByRole('link', { name: '← Return to overview', exact: true }).click();
	assert.equal(safetyRequests.filter((p) => p === '/printer/emergency_stop').length, 1);
	await page.getByRole('link', { name: 'Review hazard and recover →', exact: true }).click();
	const recoveryPanel = page.getByRole('region', { name: 'Emergency recovery', exact: true });
	await recoveryPanel
		.getByRole('checkbox', {
			name: 'I have inspected the printer and resolved the hazard',
			exact: true
		})
		.check();
	assert.equal(safetyShutdown, true, 'Checking the box does not restart firmware');
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ path: 'test-results/emergency-recovery-mobile.png', fullPage: true });
	await page.setViewportSize({ width: 1280, height: 900 });
	await recoveryPanel.getByRole('button', { name: 'Restart firmware', exact: true }).click();
	await recoveryPanel.waitFor({ state: 'hidden' });
	assert.equal(safetyRequests.filter((p) => p === '/printer/firmware_restart').length, 1);
	await page
		.getByText('Emergency interlock active.', { exact: false })
		.waitFor({ state: 'hidden' });

	await page.goto(base + '/console');
	await page.getByLabel('Command', { exact: true }).fill('M105\nM114');
	await page.getByText('Commands and macros run on the real printer', { exact: false }).waitFor();
	await page.getByRole('button', { name: 'Send command', exact: true }).click();
	await page
		.getByText('Klipper acknowledged the script and motion barrier', { exact: false })
		.waitFor();
	assert.equal(operations.filter((op) => op.script === 'M105\nM114\nM400').length, 1);

	const printKeyResponse = await context.request.post(base + '/api/jobs/key', {
		headers: { Origin: base },
		data: { name: 'Native slicer fixture', canPrint: true }
	});
	assert.equal(printKeyResponse.status(), 200);
	const printKey = await printKeyResponse.json();
	const startCount = operations.filter((op) => op.method === 'printer.print.start').length;
	const slicerStart = () =>
		fetch(base + '/printer/print/start', {
			method: 'POST',
			headers: { 'X-Api-Key': printKey.token, 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: 'fixture.gcode' })
		});
	const [nativeStart, nativeRetry] = await Promise.all([slicerStart(), slicerStart()]);
	assert.equal(nativeStart.status, 200);
	assert.equal(nativeRetry.status, 200);
	assert.equal(
		(await nativeStart.json()).perilune.receiptId,
		(await nativeRetry.json()).perilune.receiptId
	);
	assert.equal(status.print_stats.state, 'printing');
	assert.equal(
		operations.filter((op) => op.method === 'printer.print.start').length,
		startCount + 1
	);
	await context.request.post(base + '/api/jobs/revoke-key', {
		headers: { Origin: base },
		data: { id: printKey.key.id }
	});
	assert.equal((await slicerStart()).status, 401);
	await page.goto(base + '/jobs');
	await page.getByRole('button', { name: 'Stop print', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Stop print', exact: true }).click();
	await page.waitForFunction(
		() => document.querySelector('[aria-label="Current job"]').dataset.jobState === 'cancelled'
	);

	// A genuine lost acknowledgement stays unknown; paused unlock needs owner attestation.
	status.print_stats.state = 'paused';
	publish();
	await page.goto(base);
	drop = true;
	await page.getByRole('button', { name: 'Resume print', exact: true }).click();
	await page
		.getByRole('link', { name: 'Check the printer and review recovery →', exact: true })
		.waitFor();
	drop = false;
	await page.reload();
	await page.goto(base + '/activity#recovery');
	await page.getByRole('button', { name: 'Review recovery', exact: true }).click();
	const pausedReview = page.getByRole('dialog');
	const unlock = pausedReview.getByRole('button', {
		name: 'Printer checked · unlock controls',
		exact: true
	});
	assert.equal(await unlock.isDisabled(), true);
	await pausedReview
		.getByRole('checkbox', {
			name: 'I have verified this is the same paused print and movement has stopped.'
		})
		.check();
	await page.setViewportSize({ width: 320, height: 800 });
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/paused-resume-recovery-mobile.png', fullPage: true });
	const resumesBeforeUnlock = operations.filter(
		(op) => op.method === 'printer.print.resume'
	).length;
	await unlock.click();
	await page
		.getByText('Check the printer before continuing', { exact: true })
		.waitFor({ state: 'hidden' });
	assert.equal(status.print_stats.state, 'paused');
	assert.equal(
		operations.filter((op) => op.method === 'printer.print.resume').length,
		resumesBeforeUnlock
	);
	assert.equal(
		database
			.prepare(
				"SELECT status FROM actions WHERE label='Resume print' ORDER BY created_at DESC LIMIT 1"
			)
			.get().status,
		'unknown'
	);

	database.close();
	await native.close();
	await page.setViewportSize({ width: 320, height: 800 });
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/live-actions-mobile.png', fullPage: true });
	await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
	assert.deepEqual(errors, []);
	console.log(
		'Live actions smoke passed: enhanced heaters, live catalog/start, pause/resume/cancel, preserved targets, motor release/home, dropped acknowledgement/recovery, enhanced safety stop, no-JS cooldown, preserved reservation, emergency shutdown/review, no replay and 320px layout.'
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
