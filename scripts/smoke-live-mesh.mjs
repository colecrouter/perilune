import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import { authenticate } from './smoke-auth-helper.mjs';
// Stateful loopback protocol fixture: this test never connects to a real printer.
const directory = await mkdtemp(join(tmpdir(), 'perilune-live-mesh-smoke-'));
const http = createServer(async (req, res) => {
	try {
		const url = new URL(req.url, 'http://fixture');
		const json = (value) => {
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ result: value }));
		};
		if (req.method === 'POST' && url.pathname === '/server/files/upload') {
			const form = await new Request('http://fixture/upload', {
				method: 'POST',
				headers: req.headers,
				body: req,
				duplex: 'half'
			}).formData();
			assert.equal(form.get('root'), 'config');
			assert.equal(form.get('file').name, 'printer.cfg');
			savedText = await form.get('file').text();
			uploaded = true;
			uploadCount++;
			return json({});
		}
		if (req.method === 'POST') {
			let body = '';
			for await (const part of req) body += part;
			const script = body ? JSON.parse(body).script : null;
			if (url.pathname === '/printer/restart') {
				restart(false);
				json('ok');
				return;
			}
			if (script === 'SAVE_CONFIG') {
				scripts.push(script);
				restart(true);
				json('ok');
				return;
			}
		}
		if (url.pathname === '/printer/info')
			return json({ config_file: '/fixture/config/printer.cfg', state: klippy });
		if (url.pathname === '/server/files/roots')
			return json([{ name: 'config', path: '/fixture/config' }]);
		if (url.pathname === '/server/files/list')
			return json([
				{ path: 'printer.cfg', permissions: 'rw', modified: 1, size: Buffer.byteLength(savedText) }
			]);
		if (url.pathname === '/server/files/config/printer.cfg') {
			res.setHeader('Content-Type', 'text/plain');
			res.end(savedText);
			return;
		}
		if (url.pathname === '/printer/objects/query')
			return json({
				status: { ...status, heaters: { available_heaters: ['heater_bed', 'extruder'] } }
			});
		res.statusCode = 404;
		res.end();
	} catch (e) {
		res.statusCode = 500;
		res.end(String(e));
	}
});
const protocol = new WebSocketServer({ server: http });
await new Promise((r) => http.listen(0, '127.0.0.1', r));
const address = protocol.address();
assert.ok(address && typeof address !== 'string');
const base = 'http://127.0.0.1:4188';
let klippy = 'ready',
	eventtime = 1,
	connections = 0;
const points = [
	[0, 0.02, 0.04],
	[-0.01, 0.01, 0.03],
	[-0.02, 0, 0.02]
];
const profile = (matrix) => ({
	points: matrix,
	mesh_params: { min_x: 20, min_y: 20, max_x: 200, max_y: 200 }
});
const status = {
	print_stats: { state: 'complete', filename: 'fixture.gcode' },
	idle_timeout: { state: 'Idle' },
	manual_probe: { is_active: false },
	toolhead: {
		position: [0, 0, 20],
		axis_minimum: [0, 0, 0],
		axis_maximum: [220, 220, 250],
		homed_axes: ''
	},
	heater_bed: { temperature: 23, target: 0 },
	extruder: { temperature: 23, target: 0 },
	configfile: {
		config: {
			bed_mesh: { mesh_min: '20,20', mesh_max: '200,200', probe_count: '3,3' },
			probe: { samples: '2' },
			'gcode_macro PRIVATE': { gcode: 'PRIVATE_FIXTURE_CONFIG' }
		},
		save_config_pending: false,
		save_config_pending_items: {}
	},
	bed_mesh: {
		profile_name: 'default',
		mesh_min: [20, 20],
		mesh_max: [200, 200],
		probed_matrix: points,
		profiles: { default: profile(points) }
	}
};
const options = (matrix) => ({
	min_x: '20',
	min_y: '20',
	max_x: '200',
	max_y: '200',
	points: matrix.map((r) => r.join(',')).join('\n')
});
const editable =
	'[bed_mesh]\nmesh_min: 20,20\nmesh_max: 200,200\nprobe_count: 3,3\n\n[probe]\nsamples: 2\n\n[gcode_macro PRIVATE]\ngcode:\n    PRIVATE_FIXTURE_CONFIG';
const renderSaved = () =>
	editable +
	'\n\n#*# <---------------------- SAVE_CONFIG ---------------------->\n#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.\n#*#\n' +
	Object.entries(status.configfile.config)
		.filter(([name]) => name.startsWith('bed_mesh '))
		.map(
			([name, values]) =>
				'[' +
				name +
				']\n' +
				Object.entries(values)
					.map(([k, v]) => k + ' = ' + String(v).replace(/\n/g, '\n\t'))
					.join('\n')
		)
		.join('\n\n')
		.split('\n')
		.map((line) => ('#*# ' + line).trim())
		.join('\n') +
	'\n';
