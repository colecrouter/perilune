import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import { authenticate } from './smoke-auth-helper.mjs';
const directory = await mkdtemp(join(tmpdir(), 'perilune-console-smoke-'));
const children = [];
let logs = '',
	browser;
const methods = [];
const sockets = [];
const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await new Promise((resolve) => upstream.once('listening', resolve));
upstream.on('connection', (socket) => {
	sockets.push(socket);
	socket.on('message', (bytes) => {
		const request = JSON.parse(bytes.toString());
		methods.push(request.method);
		const results = {
			'server.connection.identify': {},
			'server.info': { klippy_state: 'ready' },
			'printer.objects.list': {
				objects: ['print_stats', 'extruder', 'heater_bed', 'gcode_macro TEST_MACRO']
			},
			'printer.gcode.help': { TEST_MACRO: 'Fixture macro description' },
			'printer.objects.subscribe': {
				eventtime: 1,
				status: {
					print_stats: { state: 'standby', filename: '' },
					extruder: { temperature: 20, target: 0 },
					heater_bed: { temperature: 20, target: 0 }
				}
			}
		};
		assert.ok(request.method in results, 'No write RPC is permitted by the live fixture');
		socket.send(
			JSON.stringify({ jsonrpc: '2.0', id: request.id, result: results[request.method] })
		);
	});
});
async function start(port, live = false) {
	const base = `http://127.0.0.1:${port}`,
		filename = join(directory, `${port}.sqlite`);
	const child = spawn(process.execPath, ['scripts/server.mjs'], {
		env: {
			...process.env,
			HOST: '127.0.0.1',
			PORT: String(port),
			PERILUNE_ORIGIN: base,
			PERILUNE_DATABASE: filename,
			PERILUNE_MOONRAKER_URL: live ? `ws://127.0.0.1:${upstream.address().port}/websocket` : '',
			PERILUNE_MOONRAKER_API_KEY: '',
			PERILUNE_CAMERA_BASE_URL: '',
			PERILUNE_CAMERA_SOURCE: '',
			PERILUNE_LIVE_MESH: 'false',
			PERILUNE_LIVE_CONFIGURATION: 'false'
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	children.push(child);
	child.stdout.on('data', (chunk) => (logs += chunk));
	child.stderr.on('data', (chunk) => (logs += chunk));
	for (let i = 0; ; i++) {
		try {
			if ((await fetch(base + '/health')).ok) break;
		} catch {}
		if (i > 100 || child.exitCode !== null) throw new Error(logs);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	await authenticate(context, base, filename);
	return { base, context };
}
try {
	browser = await chromium.launch({ headless: true });
	const sim = await start(4195);
	const page = await sim.context.newPage(),
		second = await sim.context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(sim.base + '/console');
	await second.goto(sim.base + '/console');
	assert.equal(await page.title(), 'Macros & console · Perilune');
	await page.getByRole('textbox', { name: 'Command', exact: true }).fill('M105');
	const submitted = page.waitForRequest(
		(request) => request.method() === 'POST' && request.url().includes('/_app/remote/')
	);
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/console-review-desktop.png' });
	await page.getByRole('button', { name: 'Send command' }).click();
	const command = await submitted;
	await page.getByText('Simulator · completed', { exact: true }).waitFor();
	await second.getByText('Simulator · completed', { exact: true }).waitFor();
	const replay = await sim.context.request.post(command.url(), {
		headers: { Origin: sim.base, 'Content-Type': command.headers()['content-type'] },
		data: command.postData()
	});
	assert.equal(replay.status(), 200);
	assert.equal(await page.locator('.log-entry').count(), 1, 'Retry uses the same command receipt');
	await page.getByRole('button', { name: 'Pin PERILUNE_STATUS', exact: true }).click();
	await second.getByRole('button', { name: 'Unpin PERILUNE_STATUS', exact: true }).waitFor();
	await page.getByRole('button', { name: 'Run SIMULATE_FAILURE', exact: true }).click();
	await page.getByText('Simulator · failed', { exact: true }).waitFor();
	await page.getByText('History display', { exact: true }).click();
	await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('errors');
	assert.equal(await page.locator('.log-entry').count(), 1);

	await page.getByRole('textbox', { name: 'Command', exact: true }).fill('HELP');
	await second.goto(sim.base + '/');
	await second.getByRole('button', { name: 'Disconnect', exact: true }).click();
	await page.getByText('Wait for a ready printer connection.', { exact: true }).waitFor();
	assert.equal(await page.getByRole('button', { name: 'Send command' }).isDisabled(), true);
	assert.equal(
		await page.getByRole('textbox', { name: 'Command', exact: true }).inputValue(),
		'HELP'
	);
	await second.getByRole('button', { name: 'Reconnect', exact: true }).click();
	await page.waitForFunction(
		() =>
			![...document.querySelectorAll('button')].find(
				(button) => button.textContent.trim() === 'Send command'
			)?.disabled
	);
	assert.equal(
		await page.getByRole('textbox', { name: 'Command', exact: true }).inputValue(),
		'HELP'
	);
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/console-desktop.png', fullPage: true });
	await page.setViewportSize({ width: 320, height: 800 });
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	await page.screenshot({ path: 'test-results/console-mobile.png', fullPage: true });
	const composer = page.getByRole('textbox', { name: 'Command', exact: true });
	await composer.fill('unfinished draft');
	await composer.press('ArrowUp');
	assert.equal(await composer.inputValue(), 'SIMULATE_FAILURE');
	await composer.press('ArrowDown');
	assert.equal(await composer.inputValue(), 'unfinished draft');
	await page.getByRole('button', { name: 'Run PERILUNE_STATUS', exact: true }).click();
	assert.equal(
		await page.getByRole('dialog').count(),
		0,
		'Macros submit without a redundant review dialog'
	);
	await page.screenshot({ path: 'test-results/console-submit-mobile.png' });
	assert.equal(await composer.inputValue(), 'unfinished draft');
	const invitation = await sim.context.request.post(sim.base + '/api/account/invite', {
		headers: { Origin: sim.base },
		data: { role: 'viewer' }
	});
	const { url } = await invitation.json();
	const viewer = await browser.newContext();
	const viewerPage = await viewer.newPage();
	await viewerPage.goto(url);
	await viewerPage.getByLabel('Your name').fill('Console viewer');
	await viewerPage.getByLabel('Email', { exact: true }).fill('console-viewer@example.test');
	await viewerPage.getByLabel('Password', { exact: true }).fill('fixture-viewer-password');
	await viewerPage.getByRole('button', { name: 'Create account', exact: true }).click();
	await viewerPage.getByRole('heading', { name: 'Welcome back' }).waitFor();
	const login = await viewer.request.post(sim.base + '/api/auth/sign-in/email', {
		headers: { Origin: sim.base },
		data: { email: 'console-viewer@example.test', password: 'fixture-viewer-password' }
	});
	assert.equal(login.status(), 200);
	await viewerPage.goto(sim.base + '/console');
	await viewerPage.getByRole('heading', { name: 'Operator access required' }).waitFor();
	assert.ok(!(await viewerPage.content()).includes('Deliberate simulator failure'));
	const forbidden = await viewer.request.post(command.url(), {
		headers: { Origin: sim.base, 'Content-Type': command.headers()['content-type'] },
		data: command.postData()
	});
	assert.equal((await forbidden.json()).error.status, 403);
	const csrf = await sim.context.request.post(command.url(), {
		headers: { Origin: 'https://evil.example', 'Content-Type': command.headers()['content-type'] },
		data: command.postData()
	});
	assert.equal(csrf.status(), 403);
	const live = await start(4196, true);
	const livePage = await live.context.newPage();
	livePage.on('pageerror', (error) => errors.push(error.message));
	await livePage.goto(live.base + '/console');
	await livePage.getByText('Fixture macro description', { exact: true }).waitFor();
	const privateText = '// fixture private macro output';
	sockets
		.at(-1)
		.send(
			JSON.stringify({ jsonrpc: '2.0', method: 'notify_gcode_response', params: [privateText] })
		);
	await livePage.getByText(privateText, { exact: true }).waitFor();
	for (const text of ['B:25 /0 T0:26 /0', 'B:26 /0 T0:27 /0'])
		sockets
			.at(-1)
			.send(JSON.stringify({ jsonrpc: '2.0', method: 'notify_gcode_response', params: [text] }));
	await livePage.getByText('Temperature updates · 2 messages').click();
	await livePage
		.locator('.response-group li')
		.getByText('B:25 /0 T0:26 /0', { exact: true })
		.waitFor();
	await livePage.getByText('History display', { exact: true }).click();
	await livePage.getByRole('checkbox', { name: 'Group repeated responses' }).uncheck();
	assert.equal(await livePage.locator('.response-group').count(), 0);
	assert.equal(
		await livePage.getByRole('button', { name: 'Run TEST_MACRO', exact: true }).isDisabled(),
		true
	);
	await livePage.getByRole('textbox', { name: 'Command', exact: true }).fill('G28');
	assert.equal(await livePage.getByRole('button', { name: 'Send command' }).isDisabled(), true);
	const publicPage = await live.context.newPage();
	await publicPage.goto(live.base + '/');
	assert.ok(!(await publicPage.content()).includes(privateText));
	assert.ok(!methods.includes('printer.gcode.script'));
	assert.equal(sockets.length, 1, 'Console and dashboard share one printer connection');
	assert.deepEqual(errors, []);
	console.log(
		'Console smoke passed: shared receipts, dedup, failure/filtering, per-account shortcuts, reconnect, viewer/CSRF gates, private live responses, one socket, no live execution and 320px layout.'
	);
} finally {
	await browser?.close();
	for (const child of children) child.kill('SIGTERM');
	await Promise.all(
		children.map(
			(child) =>
				new Promise((resolve) =>
					child.exitCode !== null ? resolve() : child.once('exit', resolve)
				)
		)
	);
	for (const socket of upstream.clients) socket.terminate();
	await new Promise((resolve) => upstream.close(resolve));
	await rm(directory, { recursive: true, force: true });
}
