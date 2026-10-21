import { appRequest, remoteEndpoint } from './smoke-remote-helper.mjs';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { testSessionCookieOrdering } from './smoke-session-race-helper.mjs';
import { testPairing } from './smoke-pairing-helper.mjs';
import { authenticate } from './smoke-auth-helper.mjs';
const directory = await mkdtemp(join(tmpdir(), 'perilune-auth-smoke-'));
const filename = join(directory, 'state.sqlite');
const base = 'http://localhost:4184';
const env = {
	...process.env,
	HOST: '127.0.0.1',
	PORT: '4184',
	PERILUNE_ORIGIN: base,
	PERILUNE_DATABASE: filename,
	PERILUNE_MOONRAKER_URL: '',
	PERILUNE_CAMERA_COMPANION_URL: ''
};
let server = spawn(process.execPath, ['scripts/server.mjs'], {
	env,
	stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '';
server.stdout.on('data', (chunk) => (logs += chunk));
server.stderr.on('data', (chunk) => (logs += chunk));
let browser;
try {
	for (let i = 0; ; i++) {
		try {
			if ((await fetch(`${base}/health`)).ok) break;
		} catch {}
		if (i > 100 || server.exitCode !== null)
			throw new Error(`Auth fixture failed to start: ${logs}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.equal((await fetch(`${base}/api/camera/snapshot`)).status, 401);
	assert.equal((await fetch(`${base}/`, { redirect: 'manual' })).headers.get('location'), '/setup');
	browser = await chromium.launch({ headless: true });
	const owner = await browser.newContext();
	await authenticate(owner, base, filename);
	for (const endpoint of [
		'/api/account/manage',
		'/api/account/browsers',
		'/api/preferences',
		'/api/configuration',
		'/api/configuration/application',
		'/api/camera/setup',
		'/api/jobs/keys',
		'/api/jobs/library',
		'/reference/klipper.json'
	]) {
		assert.equal(
			(await owner.request.get(base + endpoint, { maxRedirects: 0 })).status(),
			404,
			`Removed internal endpoint: ${endpoint}`
		);
	}
	assert.equal(
		(
			await owner.request.post(base + remoteEndpoint('access', 'accountEntry'), {
				headers: { Origin: base },
				data: { payload: 'x'.repeat(40_000) }
			})
		).status(),
		413,
		'Public remote bodies are bounded before parsing'
	);

	for (const pathname of ['/manifest.webmanifest', '/icons/app-192.png', '/api/auth/get-session']) {
		assert.equal(
			(
				await owner.request.post(base + remoteEndpoint('access', 'accountEntry'), {
					headers: { Origin: base, 'x-sveltekit-pathname': pathname },
					data: { payload: 'x'.repeat(40_000) }
				})
			).status(),
			413,
			'Calling-page headers cannot bypass public remote body bounds'
		);
	}
	const signedOut = await browser.newContext();
	assert.equal(
		(
			await signedOut.request.post(base + remoteEndpoint('device', 'savePreferences'), {
				headers: { Origin: base, 'x-sveltekit-pathname': '/login' },
				data: { payload: 'x'.repeat(40_000) }
			})
		).status(),
		401,
		'Private remote calls authenticate before parsing even with a public calling-page header'
	);
	await signedOut.close();
	const page = await owner.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(`${base}/account`);
	await page.getByRole('heading', { name: 'Your account' }).waitFor();
	await mkdir('test-results', { recursive: true });
	await testSessionCookieOrdering(owner, base, filename);
	await testPairing(owner, base, directory, filename);
	const cdp = await owner.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
	await page.getByRole('button', { name: 'Add a passkey', exact: true }).click();
	await page.getByRole('status').waitFor();
	assert.match(await page.getByRole('status').innerText(), /Passkey added/);
	await page.emulateMedia({ colorScheme: 'dark' });
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/auth-account-dark.png', fullPage: true });
	await page.emulateMedia({ colorScheme: 'light' });
	await page.getByRole('button', { name: 'Sign out', exact: true }).click();
	await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
	assert.equal(await page.locator('link[rel="icon"]').count(), 1);
	assert.equal(
		(await page.locator('link[rel="icon"]').getAttribute('href')).startsWith('data:'),
		false
	);
	await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
	const commandRequest = page.waitForRequest(
		(request) => request.method() === 'POST' && request.url().includes('/_app/remote/')
	);
	await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
	const command = await commandRequest;
	const invite = await appRequest(owner.request, 'POST', `${base}/api/account/invite`, {
		headers: { Origin: base },
		data: { role: 'viewer' }
	});
	assert.equal(invite.status(), 200);
	const { url } = await invite.json();
	const viewer = await browser.newContext();
	const viewerPage = await viewer.newPage();
	await viewerPage.goto(url);
	await viewerPage.emulateMedia({ colorScheme: 'dark' });
	await viewerPage.screenshot({ path: 'test-results/auth-registration-dark.png', fullPage: true });
	await viewerPage.emulateMedia({ colorScheme: 'light' });
	await viewerPage.getByLabel('Your name').fill('Fixture viewer');
	await viewerPage.getByLabel('Email', { exact: true }).fill('viewer@example.test');
	await viewerPage.getByLabel('Password', { exact: true }).fill('fixture-viewer-password');
	await viewerPage.getByRole('button', { name: 'Create account' }).click();
	await viewerPage.getByRole('heading', { name: 'Welcome back' }).waitFor();
	await viewerPage.getByLabel('Email', { exact: true }).fill('viewer@example.test');
	await viewerPage.getByLabel('Password', { exact: true }).fill('fixture-viewer-password');
	await viewerPage.getByRole('button', { name: 'Sign in', exact: true }).click();
	await viewerPage.getByRole('button', { name: 'Pause print', exact: true }).waitFor();
	assert.equal(
		await viewerPage.getByRole('button', { name: 'Pause print', exact: true }).isDisabled(),
		true
	);
	const replay = await appRequest(viewer.request, 'POST', command.url(), {
		headers: { Origin: base, 'Content-Type': command.headers()['content-type'] },
		data: command.postData()
	});
	const rejection = await replay.json();
	assert.equal(rejection.type, 'error');
	assert.equal(
		rejection.error.status,
		403,
		'Viewer cannot bypass controls through the remote command protocol'
	);
	assert.equal(
		(
			await appRequest(viewer.request, 'POST', `${base}/api/account/invite`, {
				headers: { Origin: base },
				data: { role: 'owner' }
			})
		).status(),
		403
	);
	assert.equal(
		(
			await appRequest(owner.request, 'POST', `${base}/api/account/invite`, {
				headers: { Origin: 'https://evil.example' },
				data: { role: 'owner' }
			})
		).status(),
		403
	);
	// Account mutations use remote commands with the same authorization/CSRF boundary.
	const accountPage = await owner.newPage();
	const accountResponse = await accountPage.goto(base + '/account');
	assert.equal(accountResponse.status(), 200, logs);
	await accountPage.getByRole('combobox').selectOption('viewer');
	const inviteCommandRequest = accountPage.waitForRequest(
		(r) =>
			r.method() === 'POST' &&
			r.url().includes('/_app/remote/') &&
			r.url().includes('inviteAccount')
	);
	await accountPage.getByRole('button', { name: 'Create invitation', exact: true }).click();
	const inviteCommand = await inviteCommandRequest;
	await accountPage.getByText('Invitation ready to share.', { exact: true }).waitFor();
	const forbiddenInvite = await appRequest(viewer.request, 'POST', inviteCommand.url(), {
		headers: { Origin: base, 'Content-Type': inviteCommand.headers()['content-type'] },
		data: inviteCommand.postData()
	});
	const forbiddenResult = await forbiddenInvite.json();
	assert.equal(forbiddenResult.type, 'error');
	assert.equal(forbiddenResult.error.status, 403);
	assert.equal(
		(
			await appRequest(owner.request, 'POST', inviteCommand.url(), {
				headers: {
					Origin: 'https://evil.example',
					'Content-Type': inviteCommand.headers()['content-type']
				},
				data: inviteCommand.postData()
			})
		).status(),
		403
	);
	await accountPage.close();
	const accounts = await (
		await appRequest(owner.request, 'GET', `${base}/api/account/manage`)
	).json();
	const target = accounts.accounts.find((account) => account.email === 'viewer@example.test');
	await appRequest(owner.request, 'POST', `${base}/api/account/revoke-account`, {
		headers: { Origin: base },
		data: { id: target.id }
	});
	assert.equal(
		(await appRequest(viewer.request, 'GET', `${base}/api/account/manage`)).status(),
		401
	);
	await page.goto(`${base}/account`);
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/auth-account.png', fullPage: true });
	assert.throws(
		() =>
			execFileSync(
				process.execPath,
				['scripts/auth.mjs', 'recover', 'owner@example.test', '--server-stopped'],
				{ env, stdio: 'pipe' }
			),
		'Recovery refuses a running server'
	);
	server.kill('SIGTERM');
	await new Promise((resolve) => server.once('exit', resolve));
	const recovery = execFileSync(
		process.execPath,
		['scripts/auth.mjs', 'recover', 'owner@example.test', '--server-stopped'],
		{ env, encoding: 'utf8' }
	)
		.trim()
		.split('\n')
		.at(-1);
	server = spawn(process.execPath, ['scripts/server.mjs'], {
		env,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	server.stdout.on('data', (chunk) => (logs += chunk));
	server.stderr.on('data', (chunk) => (logs += chunk));
	for (let i = 0; ; i++) {
		try {
			if ((await fetch(`${base}/health`)).ok) break;
		} catch {}
		if (i > 100 || server.exitCode !== null) throw new Error('Recovered server failed to start.');
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.equal(
		(await appRequest(owner.request, 'GET', `${base}/api/account/manage`)).status(),
		401
	);
	const bad = await appRequest(owner.request, 'POST', `${base}/api/auth/sign-in/email`, {
		headers: { Origin: base },
		data: { email: 'owner@example.test', password: 'fixture-owner-password' }
	});
	assert.equal(bad.status(), 401);
	await page.goto(recovery);
	await page.getByLabel('Password', { exact: true }).fill('new-owner-fixture-password');
	await page.getByRole('button', { name: 'Update password' }).click();
	await page.getByRole('alert').filter({ hasText: 'Password updated' }).waitFor();
	await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
	await page.getByLabel('Password', { exact: true }).fill('new-owner-fixture-password');
	// Exercise the real throttle, then let its ten-second window expire.
	await new Promise((resolve) => setTimeout(resolve, 11000));
	const recoveryLogin = page.waitForResponse((response) =>
		response.url().endsWith('/api/auth/sign-in/email')
	);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	assert.equal((await recoveryLogin).status(), 200, 'Recovered password permits sign-in');
	await page
		.getByRole('button', { name: 'Pause print', exact: true })
		.waitFor()
		.catch(async (cause) => {
			console.error(await page.locator('body').innerText());
			throw cause;
		});
	await page.goto(`${base}/login`);
	await page.setViewportSize({ width: 320, height: 844 });
	await page.screenshot({ path: 'test-results/auth-login-mobile.png', fullPage: true });
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.screenshot({ path: 'test-results/auth-login-mobile-dark.png', fullPage: true });
	let throttled;
	for (let i = 0; i < 4; i++)
		throttled = await appRequest(owner.request, 'POST', `${base}/api/auth/sign-in/email`, {
			headers: {
				Origin: base,
				'X-Forwarded-For': `192.0.2.${i + 1}`,
				'X-Perilune-Client-IP': `192.0.2.${i + 1}`
			},
			data: { email: 'owner@example.test', password: 'incorrect-password' }
		});
	assert.equal(
		throttled.status(),
		429,
		'Spoofed forwarding/client-IP headers cannot evade login throttling'
	);
	assert.deepEqual(errors, []);
	console.log(
		'Auth smoke passed: setup, invitations, roles, CSRF, revocation, passkey enrollment/sign-in, owner recovery, mobile.'
	);
} finally {
	await browser?.close();
	server.kill('SIGTERM');
	await Promise.race([
		new Promise((resolve) => server.once('exit', resolve)),
		new Promise((resolve) =>
			setTimeout(() => {
				server.kill('SIGKILL');
				resolve();
			}, 3000)
		)
	]);
	await rm(directory, { recursive: true, force: true });
}
