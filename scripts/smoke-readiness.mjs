import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { authenticate } from './smoke-auth-helper.mjs';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');
const directory = await mkdtemp(join(tmpdir(), 'perilune-readiness-'));
const port = process.env.PERILUNE_TEST_PORT ?? '4230';
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['scripts/server.mjs'], {
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
let logs = '',
	browser;
server.stdout.on('data', (chunk) => {
	logs += chunk;
});
server.stderr.on('data', (chunk) => {
	logs += chunk;
});
const errors = [],
	violations = [],
	overflows = [];
const routes = [
	'/',
	'/controls',
	'/jobs',
	'/console',
	'/activity',
	'/configuration',
	'/calibration',
	'/calibration/mesh',
	'/calibration/extrusion',
	'/calibration/pid',
	'/account?section=access',
	'/account?section=notifications',
	'/account?section=integrations',
	'/account?section=preferences',
	'/help'
];
let scans = 0;
try {
	for (let attempt = 0; ; attempt++) {
		try {
			if ((await fetch(base + '/health')).ok) break;
		} catch {
			/* startup */
		}
		if (server.exitCode !== null || attempt > 100) throw new Error(`Startup failed: ${logs}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		reducedMotion: 'reduce'
	});
	await authenticate(context, base, join(directory, 'state.sqlite'));
	const page = await context.newPage();
	page.on('pageerror', (error) => errors.push(String(error)));
	async function audit(label) {
		await page.addScriptTag({ path: axePath });
		const result = await page.evaluate(async () => {
			await document.fonts.ready;
			const results = await window.axe.run(document, {
				runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] }
			});
			return {
				overflow: document.documentElement.scrollWidth - innerWidth,
				violations: results.violations.map((v) => ({
					id: v.id,
					impact: v.impact,
					nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary }))
				}))
			};
		});
		if (result.overflow > 1) overflows.push({ label, overflow: result.overflow });
		if (result.violations.length) violations.push({ label, violations: result.violations });
		scans++;
	}
	for (const colorScheme of ['light', 'dark']) {
		await page.emulateMedia({ colorScheme });
		for (const width of [1440, 700, 390, 320]) {
			await page.setViewportSize({ width, height: 900 });
			for (const route of routes) {
				await page.goto(base + route);
				await page.locator('h1').waitFor();
				assert.match(await page.title(), /Perilune/);
				await audit(`${colorScheme}/${width}${route}`);
			}
		}
	}
	// Text enlargement complements the narrow-viewport reflow checks.
	await page.emulateMedia({ colorScheme: 'light' });
	await page.setViewportSize({ width: 640, height: 900 });
	for (const route of routes) {
		await page.goto(base + route);
		await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
		await audit(`light/640/text-200${route}`);
	}
	await page.emulateMedia({ colorScheme: 'dark' });
	// Keyboard users can bypass the rail and return from modal review without a write.
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(base);
	await page.keyboard.press('Tab');
	assert.equal(
		await page.evaluate(() => document.activeElement?.textContent),
		'Skip to main content'
	);
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => document.activeElement?.id === 'main-content');
	const customizer = page.getByRole('button', { name: 'Customize', exact: true });
	await customizer.focus();
	await page.keyboard.press('Enter');
	const dialog = page.getByRole('dialog');
	await dialog.waitFor();
	await page.waitForFunction(() => document.activeElement?.closest('[role="dialog"]'));
	// Exercise both wrap boundaries, rather than only an arbitrary tab in the middle.
	const enabled = dialog.locator(
		'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'
	);
	await enabled.last().focus();
	await page.keyboard.press('Tab');
	assert.equal(
		await enabled.first().evaluate((node) => node === document.activeElement),
		true,
		'Tab wraps to the first dialog control'
	);
	await page.keyboard.press('Shift+Tab');
	assert.equal(
		await enabled.last().evaluate((node) => node === document.activeElement),
		true,
		'Shift+Tab wraps to the last dialog control'
	);
	await audit('dark/1440/customizer');
	await page.keyboard.press('Escape');
	await dialog.waitFor({ state: 'hidden' });
	await page.waitForFunction(() => document.activeElement?.textContent === 'Customize');
	// The compact navigation remains keyboard-operable without moving to a new page.
	await page.setViewportSize({ width: 320, height: 900 });
	const more = page.getByRole('button', { name: 'More navigation', exact: true });
	await more.focus();
	await page.keyboard.press('ArrowDown');
	const menu = page.getByRole('menu');
	await menu.waitFor();
	await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
	const firstItem = await page.evaluate(() => document.activeElement?.textContent);
	await page.keyboard.press('ArrowDown');
	await page.waitForFunction(
		(first) =>
			document.activeElement?.getAttribute('role') === 'menuitem' &&
			document.activeElement?.textContent !== first,
		firstItem
	);
	await page.keyboard.press('ArrowUp');
	await page.waitForFunction((first) => document.activeElement?.textContent === first, firstItem);
	await audit('dark/320/navigation-menu');
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => document.activeElement?.textContent?.includes('More'));
	await context.close();
	// Public entry/recovery states use a separate unauthenticated browser context.
	const publicContext = await browser.newContext({
		viewport: { width: 320, height: 900 },
		reducedMotion: 'reduce'
	});
	const publicPage = await publicContext.newPage();
	publicPage.on('pageerror', (error) => errors.push(String(error)));
	for (const colorScheme of ['light', 'dark']) {
		await publicPage.emulateMedia({ colorScheme });
		for (const route of ['/login', '/forgot-password', '/pair/start']) {
			await publicPage.goto(base + route);
			await publicPage.locator('h1').waitFor();
			await publicPage.addScriptTag({ path: axePath });
			const result = await publicPage.evaluate(async () => {
				await document.fonts.ready;
				return {
					overflow: document.documentElement.scrollWidth - innerWidth,
					violations: (
						await window.axe.run(document, {
							runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] }
						})
					).violations.map((v) => ({
						id: v.id,
						nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary }))
					}))
				};
			});
			if (result.overflow > 1)
				overflows.push({ label: `${colorScheme}/320${route}`, overflow: result.overflow });
			if (result.violations.length)
				violations.push({ label: `${colorScheme}/320${route}`, violations: result.violations });
			scans++;
		}
	}
	assert.deepEqual(overflows, [], 'Core routes reflow without document overflow');
	assert.deepEqual(
		violations,
		[],
		'Automated WCAG checks (not a complete accessibility certification)'
	);
	assert.deepEqual(errors, [], 'No uncaught page errors');
	console.log(
		`Readiness smoke passed: ${scans} route/state scans, light/dark 320/390/700/1440px, keyboard skip/menu/dialog focus, public recovery and no page errors.`
	);
} catch (error) {
	console.error(JSON.stringify({ violations, overflows, errors }));
	throw error;
} finally {
	await browser?.close();
	server.kill('SIGTERM');
	await rm(directory, { recursive: true, force: true });
}
