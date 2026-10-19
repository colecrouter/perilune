import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import { authenticate } from './smoke-auth-helper.mjs';
// Stateful loopback protocol fixture: this test never connects to a real printer.
const directory = await mkdtemp(join(tmpdir(), 'perilune-live-mesh-smoke-'));
const protocol = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await new Promise((r) => protocol.once('listening', r));
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
		save_config_pending: false
	},
	bed_mesh: {
		profile_name: 'default',
		mesh_min: [20, 20],
		mesh_max: [200, 200],
		probed_matrix: points,
		profiles: { default: profile(points) }
	}
};
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
			} else if (line.startsWith('BED_MESH_PROFILE SAVE='))
				status.bed_mesh.profiles[line.split('=')[1]] = profile(status.bed_mesh.probed_matrix);
			else if (line.startsWith('BED_MESH_PROFILE REMOVE='))
				delete status.bed_mesh.profiles[line.split('=')[1]];
			else if (line === 'SAVE_CONFIG') {
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
	await observer.goto(base + '/calibration/mesh');
	const prepare = async () => {
		await page.getByRole('button', { name: 'Probe bed…', exact: true }).click();
		await page.getByRole('checkbox', { name: /bed and probe cleanliness/ }).check();
		await page.getByRole('checkbox', { name: /physical clearance/ }).check();
		await page.getByRole('checkbox', { name: /printer will move and probe/ }).check();
	};
	await prepare();
	await page.getByRole('button', { name: 'Home and probe bed' }).click();
	await observer.getByText('Mapping the bed', { exact: true }).waitFor();
	await observer.getByText(/of 9 samples/).waitFor();
	await page.getByRole('link', { name: 'Controls', exact: true }).click();
	await observer.getByText('Review your mesh', { exact: true }).waitFor();
	await page.goto(base + '/calibration/mesh');
	await page
		.getByRole('button', { name: 'Save profile…', exact: true })
		.waitFor({ state: 'visible' });
	await page.waitForFunction(() =>
		[...document.querySelectorAll('button')].some(
			(b) => b.textContent === 'Save profile…' && !b.disabled
		)
	);
	assert.equal(await page.locator('.candidate-inspection').getByRole('combobox').count(), 0);
	assert.ok(
		(await page.locator('body').innerText()).includes('Klipper has already activated this mesh')
	);
	await page.getByRole('button', { name: 'Save profile…', exact: true }).click();
	await page.getByRole('textbox', { name: 'Profile name' }).fill('reviewed-bed');
	await page.getByRole('button', { name: 'Write and restart', exact: true }).click();
	await page.getByText(/Saved reviewed-bed and verified it after Klipper restarted/).waitFor();
	assert.deepEqual(status.bed_mesh.profiles.default.points, points);
	assert.ok(status.bed_mesh.profiles['reviewed-bed']);
	assert.equal(status.configfile.save_config_pending, false);
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
			(b) => b.textContent === 'Restore previous mesh…' && !b.disabled
		)
	);
	await page.getByRole('button', { name: 'Restore previous mesh…', exact: true }).click();
	await page.getByRole('button', { name: 'Restore previous mesh', exact: true }).click();
	await page
		.getByText('The previous mesh was restored. No configuration was written.', { exact: true })
		.waitFor();
	assert.equal(status.bed_mesh.profile_name, '');
	assert.equal(
		Object.keys(status.bed_mesh.profiles).filter((n) => n.startsWith('perilune_')).length,
		0
	);
	assert.equal(connections, 1, 'one process-owned printer socket');
	await page.setViewportSize({ width: 320, height: 800 });
	await prepare();
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/live-mesh-preparation-mobile.png', fullPage: true });
	assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
	assert.deepEqual(errors, []);
	console.log(
		'Live mesh production smoke passed: shared progress through navigation, homing, immediate activation, named save/restart verification, restoration, one socket, private-config filtering and 320px preparation.'
	);
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
	await rm(directory, { recursive: true, force: true });
}
