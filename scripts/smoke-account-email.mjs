import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { authenticate } from './smoke-auth-helper.mjs';
const messages = [],
	sockets = new Set();
const smtp = createServer((socket) => {
	sockets.add(socket);
	socket.on('close', () => sockets.delete(socket));
	socket.setEncoding('utf8');
	socket.write('220 fixture SMTP\r\n');
	let buffer = '',
		data = false,
		lines = [];
	socket.on('data', (chunk) => {
		buffer += chunk;
		while (buffer.includes('\n')) {
			const index = buffer.indexOf('\n'),
				line = buffer.slice(0, index).replace(/\r$/, '');
			buffer = buffer.slice(index + 1);
			if (data) {
				if (line === '.') {
					messages.push(
						lines
							.join('\n')
							.replace(/=\n/g, '')
							.replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
					);
					lines = [];
					data = false;
					socket.write('250 accepted\r\n');
				} else lines.push(line);
				continue;
			}
			if (/^EHLO|^HELO/.test(line)) socket.write('250-fixture\r\n250 PIPELINING\r\n');
			else if (line.startsWith('DATA')) {
				data = true;
				socket.write('354 end with dot\r\n');
			} else if (line.startsWith('QUIT')) {
				socket.end('221 bye\r\n');
			} else socket.write('250 ok\r\n');
		}
	});
});
await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
const directory = await mkdtemp(join(tmpdir(), 'perilune-mail-smoke-')),
	filename = join(directory, 'state.sqlite'),
	base = 'http://localhost:4204';
