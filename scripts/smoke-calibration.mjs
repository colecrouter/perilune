import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { authenticate } from './smoke-auth-helper.mjs';
const directory = await mkdtemp(join(tmpdir(), 'perilune-calibration-smoke-'));
const base = 'http://127.0.0.1:4186';
const server = spawn(process.execPath, ['scripts/server.mjs'], {
	env: {
		...process.env,
		HOST: '127.0.0.1',
		PORT: '4186',
		PERILUNE_ORIGIN: base,
		PERILUNE_DATABASE: join(directory, 'state.sqlite'),
		PERILUNE_MOONRAKER_URL: '',
		PERILUNE_MOONRAKER_API_KEY: '',
		PERILUNE_CAMERA_COMPANION_URL: ''
	},
	stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '';
server.stdout.on('data', (chunk) => (logs += chunk));
server.stderr.on('data', (chunk) => (logs += chunk));
let browser, page;
try {
	for (let attempt = 0; ; attempt++) {
		try {
			if ((await fetch(base + '/health')).ok) break;
		} catch {}
		if (server.exitCode !== null || attempt > 100)
			throw new Error('Calibration server failed: ' + logs);
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
	const enroll = async (role) => {
		const invitation = await context.request.post(base + '/api/account/invite', {
			headers: { Origin: base },
			data: { role }
		});
		assert.equal(invitation.status(), 200);
		const { url } = await invitation.json();
		const account = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
		const user = {
			token: new URL(url).hash.slice(1),
			name: `Fixture ${role}`,
			email: `${role}@example.test`,
			password: `fixture-${role}-password`
		};
		const result = await account.request.post(base + '/api/account/enroll', {
			headers: { Origin: base },
			data: user
		});
		assert.equal(result.status(), 200);
		assert.equal(
			(
				await account.request.post(base + '/api/auth/sign-in/email', {
					headers: { Origin: base },
					data: { email: user.email, password: user.password }
				})
			).status(),
			200
		);
		return account;
	};
	const operator = await enroll('operator');
	const observer = await operator.newPage();
	const viewer = await enroll('viewer');
	const readOnly = await viewer.newPage();
	const checklist = async (tab) => {
		await tab.getByRole('checkbox', { name: /clean-nozzle/ }).check();
		await tab.getByRole('checkbox', { name: /bed clearance/ }).check();
		await tab.getByRole('checkbox', { name: /simulator exercise/ }).check();
	};
	const adjust = async (tab, expected) => {
		await tab.getByRole('button', { name: 'Z − · closer', exact: true }).click();
		await tab.waitForFunction(
			(value) => document.querySelector('.clearance strong')?.textContent === value,
			expected
		);
	};
	const firstLayer = async (tab) => {
		await tab.getByRole('button', { name: 'Explore first-layer examples →', exact: true }).click();
		await tab.getByRole('heading', { name: 'Read the first layer', exact: true }).waitFor();
	};
	const review = async (tab) => {
		await tab.getByRole('button', { name: /Even and joined/ }).click();
		await tab.getByRole('button', { name: 'Review this offset →', exact: true }).click();
		await tab.getByRole('heading', { name: 'Keep this adjustment?', exact: true }).waitFor();
	};
	await page.goto(base + '/calibration');
	await page.getByRole('heading', { name: 'Z-offset workshop', exact: true }).waitFor();
	assert.equal(
		await page
			.getByRole('button', { name: 'Begin simulator calibration', exact: true })
			.isDisabled(),
		true
	);
	await page.waitForFunction(() => document.querySelector('.prerequisites input')?.checked);
	assert.equal(
		await page.getByRole('checkbox', { name: 'All axes homed', exact: true }).isChecked(),
		true
	);
	assert.equal(
		await page
			.getByRole('checkbox', { name: 'Heater targets off for this exercise', exact: true })
			.isChecked(),
		false
	);
	assert.equal(
		await page.getByRole('button', { name: 'Home all axes', exact: true }).isDisabled(),
		true
	);
	await checklist(page);
	await page.getByRole('button', { name: 'Stop current simulation…', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Stop print', exact: true }).click();
	await page.waitForFunction(() =>
		[...document.querySelectorAll('.prerequisites input')].every((input) => input.checked)
	);
	assert.equal(
		await page.getByRole('button', { name: 'Turn heater targets off', exact: true }).isDisabled(),
		true
	);
	await page.waitForFunction(
		() =>
			![...document.querySelectorAll('button')].find(
				(button) => button.textContent.trim() === 'Begin simulator calibration'
			)?.disabled
	);
	await checklist(page);
	await page.getByRole('button', { name: 'Begin simulator calibration', exact: true }).click();
	await page.getByRole('heading', { name: 'Find your clearance', exact: true }).waitFor();
	await observer.goto(base + '/calibration');
	assert.equal(
		await observer.getByRole('button', { name: 'Z − · closer', exact: true }).isDisabled(),
		true
	);
	await readOnly.goto(base + '/calibration');
	assert.equal(
		await readOnly.getByRole('button', { name: 'Z − · closer', exact: true }).isDisabled(),
		true
	);
	const requestPromise = page.waitForRequest(
		(request) => request.method() === 'POST' && request.url().includes('/_app/remote/')
	);
	await adjust(page, '-0.010 mm');
	const request = await requestPromise;
	const headers = { Origin: base, 'Content-Type': request.headers()['content-type'] };
	const otherRejection = await (
		await operator.request.post(request.url(), { headers, data: request.postData() })
	).json();
	assert.equal(otherRejection.type, 'error');
	assert.equal(otherRejection.error.status, 409);
	const viewerRejection = await (
		await viewer.request.post(request.url(), { headers, data: request.postData() })
	).json();
	assert.equal(viewerRejection.type, 'error');
	assert.equal(viewerRejection.error.status, 403);
	await observer.waitForFunction(
		() => document.querySelector('.clearance strong')?.textContent === '-0.010 mm'
	);
	await page.goto(base + '/controls');
	assert.equal(
		await page.getByRole('button', { name: 'Home All', exact: true }).isDisabled(),
		true
	);
	await page.goto(base + '/calibration');
	await firstLayer(page);
	await review(page);
	await page.getByRole('button', { name: 'Save simulator default…', exact: true }).click();
	const second = await context.newPage();
	await second.goto(base + '/calibration');
	await second.getByRole('button', { name: '← Adjust again', exact: true }).click();
	await adjust(second, '-0.020 mm');
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Save simulator default', exact: true })
		.click();
	await page
		.getByRole('dialog')
		.getByRole('alert')
		.filter({ hasText: 'Calibration changed' })
		.waitFor();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Keep reviewing', exact: true })
		.click();
	await page.getByRole('button', { name: 'Cancel calibration…', exact: true }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Discard adjustments', exact: true })
		.click();
	await page.getByRole('heading', { name: 'Adjustments discarded.', exact: true }).waitFor();
	await checklist(observer);
	await checklist(observer);
	await observer.getByRole('button', { name: 'Begin simulator calibration', exact: true }).click();
	await observer.getByRole('heading', { name: 'Find your clearance', exact: true }).waitFor();
	await page.getByRole('button', { name: 'End abandoned session…', exact: true }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Discard adjustments', exact: true })
		.click();
	await page.getByRole('heading', { name: 'Adjustments discarded.', exact: true }).waitFor();
	await checklist(page);
	await page.getByRole('button', { name: 'Begin simulator calibration', exact: true }).click();
	await page.getByRole('heading', { name: 'Find your clearance', exact: true }).waitFor();
	await page.getByRole('button', { name: '0.05 mm', exact: true }).click();
	await adjust(page, '-0.050 mm');
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/calibration-desktop.png', fullPage: true });
	await page.setViewportSize({ width: 320, height: 844 });
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	await page.screenshot({ path: 'test-results/calibration-mobile.png', fullPage: true });
	await firstLayer(page);
	await page.getByRole('button', { name: /Too high/ }).click();
	assert.equal(
		await page.getByRole('button', { name: 'Review this offset →', exact: true }).isDisabled(),
		true
	);
	await review(page);
	await page.getByRole('button', { name: 'Save simulator default…', exact: true }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Save simulator default', exact: true })
		.click();
	await page.getByRole('heading', { name: 'Saved for your next session.', exact: true }).waitFor();
	assert.equal(await page.locator('.offset-summary strong').nth(1).textContent(), '-0.050 mm');
	await checklist(second);
	await checklist(second);
	await second.getByRole('button', { name: 'Begin simulator calibration', exact: true }).click();
	await second.getByRole('heading', { name: 'Find your clearance', exact: true }).waitFor();
	await adjust(second, '-0.060 mm');
	await firstLayer(second);
	await page.getByRole('heading', { name: 'Read the first layer', exact: true }).waitFor();
	assert.equal(
		await page.getByRole('button', { name: 'Review this offset →', exact: true }).isDisabled(),
		true
	);
	await review(page);
	await page.getByRole('button', { name: 'Apply until restart', exact: true }).click();
	await page.getByRole('heading', { name: 'Applied until restart.', exact: true }).waitFor();
	assert.equal(await page.locator('.offset-summary strong').nth(0).textContent(), '-0.060 mm');
	assert.equal(await page.locator('.offset-summary strong').nth(1).textContent(), '-0.050 mm');
	await page.reload();
	assert.equal(await page.locator('.offset-summary strong').nth(0).textContent(), '-0.060 mm');
	assert.equal(await page.locator('.offset-summary strong').nth(1).textContent(), '-0.050 mm');
	assert.deepEqual(errors, []);
	console.log(
		'Calibration smoke passed: preparation, ownership/viewer gates, shared candidates, locked motion, stale save rejection, cancellation/owner recovery, persistent default, temporary apply, new-session observation reset, 320px layout.'
	);
} catch (cause) {
	await mkdir('test-results', { recursive: true });
	await page?.screenshot({ path: 'test-results/calibration-failure.png', fullPage: true });
	console.error(logs);
	throw cause;
} finally {
	await browser?.close();
	server.kill('SIGTERM');
	await new Promise((resolve) => server.once('exit', resolve));
	await rm(directory, { recursive: true, force: true });
}
