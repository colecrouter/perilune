import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import { authenticate } from './smoke-auth-helper.mjs';
const directory = await mkdtemp(join(tmpdir(), 'perilune-configuration-smoke-'));
const httpRequests = [];
let liveText =
	'# fixture-private-config\n[printer]\nmax_velocity: 200\n[extruder]\nrotation_distance: 7.5 # keep\ngear_ratio: 50:10\n';
let startupPolls = 0;
let startupError = false;
let configUploads = 0;
const upstream = createServer((request, response) => {
	httpRequests.push({
		url: request.url,
		method: request.method,
		key: request.headers['x-api-key']
	});
	if (request.url === '/server/files/upload') {
		void (async () => {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const parsed = await new Request('http://fixture.test', {
				method: 'POST',
				headers: { 'Content-Type': request.headers['content-type'] },
				body: new Blob(chunks)
			}).formData();
			assert.equal(parsed.get('root'), 'config');
			liveText = await parsed.get('file').text();
			configUploads++;
			response.setHeader('Content-Type', 'application/json');
			response.end(JSON.stringify({ result: { item: { root: 'config', path: 'printer.cfg' } } }));
		})().catch(() => {
			response.statusCode = 500;
			response.end('{}');
		});
	} else if (request.url === '/printer/restart') {
		startupPolls = 3;
		startupError = liveText.includes('bad:');
		response.end(JSON.stringify({ result: 'ok' }));
	} else if (request.url === '/server/info') {
		response.end(
			JSON.stringify({
				result: { klippy_state: startupPolls-- > 0 ? 'startup' : startupError ? 'error' : 'ready' }
			})
		);
	} else if (request.url === '/printer/info') {
		response.end(
			JSON.stringify({
				result: {
					state: startupPolls > 0 ? 'startup' : startupError ? 'error' : 'ready',
					state_message: startupError
						? "Option 'bad' is not valid in section 'printer'"
						: 'Printer is ready'
				}
			})
		);
	} else if (request.url?.startsWith('/printer/objects/query')) {
		response.end(
			JSON.stringify({
				result: {
					status: {
						print_stats: { state: 'standby' },
						idle_timeout: { state: 'Idle' },
						configfile: { save_config_pending: false },
						extruder: { target: 0 },
						heater_bed: { target: 0 }
					}
				}
			})
		);
	} else if (request.url === '/server/files/list?root=config') {
		response.setHeader('Content-Type', 'application/json');
		response.end(
			JSON.stringify({
				result: [{ path: 'printer.cfg', size: liveText.length, permissions: 'rw', modified: 1 }]
			})
		);
	} else if (request.url === '/server/files/config/printer.cfg') response.end(liveText);
	else {
		response.statusCode = 404;
		response.end();
	}
});
const sockets = new WebSocketServer({ server: upstream });
const methods = [];
sockets.on('connection', (socket) =>
	socket.on('message', (bytes) => {
		const request = JSON.parse(
			Buffer.isBuffer(bytes)
				? bytes.toString()
				: bytes instanceof ArrayBuffer
					? Buffer.from(bytes).toString()
					: Buffer.concat(bytes).toString()
		);
		methods.push(request.method);
		const results = {
			'server.connection.identify': {},
			'server.info': { klippy_state: 'ready' },
			'printer.objects.list': { objects: [] },
			'printer.objects.subscribe': { eventtime: 1, status: {} }
		};
		socket.send(
			JSON.stringify({ jsonrpc: '2.0', id: request.id, result: results[request.method] ?? {} })
		);
	})
);
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const upstreamPort = upstream.address().port;
const children = [];
let browser, page;
let logs = '';
// Read the real export rather than relying on CodeMirror's virtualized DOM lines.
async function readSource(target) {
	const pending = target.waitForEvent('download');
	await target.getByRole('button', { name: 'Export draft', exact: true }).click();
	const download = await pending;
	const source = await readFile(await download.path(), 'utf8');
	return source.replace(/\r?\n#\*#.*SAVE_CONFIG[\s\S]*$/, '').replace(/\r\n/g, '\n');
}
async function start(port, live, configuration = false) {
	const base = `http://127.0.0.1:${port}`;
	const filename = join(directory, `${port}.sqlite`);
	const child = spawn(process.execPath, ['scripts/server.mjs'], {
		env: {
			...process.env,
			HOST: '127.0.0.1',
			PORT: String(port),
			PERILUNE_ORIGIN: base,
			PERILUNE_DATABASE: filename,
			PERILUNE_MOONRAKER_URL: live ? `ws://127.0.0.1:${upstreamPort}/websocket` : '',
			PERILUNE_MOONRAKER_API_KEY: live ? 'fixture-private-key' : '',
			PERILUNE_LIVE_MESH: 'false',
			PERILUNE_LIVE_CONFIGURATION: String(configuration),
			PERILUNE_CAMERA_BASE_URL: '',
			PERILUNE_CAMERA_SOURCE: ''
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
		if (child.exitCode !== null || i > 100) throw new Error('Config server failed: ' + logs);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return { base, filename };
}
try {
	browser = await chromium.launch({ headless: true });
	const sim = await start(4192, false);
	const context = await browser.newContext({
		viewport: { width: 1440, height: 1000 },
		colorScheme: 'light'
	});
	await authenticate(context, sim.base, sim.filename);
	page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const outsider = await browser.newContext();
	assert.equal(
		(await outsider.request.get(sim.base + '/api/configuration', { maxRedirects: 0 })).status(),
		401
	);
	const referenceResponse = await outsider.request.get(sim.base + '/reference/klipper.json');
	assert.equal(referenceResponse.status(), 200);
	assert.ok(!/immutable|max-age=[1-9]/.test(referenceResponse.headers()['cache-control'] ?? ''));
	const reference = await referenceResponse.json();
	const artifact = JSON.parse(await readFile('build/prerendered/reference/klipper.json', 'utf8'));
	assert.deepEqual(
		reference,
		artifact,
		'Serves the build artifact without a runtime upstream fetch'
	);
	assert.equal(reference.schemaVersion, 1);
	assert.ok(reference.options.length > 500);
	assert.match(reference.source.revision, /^[a-f0-9]{40}$/);
	assert.ok(!JSON.stringify(reference).includes('fixture-private-config'));
	await outsider.close();
	const enroll = async (role) => {
		const invitation = await context.request.post(sim.base + '/api/account/invite', {
			headers: { Origin: sim.base },
			data: { role }
		});
		assert.equal(invitation.status(), 200);
		const { url } = await invitation.json();
		const account = await browser.newContext();
		const data = {
			token: new URL(url).hash.slice(1),
			name: `Fixture ${role}`,
			email: `${role}@example.test`,
			password: `fixture-${role}-password`
		};
		assert.equal(
			(
				await account.request.post(sim.base + '/api/account/enroll', {
					headers: { Origin: sim.base },
					data
				})
			).status(),
			200
		);
		assert.equal(
			(
				await account.request.post(sim.base + '/api/auth/sign-in/email', {
					headers: { Origin: sim.base },
					data: { email: data.email, password: data.password }
				})
			).status(),
			200
		);
		return account;
	};
	const operator = await enroll('operator');
	assert.equal((await operator.request.get(sim.base + '/api/configuration')).status(), 403);
	const denied = await operator.newPage();
	await denied.goto(sim.base + '/configuration');
	await denied.getByRole('heading', { name: 'Owner access required' }).waitFor();
	assert.ok(!(await denied.content()).includes('EXAMPLE_STATUS'));
	await page.goto(sim.base + '/configuration');
	await page.getByRole('spinbutton', { name: 'Maximum velocity', exact: true }).fill('180');
	await page.getByRole('button', { name: 'Raw source', exact: true }).click();
	await page.locator('.cm-content[contenteditable=true]').waitFor();
	const draft = await readSource(page);
	assert.match(draft, /max_velocity: 180 # mm\/s/);
	assert.ok(!draft.includes('SAVE_CONFIG'));
	await page.locator('summary').filter({ hasText: 'Find or add a setting' }).click();
	await page.getByRole('searchbox', { name: 'Find a setting' }).fill('max_z_velocity');
	await page.getByRole('button', { name: /max_z_velocity/ }).click();
	assert.equal(await page.getByRole('textbox', { name: 'Explicit value' }).inputValue(), '');
	assert.equal(await page.getByRole('button', { name: 'Add to draft' }).isDisabled(), true);
	await page.getByRole('textbox', { name: 'Explicit value' }).fill('12');
	assert.equal(await page.getByRole('button', { name: 'Add to draft' }).isDisabled(), true);
	await page.getByRole('checkbox', { name: /I checked included files/ }).check();
	await page.getByRole('button', { name: 'Add to draft' }).click();
	assert.match(await readSource(page), /max_z_velocity: 12/);
	assert.ok(
		!(
			await (await context.request.get(sim.base + '/api/configuration?file=printer.cfg')).json()
		).text.includes('max_z_velocity: 12'),
		'Addition stays a draft'
	);
	await page.setViewportSize({ width: 320, height: 800 });
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Reference browser fits320px'
	);
	await page.setViewportSize({ width: 1440, height: 1000 });
	// Restore the test draft before exercising the existing save/conflict flow.
	await page.getByRole('textbox', { name: 'Editable configuration source' }).fill(draft);
	await page.locator('summary').filter({ hasText: 'Find or add a setting' }).click();
	// Same-route links retain drafts for each file.
	await page
		.getByRole('navigation', { name: 'Configuration files' })
		.getByRole('link', { name: 'material-notes.yaml' })
		.click();
	await page.getByRole('heading', { name: 'material-notes.yaml', exact: true }).waitFor();
	await page
		.getByRole('navigation', { name: 'Configuration files' })
		.getByRole('link', { name: /printer.cfg/ })
		.click();
	await page.getByRole('heading', { name: 'printer.cfg', exact: true }).waitFor();
	assert.equal(await readSource(page), draft);
	// A file disappearing between listing and selection must not destroy another file's draft.
	const macros = await (
		await context.request.get(sim.base + '/api/configuration?file=macros.cfg')
	).json();
	const database = new DatabaseSync(sim.filename);
	database.prepare('DELETE FROM config_files WHERE path=?').run('macros.cfg');
	await page
		.getByRole('navigation', { name: 'Configuration files' })
		.getByRole('link', { name: 'macros.cfg', exact: true })
		.click();
	await page.getByRole('heading', { name: 'Could not open that file' }).waitFor();
	assert.equal(await readSource(page), draft, 'Failed navigation keeps the open draft');
	database
		.prepare('INSERT INTO config_files(path,text,version,updated_at) VALUES(?,?,?,?)')
		.run(macros.path, macros.text, macros.version, macros.updatedAt);
	database.close();
	await page
		.getByRole('navigation', { name: 'Configuration files' })
		.getByRole('link', { name: /printer.cfg/ })
		.click();
	await page
		.getByRole('heading', { name: 'Could not open that file' })
		.waitFor({ state: 'hidden' });
	assert.equal(await readSource(page), draft);
	const observer = await context.newPage();
	await observer.goto(sim.base + '/configuration');
	await page.getByRole('button', { name: 'Review changes…' }).click();
	await page.getByRole('checkbox', { name: 'I reviewed the source changes.' }).check();
	await page.getByRole('button', { name: 'Save simulator file' }).click();
	await page
		.getByText('Simulator file saved. Running printer settings were not changed.', { exact: true })
		.waitFor();
	const saved = await (
		await context.request.get(sim.base + '/api/configuration?file=printer.cfg')
	).json();
	assert.match(saved.text, /max_velocity: 180/);
	assert.match(saved.text, /#\*# z_offset = 1.200/);
	assert.equal(saved.backups.length, 1);
	await observer.getByRole('spinbutton', { name: 'Maximum velocity', exact: true }).fill('170');
	await observer.getByRole('button', { name: 'Review changes…' }).click();
	await observer.getByRole('checkbox', { name: 'I reviewed the source changes.' }).check();
	await observer.getByRole('button', { name: 'Save simulator file' }).click();
	await observer.getByRole('heading', { name: 'A newer saved file exists' }).waitFor();
	assert.equal(
		await observer.getByRole('spinbutton', { name: 'Maximum velocity', exact: true }).inputValue(),
		'170'
	);
	await page
		.getByRole('combobox', { name: 'Backup', exact: true })
		.selectOption(saved.backups[0].id);
	await page.getByRole('button', { name: 'Load backup into draft…' }).click();
	await page.getByRole('button', { name: 'Review changes…' }).click();
	await page.getByRole('checkbox', { name: 'I reviewed the source changes.' }).check();
	await page.getByRole('button', { name: 'Save simulator file' }).click();
	await page
		.getByText('Simulator file saved. Running printer settings were not changed.', { exact: true })
		.waitFor();
	assert.match(
		(await (await context.request.get(sim.base + '/api/configuration?file=printer.cfg')).json())
			.text,
		/max_velocity: 200/
	);
	const before = await readSource(page);
	await page
		.getByRole('textbox', { name: 'Editable configuration source' })
		.fill(before + '# my draft\n');
	await context.setOffline(true);
	await page.getByRole('button', { name: 'Check saved version' }).click();
	await page.getByRole('alert').waitFor();
	assert.equal(await readSource(page), before + '# my draft\n');
	await context.setOffline(false);
	await page.getByRole('button', { name: 'Check saved version' }).click();
	await page.getByText('Saved version checked.', { exact: true }).waitFor();
	await page.getByRole('alert').waitFor({ state: 'hidden' });
	assert.equal(
		(
			await context.request.post(sim.base + '/api/configuration', {
				headers: { Origin: 'https://example.invalid' },
				data: {
					id: crypto.randomUUID(),
					path: 'printer.cfg',
					expectedVersion: saved.version,
					text: saved.text
				}
			})
		).status(),
		403
	);
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/configuration-desktop.png', fullPage: true });
	await page.setViewportSize({ width: 320, height: 800 });
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Config fits320px'
	);
	await page.screenshot({ path: 'test-results/configuration-mobile.png', fullPage: true });
	assert.deepEqual(errors, []);
	const live = await start(4193, true);
	const liveContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	await authenticate(liveContext, live.base, live.filename);
	const livePage = await liveContext.newPage();
	await livePage.goto(live.base + '/configuration');
	await livePage.getByRole('button', { name: 'Raw source', exact: true }).click();
	await livePage.locator('.cm-content[contenteditable=true]').waitFor();
	assert.equal(await readSource(livePage), liveText);
	await livePage
		.getByRole('textbox', { name: 'Editable configuration source' })
		.fill(liveText.replace('200', '180'));
	await livePage.getByRole('button', { name: 'Review changes…' }).click();
	await livePage.getByRole('checkbox', { name: 'I reviewed the source changes.' }).check();
	const downloadPromise = livePage.waitForEvent('download');
	await livePage.getByRole('button', { name: 'Export reviewed draft' }).click();
	const download = await downloadPromise;
	assert.equal(download.suggestedFilename(), 'printer.cfg');
	const read = await (
		await liveContext.request.get(live.base + '/api/configuration?file=printer.cfg')
	).json();
	assert.equal(read.text, liveText);
	assert.equal(
		(
			await liveContext.request.post(live.base + '/api/configuration', {
				headers: { Origin: live.base },
				data: {
					id: crypto.randomUUID(),
					path: 'printer.cfg',
					expectedVersion: read.version,
					text: liveText + '# changed'
				}
			})
		).status(),
		409
	);

	// Carry a real manual calculator result through client navigation, stage a draft,
	// and export through the existing review without any printer write.
	const handoffPage = await liveContext.newPage();
	handoffPage.on('pageerror', (error) => errors.push(error.message));
	await handoffPage.goto(live.base + '/calibration/extrusion');
	await handoffPage.getByRole('spinbutton', { name: 'Current rotation distance (mm)' }).fill('7.5');
	await handoffPage.getByRole('spinbutton', { name: 'Remaining after 50 mm (mm)' }).fill('22');
	await handoffPage.getByRole('button', { name: 'Calculate proposal', exact: true }).click();
	await handoffPage.getByRole('button', { name: 'Review in configuration' }).click();
	await handoffPage.getByRole('heading', { name: 'Review extrusion distance' }).waitFor();
	await handoffPage.getByRole('spinbutton', { name: 'Maximum velocity', exact: true }).fill('180');
	await handoffPage.getByRole('checkbox', { name: /repeated the measurement/ }).check();
	await handoffPage.getByRole('button', { name: 'Add to this draft' }).click();
	assert.equal(
		await handoffPage
			.getByRole('spinbutton', { name: 'Extruder rotation distance', exact: true })
			.inputValue(),
		'7.200'
	);
	assert.equal(
		await handoffPage
			.getByRole('spinbutton', { name: 'Maximum velocity', exact: true })
			.inputValue(),
		'180'
	);
	await handoffPage.screenshot({
		path: 'test-results/calibration-config-desktop.png',
		fullPage: true
	});
	await handoffPage.getByRole('button', { name: 'Review changes…' }).click();
	await handoffPage.getByRole('checkbox', { name: 'I reviewed the source changes.' }).check();
	const proposalDownload = handoffPage.waitForEvent('download');
	await handoffPage.getByRole('button', { name: 'Export reviewed draft' }).click();
	const proposalText = await readFile(await (await proposalDownload).path(), 'utf8');
	assert.ok(proposalText.includes('rotation_distance: 7.200 # keep'));
	assert.ok(proposalText.includes('max_velocity: 180'));
	assert.ok(proposalText.includes('gear_ratio: 50:10'));
	await handoffPage.keyboard.press('Escape');
	await handoffPage.setViewportSize({ width: 320, height: 800 });
	assert.equal(
		await handoffPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false
	);
	await handoffPage.screenshot({
		path: 'test-results/calibration-config-mobile.png',
		fullPage: true
	});
	assert.equal(
		await (
			await liveContext.request.get(live.base + '/api/configuration?file=printer.cfg')
		)
			.json()
			.then((result) => result.text),
		liveText
	);
	handoffPage.on('dialog', (dialog) => dialog.accept());
	await handoffPage.reload();
	await handoffPage.getByRole('heading', { name: 'printer.cfg', exact: true }).waitFor();
	assert.equal(
		await handoffPage.getByRole('heading', { name: 'Review extrusion distance' }).count(),
		0,
		'Handoff is cleared on full reload'
	);
	assert.deepEqual(errors, []);
	const dashboard = await liveContext.newPage();
	await dashboard.goto(live.base + '/');
	assert.ok(!(await dashboard.content()).includes('fixture-private-config'));
	assert.ok(httpRequests.every((r) => r.method === 'GET' && r.key === 'fixture-private-key'));
	assert.ok(!methods.includes('printer.gcode.script'));
	// Exercise the opt-in write/restart path only against the local protocol fixture.
	const recoveryApp = await start(4194, true, true);
	const recoveryContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	await authenticate(recoveryContext, recoveryApp.base, recoveryApp.filename);
	const recoveryPage = await recoveryContext.newPage();
	await recoveryPage.goto(recoveryApp.base + '/configuration');
	await recoveryPage.getByRole('button', { name: 'Raw source', exact: true }).click();
	await recoveryPage.locator('.cm-content[contenteditable=true]').waitFor();
	const originalText = liveText;
	await recoveryPage
		.getByRole('textbox', { name: 'Editable configuration source' })
		.fill(liveText + 'bad: 1\n');
	await recoveryPage.getByRole('button', { name: 'Review changes…' }).click();
	await recoveryPage.getByRole('checkbox', { name: 'I reviewed the source changes.' }).check();
	await recoveryPage.getByRole('checkbox', { name: /Restart Klipper after saving/ }).check();
	await recoveryPage.getByRole('button', { name: 'Apply and restart Klipper' }).click();
	await recoveryPage.getByLabel('Klipper startup diagnostic').waitFor({ timeout: 15000 });
	assert.match(
		await recoveryPage.getByLabel('Klipper startup diagnostic').textContent(),
		/Option 'bad'/
	);
	assert.equal(configUploads, 1);
	await recoveryPage.reload();
	await recoveryPage.getByLabel('Klipper startup diagnostic').waitFor();
	const latest = await (
		await recoveryContext.request.get(recoveryApp.base + '/api/configuration/application')
	).json();
	assert.equal(latest.application.phase, 'error');
	const anonymous = await browser.newContext();
	assert.equal(
		(await anonymous.request.get(recoveryApp.base + '/api/configuration/application')).status(),
		401
	);
	await anonymous.close();
	const snapshot = await recoveryContext.request.get(
		recoveryApp.base +
			'/api/configuration/application?snapshot=' +
			latest.application.id +
			'&side=before'
	);
	assert.equal(await snapshot.text(), originalText);
	await recoveryPage.goto(recoveryApp.base + '/');
	await recoveryPage.getByRole('heading', { name: 'Configuration needs attention' }).waitFor();
	await recoveryPage.getByRole('link', { name: 'Open configuration recovery →' }).click();
	await recoveryPage
		.getByRole('checkbox', { name: /Restore the snapshot and restart Klipper/ })
		.check();
	await recoveryPage.getByRole('button', { name: 'Revert changes and restart' }).click();
	await recoveryPage
		.getByRole('heading', { name: 'Configuration startup verified' })
		.waitFor({ timeout: 15000 });
	assert.equal(liveText, originalText);
	assert.equal(configUploads, 2);
	await recoveryPage.setViewportSize({ width: 320, height: 800 });
	assert.equal(
		await recoveryPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Recovery fits320px'
	);
	console.log(
		'Configuration smoke passed: owner-only SSR/API, guided/raw edits, per-file drafts, reviewed saves, protected tail, conflicts, backup restore, offline draft preservation,CSRF,320px layout,and live read/draft/export with no writes or config leakage to dashboard.'
	);
} catch (cause) {
	await mkdir('test-results', { recursive: true });
	await page?.screenshot({ path: 'test-results/configuration-failure.png', fullPage: true });
	console.error(logs);
	throw cause;
} finally {
	await browser?.close();
	for (const child of children) {
		child.kill('SIGTERM');
		await new Promise((resolve) => child.once('exit', resolve));
	}
	for (const socket of sockets.clients) socket.terminate();
	await new Promise((resolve) => sockets.close(resolve));
	upstream.closeAllConnections();
	await new Promise((resolve) => upstream.close(resolve));
	await rm(directory, { recursive: true, force: true });
}
