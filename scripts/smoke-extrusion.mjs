import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { authenticate } from './smoke-auth-helper.mjs';
const directory = await mkdtemp(join(tmpdir(), 'perilune-extrusion-smoke-'));
const base = 'http://127.0.0.1:4189';
const server = spawn(process.execPath, ['scripts/server.mjs'], {
	env: {
		...process.env,
		HOST: '127.0.0.1',
		PORT: '4189',
		PERILUNE_ORIGIN: base,
		PERILUNE_DATABASE: join(directory, 'state.sqlite'),
		PERILUNE_MOONRAKER_URL: '',
		PERILUNE_MOONRAKER_API_KEY: '',
		PERILUNE_CAMERA_BASE_URL: '',
		PERILUNE_CAMERA_SOURCE: ''
	},
	stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '',
	browser,
	page;
server.stdout.on('data', (chunk) => (logs += chunk));
server.stderr.on('data', (chunk) => (logs += chunk));
try {
	for (let attempt = 0; ; attempt++) {
		try {
			if ((await fetch(base + '/health')).ok) break;
		} catch {}
		if (server.exitCode !== null || attempt > 100)
			throw new Error('Extrusion server failed: ' + logs);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 1440, height: 1000 },
		colorScheme: 'light'
	});
	await authenticate(context, base, join(directory, 'state.sqlite'));
	page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	// Prepare through the existing job flow, retaining its already-warm nozzle.
	await page.goto(base + '/calibration/mesh');
	await page.getByRole('button', { name: 'Probe bed…', exact: true }).click();
	await page.getByRole('button', { name: 'Stop current simulation…', exact: true }).click();
	await page.getByRole('checkbox', { name: /Cool.*nozzle/i }).uncheck();
	await page.getByRole('button', { name: 'Stop print', exact: true }).click();
	await page.goto(base + '/calibration/extrusion');
	await page.getByText('Printer idle', { exact: true }).waitFor();
	assert.equal(await page.title(), 'Filament & extrusion · Perilune');
	await page.getByRole('spinbutton', { name: 'Current rotation distance (mm)' }).fill('7.5');
	await page.getByRole('checkbox', { name: /Filament is loaded/ }).check();
	await page.getByRole('checkbox', { name: /nozzle has clearance/ }).check();
	await page.getByRole('button', { name: 'Extrude 50 mm · simulator' }).click();
	await page.getByText('Feeding the measured 50 mm · simulator', { exact: true }).waitFor();
	await page.goto(base + '/jobs');
	await page.goto(base + '/calibration/extrusion');
	await page
		.getByRole('spinbutton', { name: 'Remaining distance (mm)' })
		.waitFor({ timeout: 70_000 });
	await page.getByRole('spinbutton', { name: 'Remaining distance (mm)' }).fill('22');
	await page.getByRole('button', { name: 'Calculate proposal', exact: true }).click();
	await page.getByRole('heading', { name: '7.200 mm rotation distance' }).waitFor();
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export proposal' }).click();
	const download = await downloadPromise;
	assert.equal(download.suggestedFilename(), 'extrusion-proposal.cfg');
	const stream = await download.createReadStream();
	let text = '';
	for await (const chunk of stream) text += chunk;
	assert.match(text, /SIMULATOR EXAMPLE/);
	assert.match(text, /rotation_distance: 7.200/);
	await page.getByRole('button', { name: 'Finish measurement' }).click();
	await page
		.getByText('Measurement finished. The proposal remains unapplied.', { exact: true })
		.waitFor();
	await page.reload();
	await page.getByRole('heading', { name: '7.200 mm rotation distance' }).waitFor();
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/extrusion-desktop.png', fullPage: true });
	await page.setViewportSize({ width: 320, height: 800 });
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Extrusion fits320px'
	);
	await page.screenshot({ path: 'test-results/extrusion-mobile.png', fullPage: true });

	await page.getByRole('button', { name: 'Review in configuration' }).click();
	await page.getByRole('heading', { name: 'Review extrusion distance' }).waitFor();
	await page.getByRole('checkbox', { name: /repeated the measurement/ }).check();
	await page.getByRole('checkbox', { name: /reviewed included files/ }).check();
	await page.getByRole('button', { name: 'Add to this draft' }).click();
	await page.getByRole('button', { name: 'Review changes…' }).click();
	await page.getByRole('checkbox', { name: 'I reviewed the source changes.' }).check();
	await page.getByRole('button', { name: 'Save simulator file' }).click();
	const saved = await (
		await context.request.get(base + '/api/configuration?file=printer.cfg')
	).json();
	assert.ok(saved.text.includes('rotation_distance: 7.200'));
	assert.deepEqual(errors, []);
	console.log(
		'Extrusion smoke passed: preparation,50-second backend-owned run through navigation,manual measurement,unapplied export,cooldown,persistent proposal,and320px layout.'
	);
} catch (cause) {
	await mkdir('test-results', { recursive: true });
	await page?.screenshot({ path: 'test-results/extrusion-failure.png', fullPage: true });
	console.error(logs);
	throw cause;
} finally {
	await browser?.close();
	server.kill('SIGTERM');
	await new Promise((resolve) => server.once('exit', resolve));
	await rm(directory, { recursive: true, force: true });
}