status.configfile.config['bed_mesh default'] = options(points);
let savedProfiles = structuredClone(status.bed_mesh.profiles),
	savedText = renderSaved(),
	uploaded = false,
	uploadCount = 0;
function restart(save) {
	if (save) {
		for (const [section, value] of Object.entries(status.configfile.save_config_pending_items)) {
			if (value === null) delete status.configfile.config[section];
			else status.configfile.config[section] = value;
		}
		savedProfiles = structuredClone(status.bed_mesh.profiles);
		savedText = renderSaved();
	} else if (uploaded) {
		for (const [section, value] of Object.entries(status.configfile.save_config_pending_items))
			if (value === null) delete status.configfile.config[section];
		savedProfiles = structuredClone(status.bed_mesh.profiles);
		uploaded = false;
	} else status.bed_mesh.profiles = structuredClone(savedProfiles);
	status.configfile.save_config_pending = false;
	status.configfile.save_config_pending_items = {};
	klippy = 'startup';
	notify('notify_klippy_shutdown');
	later(() => {
		klippy = 'ready';
		status.toolhead.homed_axes = '';
		status.bed_mesh.profile_name = '';
		status.bed_mesh.probed_matrix = [[]];
		notify('notify_klippy_ready');
		update();
	}, 400);
}
const scripts = [],
	timers = new Set();
