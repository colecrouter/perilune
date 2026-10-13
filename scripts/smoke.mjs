import { authenticate } from './smoke-auth-helper.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const directory = await mkdtemp(join(tmpdir(), 'perilune-smoke-'));
const port = process.env.PERILUNE_TEST_PORT ?? '4179';
const base = process.env.PERILUNE_SMOKE_URL ?? `http://127.0.0.1:${port}`;
const server = process.env.PERILUNE_SMOKE_URL
	? undefined
	: spawn(process.execPath, ['scripts/server.mjs'], {
			env: {
				...process.env,
				HOST: '127.0.0.1',
				PORT: port,
				PERILUNE_ORIGIN: base,
				PERILUNE_DATABASE: join(directory, 'state.sqlite'),
				PERILUNE_MOONRAKER_URL: '',
				PERILUNE_MOONRAKER_API_KEY: '',
				PERILUNE_CAMERA_BASE_URL: '',
				PERILUNE_CAMERA_SOURCE: ''
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});
let logs = '';
server?.stdout.on('data', (chunk) => {
	logs += chunk;
});
server?.stderr.on('data', (chunk) => {
	logs += chunk;
});
let browser;
let failurePage;
try {
	for (let attempt = 0; ; attempt++) {
		try {
			const response = await fetch(`${base}/health`);
			if (response.ok) break;
		} catch {
			/* waiting for startup */
		}
		if ((server && server.exitCode !== null) || attempt > 100)
			throw new Error(`Server failed to start: ${logs}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 1505, height: 1045 },
		colorScheme: 'light'
	});
	await authenticate(context, base, join(directory, 'state.sqlite'));
	const first = await context.newPage();
	failurePage = first;
	first.setDefaultTimeout(5000);
	const errors = [];
	first.on('pageerror', (error) => errors.push(error.message));
	await first.goto(base);
	await first.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
	await first.waitForFunction(
		() => document.body.innerText.includes('Updates') && document.body.innerText.includes('Live')
	);
	await first.evaluate(() => document.fonts.ready);
	await mkdir('test-results', { recursive: true });
	await first.screenshot({ path: 'test-results/overview-serif.png', fullPage: true });
	await first.getByRole('switch', { name: 'Serif headings' }).click();
	await first.screenshot({ path: 'test-results/overview-sans.png', fullPage: true });
	await first.getByRole('switch', { name: 'Serif headings' }).click();
	const second = await context.newPage();
	await second.goto(base);
	await second.getByRole('button', { name: 'Pause print', exact: true }).waitFor();
	await first.getByRole('spinbutton', { name: 'Nozzle target' }).fill('225');
	await first.getByRole('button', { name: 'Disconnect', exact: true }).click();
	await second.getByText('Printer disconnected', { exact: true }).waitFor();
	assert.equal(await first.getByRole('spinbutton', { name: 'Nozzle target' }).inputValue(), '225');
	await first.locator('.heater').first().getByRole('button', { name: 'Set', exact: true }).click();
	await first.getByText('queued', { exact: true }).waitFor();
	await first.getByRole('button', { name: 'Reconnect', exact: true }).click();
	await second.getByText('Target 225°C', { exact: true }).waitFor();
	await first.getByRole('button', { name: 'Pause print', exact: true }).click();
	await second.getByRole('button', { name: 'Resume print', exact: true }).waitFor();
	await first.getByRole('button', { name: 'Stop print', exact: true }).click();
	await first.getByRole('dialog').waitFor();
	await first.getByRole('checkbox', { name: 'Cool down bed', exact: true }).uncheck();
	await first.screenshot({ path: 'test-results/stop-print.png', fullPage: true });
	await first.getByRole('dialog').getByRole('button', { name: 'Stop print', exact: true }).click();
	await second.getByText('cancelled', { exact: true }).waitFor();
	await second.getByText('Target 0°C', { exact: true }).waitFor();
	await second.getByText('Target 60°C', { exact: true }).waitFor();
	await first.goto(`${base}/controls`);
	await second.goto(`${base}/controls`);
	assert.equal(await first.title(), 'Printer controls · Perilune');
	await first.locator('.bed-map').click();
	assert.equal(
		await first.getByRole('button', { name: 'Move here', exact: true }).isEnabled(),
		true
	);
	await first.locator('.position-strip').getByText('110.00 mm', { exact: true }).first().waitFor();
	await first.getByRole('spinbutton', { name: 'X (mm)', exact: true }).fill('30');
	await first.getByRole('spinbutton', { name: 'Y (mm)', exact: true }).fill('40');
	await first.getByRole('button', { name: 'Move here', exact: true }).click();
	await second.locator('.position-strip').getByText('30.00 mm', { exact: true }).waitFor();
	await second.getByRole('spinbutton', { name: 'X (mm)', exact: true }).fill('75');
	await first.getByRole('button', { name: 'X minimum (0)', exact: true }).click();
	await second.getByText('The printer moved after this preview.', { exact: false }).waitFor();
	assert.equal(
		await second.getByRole('button', { name: 'Move here', exact: true }).isDisabled(),
		true
	);
	assert.equal(
		await second.getByRole('spinbutton', { name: 'X (mm)', exact: true }).inputValue(),
		'75'
	);
	await first.locator('.position-strip').getByText('0.00 mm', { exact: true }).waitFor();
	await first.locator('.position-strip').getByText('40.00 mm', { exact: true }).waitFor();
	await first.getByRole('spinbutton', { name: 'X (mm)', exact: true }).fill('2');
	await first.getByRole('button', { name: 'Move here', exact: true }).click();
	await first.locator('.position-strip').getByText('2.00 mm', { exact: true }).waitFor();
	await first.getByRole('combobox', { name: /^Step/ }).selectOption('10');
	await first.getByRole('button', { name: 'X −', exact: true }).click();
	await first.locator('.position-strip').getByText('0.00 mm', { exact: true }).waitFor();
	await first.getByRole('spinbutton', { name: 'Z (mm)', exact: true }).fill('0');
	assert.equal(
		await first.getByRole('button', { name: 'Move here', exact: true }).isDisabled(),
		true
	);
	await first.getByRole('checkbox', { name: 'I checked bed clearance before lowering' }).check();
	await first.getByRole('button', { name: 'Move here', exact: true }).click();
	await first
		.locator('.position-strip > div')
		.nth(2)
		.getByText('0.00 mm', { exact: true })
		.waitFor();
	await first
		.getByRole('region', { name: 'Recent movement', exact: true })
		.getByText('completed', { exact: true })
		.first()
		.waitFor();
	await first.getByRole('button', { name: 'Disengage motors', exact: true }).click();
	await first.getByRole('button', { name: 'Confirm release', exact: true }).click();
	await first.locator('.position-strip').getByText('Unknown mm', { exact: true }).first().waitFor();
	assert.equal(
		await first.getByRole('button', { name: 'Move here', exact: true }).isDisabled(),
		true
	);
	await first.getByRole('button', { name: 'Home All', exact: true }).click();
	await first
		.locator('.position-strip > div')
		.nth(2)
		.getByText('0.00 mm', { exact: true })
		.waitFor();
	await first.screenshot({ path: 'test-results/controls-desktop.png', fullPage: true });
	await first.setViewportSize({ width: 320, height: 844 });
	await first.screenshot({ path: 'test-results/controls-mobile.png', fullPage: true });
	assert.equal(
		await first.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Controls fit 320px'
	);
	await first.goto(base);
	await first.setViewportSize({ width: 1505, height: 1045 });
	await first.getByRole('button', { name: 'Reset demo', exact: true }).click();
	await first
		.getByRole('button', { name: 'Pause print', exact: true })
		.waitFor({ state: 'visible' });
	await first.setViewportSize({ width: 390, height: 844 });
	await first.screenshot({ path: 'test-results/overview-mobile.png', fullPage: true });
	assert.equal(
		await first.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Mobile layout overflows'
	);
	await first.emulateMedia({ colorScheme: 'dark' });
	await first.screenshot({ path: 'test-results/overview-mobile-dark.png', fullPage: true });
	await first.getByRole('link', { name: 'Calibration', exact: true }).click();
	await first.getByRole('heading', { name: 'Building Perilune', exact: true }).waitFor();
	assert.deepEqual(errors, [], 'Production browser errors');
	const polyfills = await fetch(`${base}/legacy-polyfills.js`);
	assert.equal(polyfills.status, 200, 'Polyfills are served');
	assert.ok(
		!polyfills.headers.get('cache-control')?.includes('immutable'),
		'Stable polyfills must remain revalidatable'
	);
	console.log(
		'Production smoke passed: shared state, queue, reconnect, draft preservation, cooldown, responsive layout, typography, hydration.'
	);
} catch (error) {
	await failurePage?.screenshot({ path: 'test-results/smoke-failure.png', fullPage: true });
	console.error(
		await failurePage?.evaluate(() =>
			[...document.querySelectorAll('*')]
				.map((el) => ({
					tag: el.tagName,
					class: el.className,
					width: el.getBoundingClientRect().width,
					right: el.getBoundingClientRect().right
				}))
				.filter((el) => el.right > innerWidth + 1)
				.slice(-20)
		)
	);
	console.error(
		await failurePage
			?.locator('.dialog-content')
			.innerHTML()
			.catch(() => 'No dialog')
	);
	throw error;
} finally {
	await browser?.close();
	server?.kill('SIGTERM');
	await new Promise((resolve) => {
		if (!server || server.exitCode !== null) resolve();
		else server.once('exit', resolve);
	});
	await rm(directory, { recursive: true, force: true });
}
