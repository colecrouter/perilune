import { appRequest, remoteArgument } from './smoke-remote-helper.mjs';
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
				PERILUNE_CAMERA_COMPANION_URL: ''
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

	const publicContext = await browser.newContext();
	for (const path of [
		'/manifest.webmanifest',
		'/service-worker.js',
		'/icons/app-180.png',
		'/icons/maskable-512.png',
		'/icons/monochrome.svg'
	]) {
		const response = await appRequest(publicContext.request, 'GET', `${base}${path}`);
		assert.equal(response.status(), 200, `${path} is public install metadata`);
		assert.ok(!response.headers()['cache-control']?.includes('immutable'));
	}
	assert.equal(
		(await appRequest(publicContext.request, 'GET', `${base}/api/notifications`)).status(),
		401
	);
	assert.equal(
		(await appRequest(publicContext.request, 'GET', `${base}/api/preferences`)).status(),
		401
	);
	await publicContext.close();
	await authenticate(context, base, join(directory, 'state.sqlite'));
	const first = await context.newPage();
	const heldStatusRequests = new Set();
	// A full document replacement invalidates that document's network handles;
	// Playwright may omit terminal events for its abandoned live responses.
	// SPA navigation does not send a main-frame document request, so the leak
	// assertions below still require unused streams to close within the document.
	first.on('request', (request) => {
		if (request.isNavigationRequest() && request.frame() === first.mainFrame())
			heldStatusRequests.clear();
	});
	first.on('request', (request) => {
		if (request.url().includes('/getDashboard') || request.url().includes('/getPrinter'))
			heldStatusRequests.add(request);
	});
	first.on('requestfinished', (request) => heldStatusRequests.delete(request));
	first.on('requestfailed', (request) => heldStatusRequests.delete(request));
	failurePage = first;
	first.setDefaultTimeout(5000);
	const errors = [];
	first.on('pageerror', (error) => errors.push(error.message));
	await first.goto(base);
	await first.evaluate(async () => {
		const registration = await navigator.serviceWorker.ready;
		if (!registration.active) throw new Error('Service worker did not activate');
		for (const key of await caches.keys()) {
			const cache = await caches.open(key);
			const entries = await cache.keys();
			if (entries.length)
				throw new Error(`Unexpected cache ${key}: ${entries.map((x) => x.url).join(', ')}`);
		}
	});

	const worker = context.serviceWorkers()[0];
	assert.ok(worker, 'Production worker exists');
	const notice = await worker.evaluate(async () => {
		const original = self.registration.showNotification;
		let captured;
		self.registration.showNotification = async (title, options) => {
			captured = { title, ...options };
		};
		try {
			const event = new PushEvent('push', {
				data: JSON.stringify({
					id: 'fixture-event',
					title: 'Fixture signal',
					body: 'A print finished.'
				})
			});
			const pending = [];
			event.waitUntil = (promise) => pending.push(promise);
			self.dispatchEvent(event);
			await Promise.all(pending);
			return captured;
		} finally {
			self.registration.showNotification = original;
		}
	});
	assert.equal(
		notice?.title,
		'Fixture signal',
		'The worker actually handles push, rather than a polyfill overwriting it'
	);
	assert.equal(notice?.tag, 'fixture-event');
	await first.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
	await first.waitForFunction(() =>
		document.querySelector('link[rel="icon"]')?.href.startsWith('data:image/png')
	);
	assert.equal(await first.locator('link[rel="icon"]').count(), 1);
	const printingIcon = await first.locator('link[rel="icon"]').getAttribute('href');
	await first.waitForFunction(() =>
		document.querySelector('.connection-status')?.textContent.includes('Connected')
	);
	await first.evaluate(() => document.fonts.ready);
	await first
		.getByRole('slider', { name: /All sensor temperatures over/ })
		.waitFor({ timeout: 10000 });
	await mkdir('test-results', { recursive: true });
	await first.screenshot({ path: 'test-results/overview-serif.png', fullPage: true });
	await first.goto(base + '/account?section=preferences');
	const sansSaved = first.waitForResponse(
		(r) => r.url().includes('/savePreferences') && r.request().method() === 'POST' && r.ok()
	);
	await first.getByRole('checkbox', { name: 'Serif headings', exact: true }).uncheck();
	await sansSaved;
	await first.goto(base);
	await first.waitForFunction(() =>
		getComputedStyle(document.querySelector('h1')).fontFamily.includes('Inter')
	);
	await first.screenshot({ path: 'test-results/overview-sans.png', fullPage: true });
	assert.equal(
		(await (await appRequest(context.request, 'GET', base + '/api/preferences')).json()).preferences
			.serif,
		false
	);
	assert.equal(
		(
			await appRequest(context.request, 'PATCH', base + '/api/preferences', {
				headers: { Origin: base },
				data: { owner: 'another-account', serif: true }
			})
		).status(),
		400
	);
	assert.equal(
		(
			await appRequest(context.request, 'PATCH', base + '/api/preferences', {
				headers: { Origin: 'https://foreign.invalid' },
				data: { serif: true }
			})
		).status(),
		403
	);
	await first.goto(base + '/account?section=preferences');
	const saved = first.waitForResponse(
		(r) => r.url().includes('/savePreferences') && r.request().method() === 'POST' && r.ok()
	);
	await first.getByRole('checkbox', { name: 'Serif headings', exact: true }).check();
	await saved;
	await first.goto(base);
	// Empty libraries prioritize upload; table preferences belong to a populated library.
	await first.goto(base + '/jobs');
	assert.equal(await first.locator('details.columns').count(), 0);
	await first.getByLabel('Upload G-code', { exact: true }).setInputFiles({
		name: 'column-preferences.gcode',
		mimeType: 'application/octet-stream',
		buffer: Buffer.from('; generated by fixture\nG28\n')
	});
	await first.getByRole('heading', { name: 'column-preferences.gcode', exact: true }).waitFor();
	await first.goto(base + '/jobs');
	// Two stale tabs changing different columns must send only the changed field.
	const columnsTab = await context.newPage();
	await columnsTab.goto(base + '/jobs');
	await first.locator('details.columns summary').click();
	const durationSaved = first.waitForResponse(
		(r) => r.url().includes('/savePreferences') && r.request().method() === 'POST' && r.ok()
	);
	await first.getByRole('checkbox', { name: 'Est. time', exact: true }).uncheck();
	assert.deepEqual(remoteArgument((await durationSaved).request()), { jobsDuration: false });
	await columnsTab.locator('details.columns summary').click();
	const sizeSaved = columnsTab.waitForResponse(
		(r) => r.url().includes('/savePreferences') && r.request().method() === 'POST' && r.ok()
	);
	await columnsTab.getByRole('checkbox', { name: 'Size', exact: true }).uncheck();
	assert.deepEqual(remoteArgument((await sizeSaved).request()), { jobsSize: false });
	await first.reload();
	await first.locator('details.columns summary').click();
	assert.equal(
		await first.getByRole('checkbox', { name: 'Est. time', exact: true }).isChecked(),
		false
	);
	assert.equal(await first.getByRole('checkbox', { name: 'Size', exact: true }).isChecked(), false);
	await appRequest(context.request, 'PATCH', base + '/api/preferences', {
		headers: { Origin: base },
		data: { jobsDuration: true, jobsSize: true }
	});
	await columnsTab.close();
	await first.goto(base);

	const second = await context.newPage();
	await second.goto(base);
	await second.getByRole('button', { name: 'Pause print', exact: true }).waitFor();
	await first.getByRole('spinbutton', { name: 'Nozzle target' }).fill('225');
	await first.getByRole('button', { name: 'Disconnect', exact: true }).click();
	await second.getByText('Printer disconnected', { exact: true }).waitFor();
	await first.waitForFunction(
		(before) => document.querySelector('link[rel="icon"]')?.href !== before,
		printingIcon
	);
	assert.equal(await first.getByRole('spinbutton', { name: 'Nozzle target' }).inputValue(), '225');
	assert.equal(
		await first
			.locator('.heater')
			.first()
			.getByRole('button', { name: 'Pending…', exact: true })
			.isDisabled(),
		true
	);
	await first.getByRole('button', { name: 'Reconnect', exact: true }).click();
	await first.locator('.heater').first().getByRole('button', { name: 'Set', exact: true }).click();

	await second.getByText('Target 225°C', { exact: true }).waitFor();
	await first.waitForFunction(
		(before) => document.querySelector('link[rel="icon"]')?.href === before,
		printingIcon
	);
	await first.getByRole('button', { name: 'Pause print', exact: true }).click();
	await second.getByRole('button', { name: 'Resume print', exact: true }).waitFor();
	await second.goto(base + '/account');
	await second
		.getByRole('region', { name: 'Print status', exact: true })
		.getByRole('button', { name: 'Resume print', exact: true })
		.click();
	await first.getByRole('button', { name: 'Pause print', exact: true }).waitFor();
	await second.getByRole('button', { name: 'Pause print', exact: true }).click();
	await first.getByRole('button', { name: 'Resume print', exact: true }).waitFor();
	await first.waitForFunction(
		(before) => document.querySelector('link[rel="icon"]')?.href !== before,
		printingIcon
	);
	// A response lost before admission must survive a full document navigation.
	let lostPrintRequest;
	await second.route('**/actions', async (route) => {
		if (route.request().method() === 'POST') {
			lostPrintRequest = route.request();
			await route.abort('failed');
		} else await route.continue();
	});
	await second.getByRole('button', { name: 'Resume print', exact: true }).click();
	await second.getByRole('link', { name: 'Review print submission →', exact: true }).waitFor();
	assert.ok(lostPrintRequest);
	const lostId = new URLSearchParams(lostPrintRequest.postData()).get('id');
	await second.unroute('**/actions');
	await second.goto(base + '/console');
	await second.getByRole('link', { name: 'Review print submission →', exact: true }).waitFor();
	assert.equal(
		await second.getByRole('button', { name: 'Resume print', exact: true }).isDisabled(),
		true
	);
	await second
		.getByRole('link', { name: 'View print receipt', exact: true })
		.getAttribute('href')
		.then((href) => assert.equal(href, '/actions/' + lostId));
	await second.getByRole('button', { name: 'Check receipt', exact: true }).click();
	await second.waitForFunction(() =>
		[...document.querySelectorAll('button')].some(
			(b) => b.textContent?.trim() === 'Resume print' && !b.disabled
		)
	);
	const late = await context.request.post(base + '/actions', {
		headers: {
			Origin: base,
			'Content-Type': 'application/x-www-form-urlencoded',
			'x-sveltekit-action': 'true'
		},
		data: lostPrintRequest.postData()
	});
	assert.equal((await late.json()).type, 'failure', 'Closed request IDs cannot be admitted later');
	const stopHref = await first
		.getByRole('button', { name: 'Stop print', exact: true })
		.getAttribute('href');
	await second.goto(base + stopHref);
	await second.getByRole('checkbox', { name: 'Stop the displayed print' }).check();
	let lostConfirmation;
	await second.route('**/actions', async (route) => {
		if (route.request().method() === 'POST') {
			lostConfirmation = route.request();
			await route.abort('failed');
		} else await route.continue();
	});
	await second.getByRole('button', { name: 'Stop print', exact: true }).click();
	await second.getByRole('link', { name: 'Review print submission →', exact: true }).waitFor();
	const confirmationId = new URLSearchParams(lostConfirmation.postData()).get('id');
	await second.unroute('**/actions');
	await second.goto(base + '/account');
	await second
		.getByRole('link', { name: 'View print receipt', exact: true })
		.getAttribute('href')
		.then((href) => assert.equal(href, '/actions/' + confirmationId));
	await second.getByRole('button', { name: 'Check receipt', exact: true }).click();
	await second.waitForFunction(() =>
		[...document.querySelectorAll('button')].some(
			(b) => b.textContent?.trim() === 'Resume print' && !b.disabled
		)
	);

	await first.getByRole('button', { name: 'Stop print', exact: true }).click();
	await first.getByRole('dialog').waitFor();
	await first.getByRole('checkbox', { name: 'Cool down bed', exact: true }).uncheck();
	await first.screenshot({ path: 'test-results/stop-print.png', fullPage: true });
	await first.getByRole('dialog').getByRole('button', { name: 'Stop print', exact: true }).click();
	await second
		.getByRole('region', { name: 'Print status', exact: true })
		.waitFor({ state: 'detached' });
	await second.goto(base);
	await second.getByRole('heading', { name: 'Print stopped', exact: true }).waitFor();
	await first.waitForFunction(
		() => !document.querySelector('link[rel="icon"]')?.href.startsWith('data:')
	);
	await second.getByText('Target 0°C', { exact: true }).waitFor();
	await second.getByText('Target 60°C', { exact: true }).waitFor();
	await first.getByRole('button', { name: 'Cool down nozzle & bed', exact: true }).click();
	await second
		.locator('.heater')
		.filter({ hasText: 'Bed' })
		.getByText('Target 0°C', { exact: true })
		.waitFor();
	await first.getByRole('combobox', { name: 'Window', exact: true }).selectOption('5');
	await first
		.getByRole('slider', { name: /All sensor temperatures over the last 5 minutes/ })
		.waitFor();
	await first.screenshot({ path: 'test-results/temperature-desktop.png', fullPage: true });
	await first.setViewportSize({ width: 320, height: 844 });
	await first.screenshot({ path: 'test-results/temperature-mobile.png', fullPage: true });
	assert.equal(
		await first.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Temperature charts fit 320px'
	);
	await first.setViewportSize({ width: 1505, height: 1045 });

	// Layout changes preserve mounted heater inputs and apply only after Save.
	const targetDraft = first.getByRole('spinbutton', { name: 'Nozzle target', exact: true });
	await targetDraft.fill('185');
	await first.getByRole('button', { name: 'Customize', exact: true }).click();
	let customize = first.getByRole('dialog', { name: 'Customize Overview' });
	await customize.getByRole('button', { name: 'Compact', exact: true }).click();
	await customize.getByRole('button', { name: 'Cancel', exact: true }).click();
	assert.equal(await first.locator('[data-overview-panel="camera"]').isVisible(), true);
	await first.getByRole('button', { name: 'Customize', exact: true }).click();
	await customize.getByRole('button', { name: 'Compact', exact: true }).click();
	await customize.getByRole('button', { name: 'Move Temperature controls & sensors up' }).click();
	await customize
		.getByRole('checkbox', { name: 'Temperature controls & sensors', exact: true })
		.uncheck();
	await customize.getByRole('button', { name: 'Save layout', exact: true }).click();
	await customize.waitFor({ state: 'hidden' });
	assert.equal(await first.locator('[data-overview-panel="camera"]').isVisible(), false);
	assert.equal(await first.locator('[data-overview-panel="temperature"]').isVisible(), false);
	assert.equal(await first.locator('[data-overview-panel="history"]').isVisible(), false);
	await first.locator('.thermal-glance a').first().click();
	assert.equal(
		await targetDraft.inputValue(),
		'185',
		'Hidden/reordered heater retains unsent target'
	);
	await second.reload();
	await second.getByRole('button', { name: 'Customize', exact: true }).waitFor();
	assert.equal(
		await second.locator('[data-overview-panel="camera"]').isVisible(),
		false,
		'Account layout survives a full document load'
	);
	await first.getByRole('button', { name: 'Customize', exact: true }).click();
	await customize.getByRole('button', { name: 'Camera focus', exact: true }).click();
	await customize.getByRole('button', { name: 'Save layout', exact: true }).click();
	await customize.waitFor({ state: 'hidden' });
	await first.screenshot({ path: 'test-results/overview-camera-focus.png', fullPage: true });
	await first.setViewportSize({ width: 320, height: 844 });
	// Chart dimensions update through ResizeObserver after the viewport changes.
	await first.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
	await first.getByRole('button', { name: 'Customize', exact: true }).click();
	assert.equal(
		await first.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Customizer fits 320px'
	);
	await first.screenshot({ path: 'test-results/overview-customize-mobile.png', fullPage: true });
	await customize.getByRole('button', { name: 'Reset to default', exact: true }).click();
	await customize.getByRole('button', { name: 'Save layout', exact: true }).click();
	await customize.waitFor({ state: 'hidden' });
	assert.equal(await targetDraft.inputValue(), '185');
	await first.setViewportSize({ width: 1505, height: 1045 });
	await second.reload();

	await first.getByRole('link', { name: 'Controls', exact: true }).click();
	await first.getByRole('heading', { name: 'Printer controls', exact: true }).waitFor();
	assert.equal(await first.locator('link[rel="icon"]').count(), 1);
	const protocol = await context.newCDPSession(first);
	await protocol.send('HeapProfiler.collectGarbage');
	const streamDeadline = Date.now() + 5000;
	while (heldStatusRequests.size !== 1 && Date.now() < streamDeadline) {
		await new Promise((resolve) => setTimeout(resolve, 50));
		await protocol.send('HeapProfiler.collectGarbage');
	}
	assert.equal(heldStatusRequests.size, 1, 'One printer-only stream after navigating to Controls');
	assert.ok(
		[...heldStatusRequests][0].url().includes('/getPrinter'),
		'Controls does not subscribe to camera updates'
	);

	await first.getByRole('link', { name: 'Overview', exact: true }).click();
	await first.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
	await protocol.send('HeapProfiler.collectGarbage');
	for (
		let i = 0;
		i < 100 &&
		(heldStatusRequests.size !== 1 || ![...heldStatusRequests][0].url().includes('/getDashboard'));
		i++
	) {
		await new Promise((resolve) => setTimeout(resolve, 50));
		await protocol.send('HeapProfiler.collectGarbage');
	}
	assert.equal(heldStatusRequests.size, 1, 'SPA roundtrip releases unused printer stream');
	assert.ok([...heldStatusRequests][0].url().includes('/getDashboard'));
	await first.getByRole('link', { name: 'Controls', exact: true }).click();
	await first.getByRole('heading', { name: 'Printer controls', exact: true }).waitFor();
	await protocol.send('HeapProfiler.collectGarbage');
	for (
		let i = 0;
		i < 100 &&
		(heldStatusRequests.size !== 1 || ![...heldStatusRequests][0].url().includes('/getPrinter'));
		i++
	) {
		await new Promise((resolve) => setTimeout(resolve, 50));
		await protocol.send('HeapProfiler.collectGarbage');
	}
	assert.equal(heldStatusRequests.size, 1, 'SPA roundtrip releases unused dashboard stream');
	assert.ok([...heldStatusRequests][0].url().includes('/getPrinter'));
	await protocol.detach();
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
	await first.getByRole('spinbutton', { name: 'X (mm)', exact: true }).fill('0');
	await first.getByRole('button', { name: 'Move here', exact: true }).click();
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
	await first.getByRole('radio', { name: '10 mm', exact: true }).check();
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
		.getByText('Command completed', { exact: true })
		.first()
		.waitFor();
	await first.getByRole('button', { name: 'Disengage motors', exact: true }).click();
	await first
		.getByRole('dialog')
		.getByRole('button', { name: 'Disengage motors', exact: true })
		.click();
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
	await first.getByRole('button', { name: 'More navigation', exact: true }).click();
	await first.getByRole('menuitem', { name: 'Z-offset', exact: true }).click();
	await first.getByRole('heading', { name: 'Z-offset workshop', exact: true }).waitFor();

	await first.goto(`${base}/account?section=notifications`);
	await first.getByRole('heading', { name: 'Perilune on this device', exact: true }).waitFor();
	await first.locator('details.notification-options summary').click();
	assert.equal(
		await first.getByLabel('Include prints started by anyone', { exact: true }).isChecked(),
		false
	);
	assert.equal(
		await first
			.getByLabel('Include printer errors when I have no active print', { exact: true })
			.isChecked(),
		false
	);
	await first.getByLabel('Include prints started by anyone', { exact: true }).check();
	await first
		.getByLabel('Include printer errors when I have no active print', { exact: true })
		.check();
	await first.getByLabel('Quiet hours', { exact: true }).check();
	await first.getByLabel('From', { exact: true }).fill('21:30');
	// Section links load documents, and the server selects the correct content without JavaScript.
	await first.evaluate(() => {
		window.accountNavigationMarker = true;
	});
	await first.getByRole('link', { name: 'Display', exact: true }).click();
	await first.getByRole('checkbox', { name: 'Serif headings', exact: true }).waitFor();
	assert.equal(await first.evaluate(() => window.accountNavigationMarker), undefined);
	assert.equal(new URL(first.url()).searchParams.get('section'), 'preferences');
	await first.reload();
	await first.getByRole('checkbox', { name: 'Serif headings', exact: true }).waitFor();
	assert.equal(
		await first.getByRole('link', { name: 'Display', exact: true }).getAttribute('aria-current'),
		'page'
	);
	const noJs = await browser.newContext({
		javaScriptEnabled: false,
		storageState: await context.storageState()
	});
	const noJsPage = await noJs.newPage();
	for (const [section, title] of [
		['preferences', 'Make yourself at home'],
		['notifications', 'Perilune on this device'],
		['integrations', 'Slicers & browsers']
	]) {
		await noJsPage.goto(base + '/account?section=' + section);
		await noJsPage.getByRole('heading', { name: title, exact: true }).waitFor();
		assert.equal(
			await noJsPage.getByRole('heading', { name: 'Secure access', exact: true }).count(),
			0
		);
	}
	await noJsPage.goto(base + '/account?section=unknown');
	await noJsPage.getByRole('heading', { name: 'Secure access', exact: true }).waitFor();
	await noJs.close();
	await first.getByRole('link', { name: 'This device', exact: true }).click();
	await first.getByRole('heading', { name: 'Perilune on this device', exact: true }).waitFor();
	assert.equal(new URL(first.url()).searchParams.get('section'), 'notifications');
	await first.screenshot({ path: 'test-results/device-settings-mobile.png', fullPage: true });
	assert.equal(
		await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
		true
	);
	await first.setViewportSize({ width: 1280, height: 900 });
	await first.screenshot({ path: 'test-results/device-settings-desktop.png', fullPage: true });
	await first.getByText('Browser permission:', { exact: false }).waitFor();
	await first.goto(`${base}/help`);
	assert.equal(await first.title(), 'Help & setup · Perilune');
	await first.getByRole('link', { name: 'Print & change filament', exact: true }).click();
	await first.getByRole('heading', { name: 'Before you print', exact: true }).waitFor();
	assert.equal(new URL(first.url()).hash, '#printing');
	await first.screenshot({ path: 'test-results/help-desktop.png', fullPage: true });
	await first.setViewportSize({ width: 320, height: 844 });
	assert.equal(
		await first.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Help fits a narrow phone'
	);
	await first.screenshot({ path: 'test-results/help-mobile.png', fullPage: true });
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