const later = (fn, delay) => {
	const timer = setTimeout(() => {
		timers.delete(timer);
		fn();
	}, delay);
	timers.add(timer);
};
const notify = (method, params = []) => {
	for (const socket of protocol.clients)
		if (socket.readyState === 1) socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
};
const update = () => notify('notify_status_update', [status, ++eventtime]);
protocol.on('connection', (socket) => {
	connections++;
	socket.on('message', (bytes) => {
		const request = JSON.parse(
			Buffer.isBuffer(bytes)
				? bytes.toString()
				: bytes instanceof ArrayBuffer
					? Buffer.from(bytes).toString()
					: Buffer.concat(bytes).toString()
		);
		const reply = (result) => {
			if (socket.readyState === 1)
				socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
		};
		if (request.method === 'server.connection.identify') return reply({});
		if (request.method === 'server.info') return reply({ klippy_state: klippy });
		if (request.method === 'printer.objects.list') return reply({ objects: Object.keys(status) });
		if (['printer.objects.subscribe', 'printer.objects.query'].includes(request.method))
			return reply({ status, eventtime });
		assert.equal(request.method, 'printer.gcode.script');
		const script = request.params.script;
		scripts.push(script);
		if (script === 'G28') {
			status.toolhead.homed_axes = 'xyz';
			update();
			return reply('ok');
		}
		if (script.startsWith('BED_MESH_CALIBRATE PROFILE=')) {
			const name = script.split('=')[1];
			status.idle_timeout.state = 'Printing';
			status.bed_mesh.profile_name = '';
			status.bed_mesh.probed_matrix = [[]];
			update();
			for (let sample = 0; sample < 18; sample++)
				later(
					() => {
						const index = Math.floor(sample / 2),
							row = Math.floor(index / 3),
							column = row % 2 ? 2 - (index % 3) : index % 3;
						notify('notify_gcode_response', [
							`// probe: at ${20 + column * 90}.000,${20 + row * 90}.000 bed will contact at z=0.025000`
						]);
						if (sample === 17) {
							const measured = points.map((r) => r.map((v) => v + 0.1));
							status.bed_mesh.profile_name = name;
							status.bed_mesh.probed_matrix = measured;
							status.bed_mesh.profiles[name] = profile(measured);
							status.configfile.save_config_pending = true;
							status.configfile.save_config_pending_items['bed_mesh ' + name] = options(measured);
							update();
							reply('ok');
							later(() => {
								status.idle_timeout.state = 'Ready';
								update();
							}, 750);
						}
					},
					(sample + 1) * 120
				);
			return;
		}
		for (const line of script.split('\n')) {
			if (line === 'BED_MESH_CLEAR') {
				status.bed_mesh.profile_name = '';
				status.bed_mesh.probed_matrix = [[]];
			} else if (line.startsWith('BED_MESH_PROFILE LOAD=')) {
				const name = line.split('=')[1];
				status.bed_mesh.profile_name = name;
				status.bed_mesh.probed_matrix = status.bed_mesh.profiles[name].points;
			} else if (line.startsWith('BED_MESH_PROFILE SAVE=')) {
				const name = line.split('=')[1];
				status.bed_mesh.profiles[name] = profile(status.bed_mesh.probed_matrix);
				status.configfile.save_config_pending_items['bed_mesh ' + name] = options(
					status.bed_mesh.probed_matrix
				);
			} else if (line.startsWith('BED_MESH_PROFILE REMOVE=')) {
				const name = line.split('=')[1];
				delete status.bed_mesh.profiles[name];
				status.configfile.save_config_pending_items['bed_mesh ' + name] = null;
				status.configfile.save_config_pending = true;
			} else if (line === 'SAVE_CONFIG') {
				status.configfile.save_config_pending = false;
				klippy = 'startup';
				notify('notify_klippy_shutdown');
				later(() => {
					klippy = 'ready';
					status.toolhead.homed_axes = '';
					status.bed_mesh.profile_name = '';
					status.bed_mesh.probed_matrix = [[]];
					notify('notify_klippy_ready');
					update();
				}, 400);
			}
		}
		update();
		reply('ok');
	});
});
const app = spawn(process.execPath, ['scripts/server.mjs'], {
	env: {
		...process.env,
		HOST: '127.0.0.1',
		PORT: '4188',
		PERILUNE_ORIGIN: base,
		PERILUNE_DATABASE: join(directory, 'state.sqlite'),
		PERILUNE_MOONRAKER_URL: `ws://127.0.0.1:${address.port}/websocket`,
		PERILUNE_LIVE_MESH: 'true',
		PERILUNE_LIVE_CONTROLS: 'true',
		PERILUNE_LIVE_CONSOLE: 'true',
		PERILUNE_MOONRAKER_API_KEY: '',
		PERILUNE_CAMERA_COMPANION_URL: ''
	},
	stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '',
	browser;
app.stdout.on('data', (b) => (logs += b));
app.stderr.on('data', (b) => (logs += b));
try {
	for (let attempt = 0; ; attempt++) {
		try {
			if ((await fetch(base + '/health')).ok) break;
		} catch {}
		if (app.exitCode !== null || attempt > 100) throw new Error('Live mesh server failed: ' + logs);
		await new Promise((r) => setTimeout(r, 100));
	}
	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	await authenticate(context, base, join(directory, 'state.sqlite'));
	const page = await context.newPage(),
		observer = await context.newPage(),
		errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	observer.on('pageerror', (e) => errors.push(e.message));
	await page.goto(base + '/calibration/mesh');
	await observer.goto(base);
	await observer.locator('form[data-enhanced="true"]:has(#bed-target)').waitFor();
	await observer.getByRole('spinbutton', { name: 'Bed target' }).fill('85');
	const consoleObserver = await context.newPage();
	consoleObserver.on('pageerror', (e) => errors.push(e.message));
	const consoleReady = consoleObserver.waitForResponse((response) =>
		response.url().includes('/getConsole')
	);
	await consoleObserver.goto(base + '/console');
	await consoleReady;
	await consoleObserver.getByRole('textbox', { name: 'Command', exact: true }).fill('M105');
	const prepare = async () => {
		await page.getByRole('button', { name: 'New calibration…', exact: true }).click();
		await page.getByRole('checkbox', { name: /bed and probe cleanliness/ }).check();
		await page.getByRole('checkbox', { name: /physical clearance/ }).check();
		await page.getByRole('checkbox', { name: /printer will move and probe/ }).check();
	};
	await prepare();
	await page.getByRole('button', { name: 'Home and probe bed' }).click();
	await observer.getByText('Bed-mesh calibration in progress', { exact: true }).waitFor();
	await consoleObserver
		.locator('p.notice')
		.getByRole('link', { name: 'Review bed mesh →' })
		.waitFor();
	await page.getByRole('link', { name: 'Controls', exact: true }).click();
	await observer.getByText('Bed-mesh review is waiting', { exact: true }).waitFor();
	assert.equal(await observer.getByRole('spinbutton', { name: 'Bed target' }).inputValue(), '85');
	assert.equal(
		await consoleObserver.getByRole('textbox', { name: 'Command', exact: true }).inputValue(),
		'M105'
	);
	await page.goto(base + '/calibration/mesh');
	await page
		.getByRole('button', { name: 'Use & save…', exact: true })
		.waitFor({ state: 'visible' });
	await page.waitForFunction(() =>
		[...document.querySelectorAll('button')].some(
			(b) => b.textContent === 'Use & save…' && !b.disabled
		)
	);
	assert.equal(await page.locator('.candidate-inspection').getByRole('combobox').count(), 0);
	assert.ok((await page.locator('body').innerText()).includes('Klipper has activated the result'));
	await page.getByRole('button', { name: 'Use & save…', exact: true }).click();
	await page.getByRole('checkbox', { name: 'Also save a named copy' }).check();
	await page.getByRole('textbox', { name: 'Profile name' }).fill('reviewed-bed');
	await page.getByRole('button', { name: 'Write and restart', exact: true }).click();
	await page.getByText(/Usual mesh saved and verified after restart/).waitFor();
	assert.deepEqual(
		status.bed_mesh.profiles.default.points,
		points.map((r) => r.map((v) => v + 0.1))
	);
	assert.ok(status.bed_mesh.profiles['reviewed-bed']);
	assert.equal(status.configfile.save_config_pending, false);
	await observer
		.getByRole('region', { name: 'Printer workflow status' })
		.waitFor({ state: 'detached' });
	assert.equal(await observer.getByRole('spinbutton', { name: 'Bed target' }).inputValue(), '85');
	assert.equal(
		await consoleObserver.getByRole('textbox', { name: 'Command', exact: true }).inputValue(),
		'M105'
	);
	assert.equal(scripts.filter((s) => s.includes('SAVE_CONFIG')).length, 1);
	assert.equal(scripts.filter((s) => s === 'G28').length, 1);
	assert.ok(
		!JSON.stringify(await page.locator('body').innerText()).includes('PRIVATE_FIXTURE_CONFIG')
	);
	await prepare();
	await page.getByRole('button', { name: 'Home and probe bed' }).click();
	await page.getByText('Review your mesh', { exact: true }).waitFor();
	await page.waitForFunction(() =>
		[...document.querySelectorAll('button')].some(
			(b) => b.textContent === 'Discard calibration…' && !b.disabled
		)
	);
	await page.getByRole('button', { name: 'Discard calibration…', exact: true }).click();
	await page.getByRole('button', { name: 'Discard and restart', exact: true }).click();
	await page
		.getByText(
			'Calibration discarded. Saved configuration is unchanged; the previous active mesh was restored after restart.',
			{ exact: true }
		)
		.waitFor();
	assert.equal(status.bed_mesh.profile_name, '');
	assert.equal(
		Object.keys(status.bed_mesh.profiles).filter((n) => n.startsWith('perilune_')).length,
		0
	);
	const remove = async (name) => {
		const row = page
			.locator('.saved-meshes li')
			.filter({ has: page.getByText(name, { exact: true }) });
		await row.getByRole('button', { name: 'Delete…', exact: true }).click();
		await page.getByRole('checkbox', { name: /I checked my print-start/ }).check();
		await page.getByRole('button', { name: 'Delete and restart', exact: true }).click();
		await page.getByRole('dialog').waitFor({ state: 'hidden' });
		await page
			.locator('.saved-meshes [role="status"]')
			.filter({ hasText: 'Delete saved mesh and restart: completed.' })
			.waitFor();
	};
	await remove('reviewed-bed');
	await remove('Usual mesh');
	assert.deepEqual(Object.keys(status.bed_mesh.profiles), []);
	assert.equal(uploadCount, 1);
	assert.ok(!savedText.includes('#*#'));
	assert.equal(scripts.filter((s) => s === 'SAVE_CONFIG').length, 2);
	assert.equal(connections, 1, 'one process-owned printer socket');
	await page.setViewportSize({ width: 320, height: 800 });
	await prepare();
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/live-mesh-preparation-mobile.png', fullPage: true });
	assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
	assert.deepEqual(errors, []);
	console.log(
		'Live mesh production smoke passed: shared progress through navigation, homing, immediate activation, usual replacement, optional copy, verified discard, deletion including final autosave section, one socket, private-config filtering and 320px preparation.'
	);
} catch (error) {
	const debug = browser?.contexts()[0]?.pages()[0];
	if (debug) {
		await debug.goto(base + '/calibration/mesh');
		console.error(
			await debug
				.locator('.probe-workflow')
				.innerText()
				.catch(() => '')
		);
	}
	throw error;
} finally {
	await browser?.close();
	for (const timer of timers) clearTimeout(timer);
	app.kill('SIGTERM');
	await Promise.race([
		new Promise((r) => app.once('exit', r)),
		new Promise((r) => setTimeout(r, 2000))
	]);
	if (app.exitCode === null) app.kill('SIGKILL');
	for (const socket of protocol.clients) socket.terminate();
	await new Promise((r) => protocol.close(r));
	http.closeAllConnections();
	await new Promise((r) => http.close(r));
	await rm(directory, { recursive: true, force: true });
}
