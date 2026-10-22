import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { remoteRequest } from './smoke-remote-helper.mjs';
export async function testOwnerReset(browser, owner, base, filename) {
	const call = (context, module, name, arg, query = false, options = {}) =>
		remoteRequest(context.request, base, module, name, arg, query, options);
	const invitation = await (
		await call(owner, 'account', 'inviteAccount', { role: 'operator' })
	).json();
	const recipient = await browser.newContext();
	assert.equal(
		(
			await call(recipient, 'access', 'accountEntry', {
				operation: 'enroll',
				token: invitation.url.split('#')[1],
				name: 'Reset recipient',
				email: 'reset@example.test',
				password: 'original-reset-password'
			})
		).status(),
		200
	);
	await recipient.request.post(base + '/api/auth/sign-in/email', {
		headers: { Origin: base },
		data: { email: 'reset@example.test', password: 'original-reset-password' }
	});
	const access = await (await call(owner, 'account', 'getAccess', undefined, true)).json();
	const target = access.accounts.find((account) => account.email === 'reset@example.test').id;
	assert.equal(
		(await call(recipient, 'account', 'createOwnerReset', { target, confirmed: true })).status(),
		403
	);
	assert.equal(
		(
			await call(owner, 'account', 'createOwnerReset', { target, confirmed: true }, false, {
				headers: { Origin: 'https://foreign.example' }
			})
		).status(),
		403
	);
	assert.equal((await call(owner, 'account', 'createOwnerReset', { target })).status(), 400);
	const page = await owner.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(base + '/account');
	await page
		.getByRole('button', { name: 'Reset password for Reset recipient', exact: true })
		.click();
	const dialog = page.getByRole('dialog');
	assert.equal(
		await dialog.getByRole('button', { name: 'Create reset link', exact: true }).isEnabled(),
		false
	);
	await dialog.getByRole('checkbox').check();
	await dialog.getByRole('button', { name: 'Create reset link', exact: true }).click();
	await dialog.getByLabel('Reset link', { exact: true }).waitFor();
	const url = await dialog.getByLabel('Reset link', { exact: true }).inputValue();
	const token = url.split('#')[1];
	assert.equal((await owner.request.get(base + '/account')).status(), 200);
	assert.equal((await (await owner.request.get(base + '/account')).text()).includes(token), false);
	assert.equal(
		JSON.stringify(
			await (await call(owner, 'account', 'getAccess', undefined, true)).json()
		).includes(token),
		false
	);
	await page.waitForTimeout(300);
	await page.screenshot({ path: 'test-results/owner-reset-desktop.png' });
	await page.setViewportSize({ width: 390, height: 844 });
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	await page.screenshot({ path: 'test-results/owner-reset-mobile.png' });
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	assert.equal(await page.getByLabel('Reset link', { exact: true }).count(), 0);
	await page.getByRole('button', { name: 'Revoke reset link for Reset recipient' }).click();
	await page.getByText('Reset link revoked.', { exact: true }).waitFor();
	assert.equal(
		(
			await call(recipient, 'access', 'accountEntry', {
				operation: 'reset',
				token,
				password: 'replacement-reset-password'
			})
		).status(),
		400
	);
	const next = await (
		await call(owner, 'account', 'createOwnerReset', { target, confirmed: true })
	).json();
	const anonymous = await browser.newContext();
	const reset = await anonymous.newPage();
	await reset.goto(next.url);
	await reset.getByLabel('New password', { exact: true }).fill('replacement-reset-password');
	await reset
		.getByLabel('Confirm new password', { exact: true })
		.fill('replacement-reset-password');
	await reset.getByRole('button', { name: 'Update password', exact: true }).click();
	await reset.getByText(/Password updated/).waitFor();
	assert.equal(new URL(reset.url()).hash, '');
	assert.equal((await call(recipient, 'account', 'getAccess', undefined, true)).status(), 401);
	assert.equal(
		(
			await recipient.request.post(base + '/api/auth/sign-in/email', {
				headers: { Origin: base },
				data: { email: 'reset@example.test', password: 'replacement-reset-password' }
			})
		).status(),
		200
	);
	const db = new DatabaseSync(filename);
	assert.equal(
		db.prepare('SELECT emailVerified FROM user WHERE id=?').get(target).emailVerified,
		0
	);
	db.prepare('UPDATE session SET createdAt=? WHERE userId=(SELECT id FROM user WHERE email=?)').run(
		Date.now() - 660000,
		'owner@example.test'
	);
	db.close();
	await page.goto(base + '/account');
	await page
		.getByRole('button', { name: 'Reset password for Reset recipient', exact: true })
		.click();
	await page.getByRole('link', { name: 'Confirm your sign-in', exact: true }).click();
	await page.getByRole('heading', { name: 'Confirm your sign-in', exact: true }).waitFor();
	await page.reload();
	await page.getByRole('heading', { name: 'Confirm your sign-in', exact: true }).waitFor();
	assert.equal(await page.getByRole('link', { name: 'Sign in with another browser' }).count(), 0);
	await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
	await page.getByLabel('Password', { exact: true }).fill('fixture-owner-password');
	// Better Auth bounds repeated sign-ins from this shared loopback client.
	await new Promise((resolve) => setTimeout(resolve, 11000));
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page.waitForURL(base + '/account').catch(async (error) => {
		console.error('Reauth failure', page.url(), await page.locator('body').innerText());
		throw error;
	});
	assert.equal(
		(await (await call(owner, 'account', 'getAccess', undefined, true)).json()).resetLinks.recent,
		true
	);
	assert.deepEqual(errors, []);
	await page.close();
	await anonymous.close();
	await recipient.close();
	await new Promise((resolve) => setTimeout(resolve, 11000));
}