const app = spawn(process.execPath, ['scripts/server.mjs'], {
	env: {
		...process.env,
		HOST: '127.0.0.1',
		PORT: '4204',
		PERILUNE_ORIGIN: base,
		PERILUNE_DATABASE: filename,
		PERILUNE_MOONRAKER_URL: '',
		PERILUNE_CAMERA_COMPANION_URL: '',
		PERILUNE_SMTP_HOST: '127.0.0.1',
		PERILUNE_SMTP_PORT: String(smtp.address().port),
		PERILUNE_SMTP_FROM: 'Perilune <sender@example.test>',
		PERILUNE_SMTP_USER: '',
		PERILUNE_SMTP_PASSWORD: '',
		PERILUNE_SMTP_ALLOW_INSECURE: 'true'
	},
	stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '',
	browser;
let database;
app.stdout.on('data', (c) => (logs += c));
app.stderr.on('data', (c) => (logs += c));
const wait = async (check) => {
	for (let i = 0; i < 150; i++) {
		if (await check()) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw Error('Fixture condition timed out');
};
const linkFrom = (text, path) =>
	text.match(new RegExp(`http://localhost:4204/${path}#[A-Za-z0-9_-]{43}`))?.[0];
try {
	await wait(async () => {
		try {
			return (await fetch(base + '/health')).ok;
		} catch {
			return false;
		}
	});
	browser = await chromium.launch({ headless: true });
	const owner = await browser.newContext();
	await authenticate(owner, base, filename);
	database = new DatabaseSync(filename, { readOnly: true });
	const page = await owner.newPage(),
		errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	const accountDocument = await page.goto(base + '/account');
	assert.match(accountDocument.headers()['cache-control'], /(?:^|,\s*)no-transform(?:,|$)/);
	await page.getByRole('heading', { name: 'Account recovery', exact: true }).waitFor();
	assert.match(await page.locator('body').innerText(), /Not verified for recovery/);
	await page.getByRole('button', { name: 'Send test email', exact: true }).click();
	await wait(() => messages.some((m) => m.includes('Subject: Perilune email test')));
	await wait(
		() =>
			database
				.prepare("SELECT count(*) AS n FROM account_mail WHERE kind='test' AND status='sent'")
				.get().n === 1
	);
	await page.getByRole('button', { name: 'Refresh email status', exact: true }).click();
	await page.getByText('Accepted by mail server', { exact: false }).waitFor();
	await page.getByRole('button', { name: 'Verify recovery email', exact: true }).click();
	await wait(() => messages.some((m) => linkFrom(m, 'verify-email')));
	const verification = linkFrom(
		messages.find((m) => linkFrom(m, 'verify-email')),
		'verify-email'
	);
	const unauth = await browser.newContext(),
		entry = await unauth.newPage();
	await entry.goto(verification);
	assert.equal(
		(await owner.request.get(base + '/api/account/manage')).status(),
		200,
		'Opening an email must not revoke sessions'
	);
	await entry.getByRole('button', { name: 'Verify recovery email', exact: true }).click();
	await entry.getByRole('status').filter({ hasText: 'Recovery email verified.' }).waitFor();
	await page.reload();
	await page.getByText('Verified recovery address', { exact: false }).waitFor();
	await entry.goto(base + '/forgot-password');
	await entry.getByLabel('Email', { exact: true }).fill('owner@example.test');
	await entry.getByRole('button', { name: 'Send reset link', exact: true }).click();
	await entry.getByRole('status').waitFor();
	await wait(() => messages.some((m) => linkFrom(m, 'forgot-password')));
	const reset = linkFrom(
		messages.find((m) => linkFrom(m, 'forgot-password')),
		'forgot-password'
	);
	await entry.goto(reset);
	await entry.getByLabel('New password', { exact: true }).fill('replacement-owner-password');
	await entry
		.getByLabel('Confirm new password', { exact: true })
		.fill('replacement-owner-password');
	await entry.getByRole('button', { name: 'Update password', exact: true }).click();
	await entry.getByRole('status').filter({ hasText: 'Password updated.' }).waitFor();
	assert.equal((await owner.request.get(base + '/api/account/manage')).status(), 401);
	await entry.getByRole('link', { name: 'Back to sign in', exact: true }).click();
	await entry.getByLabel('Email', { exact: true }).fill('owner@example.test');
	await entry.getByLabel('Password', { exact: true }).fill('replacement-owner-password');
	await entry.getByRole('button', { name: 'Sign in', exact: true }).click();
	await entry.waitForURL(base + '/');
	await entry.goto(base + '/account');
	await entry.getByRole('checkbox', { name: 'Send by email', exact: true }).check();
	await entry.getByLabel('Recipient email', { exact: true }).fill('guest@example.test');
	await entry.getByRole('button', { name: 'Create invitation', exact: true }).click();
	await entry.getByText('Invitation email queued;', { exact: false }).waitFor();
	await wait(() => messages.some((m) => linkFrom(m, 'register')));
	const invite = linkFrom(
		messages.find((m) => linkFrom(m, 'register')),
		'register'
	);
	const guest = await browser.newContext(),
		joinPage = await guest.newPage();
	await joinPage.goto(invite);
	await joinPage.getByText('You are joining as operator.', { exact: false }).waitFor();
	await joinPage.getByLabel('Your name', { exact: true }).fill('Guest');
	await joinPage.getByLabel('Email', { exact: true }).fill('guest@example.test');
	await joinPage.getByLabel('Password', { exact: true }).fill('guest-account-password');
	await joinPage.getByRole('button', { name: 'Create account', exact: true }).click();
	await joinPage.waitForURL(base + '/login?created=1');
	await joinPage.setViewportSize({ width: 390, height: 844 });
	await mkdir('test-results', { recursive: true });
	await joinPage.screenshot({ path: 'test-results/account-entry-mobile.png', fullPage: true });
	assert.equal(
		await joinPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
		true
	);
	await joinPage.goto(invite);
	await joinPage.getByText('This invitation has already been used.', { exact: false }).waitFor();
	assert.equal(
		await joinPage.getByRole('button', { name: 'Create account', exact: true }).isDisabled(),
		true
	);
	const request = await guest.request.post(base + '/api/access/request-reset', {
		headers: { origin: base },
		data: { email: 'nobody@example.test' }
	});
	assert.equal(request.status(), 200);
	assert.match((await request.json()).message, /If this account/);
	assert.equal(
		(
			await guest.request.post(base + '/api/access/request-reset', {
				headers: { origin: 'https://untrusted.example' },
				data: { email: 'owner@example.test' }
			})
		).status(),
		403
	);
	assert.deepEqual(errors, []);
	console.log(
		'Account email smoke passed: local SMTP acceptance, explicit verification, verified-only reset, session revocation, normal sign-in, recipient-bound invitation, used-link state, generic response, CSRF and mobile.'
	);
} catch (cause) {
	console.error(logs);
	throw cause;
} finally {
	database?.close();
	await browser?.close();
	app.kill('SIGTERM');
	await new Promise((r) => (app.exitCode !== null ? r() : app.once('exit', r)));
	for (const socket of sockets) socket.destroy();
	await new Promise((r) => smtp.close(r));
	await rm(directory, { recursive: true, force: true });
}
