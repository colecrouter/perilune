import { appRequest } from './smoke-remote-helper.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { authenticate } from './smoke-auth-helper.mjs';
const directory = await mkdtemp(join(tmpdir(), 'perilune-mesh-probe-smoke-'));
const base = 'http://127.0.0.1:4187';
const server = spawn(process.execPath, ['scripts/server.mjs'], {
	env: {
		...process.env,
		HOST: '127.0.0.1',
		PORT: '4187',
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
			throw new Error('Mesh probe server failed: ' + logs);
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
		const invitation = await appRequest(context.request, 'POST', base + '/api/account/invite', {
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
		const result = await appRequest(account.request, 'POST', base + '/api/account/enroll', {
			headers: { Origin: base },
			data: user
		});
		assert.equal(result.status(), 200);
		assert.equal(
			(
				await appRequest(account.request, 'POST', base + '/api/auth/sign-in/email', {
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

	const prepare = async (tab) => {
		await tab.getByRole('button', { name: 'Probe bed…', exact: true }).click();
		await tab.getByRole('checkbox', { name: /bed and probe cleanliness/ }).check();
		await tab.getByRole('checkbox', { name: /physical clearance/ }).check();
		await tab.getByRole('checkbox', { name: /synthetic simulator/ }).check();
	};
	await page.goto(base + '/calibration/mesh');
	await observer.goto(base + '/calibration/mesh');
	await observer.getByRole('button', { name: 'Isometric', exact: true }).click();
	await observer.getByRole('slider', { name: 'Rotation', exact: true }).waitFor();
	await observer.getByRole('button', { name: 'Top-down', exact: true }).click();
	await observer.getByRole('combobox', { name: 'Inspect mesh' }).selectOption('profile:cold-bed');
	assert.equal(
		await observer.getByRole('combobox', { name: 'Inspect mesh' }).inputValue(),
		'profile:cold-bed'
	);
	await page.getByRole('combobox', { name: 'Inspect mesh' }).selectOption('profile:cold-bed');
	await prepare(page);
	await page.getByRole('button', { name: 'Stop current simulation…', exact: true }).click();
	await page
		.getByRole('dialog')
		.filter({ hasText: 'Stop this print?' })
		.getByRole('button', { name: 'Stop print', exact: true })
		.click();
	await page.waitForFunction(
		() =>
			![...document.querySelectorAll('button')].find(
				(b) => b.textContent.trim() === 'Begin simulator probing'
			)?.disabled
	);
	await page.getByRole('button', { name: 'Begin simulator probing' }).click();
	await page.getByRole('heading', { name: 'Mapping the bed', exact: true }).waitFor();
	await readOnly.goto(base + '/calibration/mesh');
	assert.equal(
		await observer
			.getByRole('button', { name: 'Cancel abandoned workflow…', exact: true })
			.isDisabled(),
		true
	);
	assert.equal(
		await readOnly
			.getByRole('button', { name: 'Cancel abandoned workflow…', exact: true })
			.isDisabled(),
		true
	);
	await page.goto(base + '/controls');
	await observer
		.getByRole('heading', { name: 'Review your mesh', exact: true })
		.waitFor({ timeout: 40000 });
	await observer
		.locator('.candidate-inspection')
		.getByRole('button', { name: 'X 20.0, Y 20.0: +0.034 mm', exact: true })
		.waitFor();
	assert.equal(
		await observer.getByRole('button', { name: 'Save profile…', exact: true }).isDisabled(),
		true
	);
	await page.goto(base + '/calibration/mesh');
	await page.getByRole('heading', { name: 'Review your mesh', exact: true }).waitFor();
	await page
		.locator('.candidate-inspection')
		.getByRole('button', { name: 'X 20.0, Y 20.0: +0.034 mm', exact: true })
		.waitFor();
	assert.equal(
		await page.locator('.candidate-inspection').getByRole('combobox').count(),
		0,
		'Candidate review cannot silently show an older profile'
	);
	await page.getByRole('button', { name: 'Save profile…', exact: true }).click();
	await page.getByRole('textbox', { name: 'Profile name', exact: true }).fill('reviewed-bed');
	await page.getByRole('button', { name: 'Save profile', exact: true }).click();
	await page
		.getByText('Saved reviewed-bed. The active mesh was not changed.', { exact: true })
		.waitFor();
	assert.equal(
		await observer.getByRole('combobox', { name: 'Inspect mesh' }).inputValue(),
		'profile:cold-bed',
		'Normal inspection draft is preserved separately from candidate review'
	);
	await page.reload();
	await page.getByRole('combobox', { name: 'Inspect mesh' }).selectOption('profile:reviewed-bed');
	await prepare(observer);
	await observer.getByRole('button', { name: 'Begin simulator probing' }).click();
	await page.getByRole('heading', { name: 'Mapping the bed', exact: true }).waitFor();
	await page.getByRole('button', { name: 'Cancel abandoned workflow…', exact: true }).click();
	await page.getByRole('button', { name: 'Cancel and discard', exact: true }).click();
	await page
		.getByText('Cancelled. The previous active mesh and saved profiles were retained.', {
			exact: true
		})
		.waitFor();
	await page.setViewportSize({ width: 320, height: 800 });
	await prepare(page);
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Preparation fits mobile'
	);
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/mesh-probe-mobile.png', fullPage: true });
	assert.deepEqual(errors, []);
	console.log(
		'Mesh probe smoke passed: automatic/manual preparation, backend-owned run through navigation, shared progress, ownership/viewer gates, candidate review, saved profile, owner cancellation and 320px preparation.'
	);
} catch (cause) {
	await mkdir('test-results', { recursive: true });
	await page?.screenshot({ path: 'test-results/mesh-probe-failure.png', fullPage: true });
	console.error(logs);
	throw cause;
} finally {
	await browser?.close();
	server.kill('SIGTERM');
	await new Promise((resolve) => server.once('exit', resolve));
	await rm(directory, { recursive: true, force: true });
}
