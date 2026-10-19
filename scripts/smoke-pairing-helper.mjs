import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';

export async function testPairing(owner, base, directory, filename) {
	const approver = await owner.newPage();
	const keyResponse = await owner.request.post(`${base}/api/jobs/key`, {
		headers: { Origin: base },
		data: { name: 'Pairing integration' }
	});
	assert.equal(keyResponse.status(), 200);
	const integration = await keyResponse.json();
	let device = await chromium.launchPersistentContext(join(directory, 'paired-browser'), {
		headless: true,
		viewport: { width: 320, height: 844 }
	});
	try {
		let page = await device.newPage();
		await page.goto(`${base}/login`);
		await page.getByRole('link', { name: 'Sign in with another browser' }).click();
		await page.getByRole('button', { name: 'Get pairing code' }).click();
		const code = await page.locator('.code').innerText();
		assert.match(code, /^[0-9A-F]{10}$/);
		assert.equal(
			await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
			false
		);
		await page.screenshot({ path: 'test-results/pairing-mobile.png', fullPage: true });
		// Poll traffic and approval share an address. Waiting devices must not lock approval out.
		for (let i = 0; i < 45; i++) {
			const response = await device.request.post(`${base}/api/pairing/poll`, {
				headers: { Origin: base },
				data: { token: 'A'.repeat(43) }
			});
			assert.equal(response.status(), 400);
		}
		await approver.goto(`${base}/pair`);
		await approver.getByLabel('Pairing code').fill(code);
		await approver.getByRole('button', { name: 'Check code' }).click();
		await approver.getByRole('heading', { name: 'My browser' }).waitFor();
		await approver
			.getByLabel('Link to an integration', { exact: true })
			.selectOption(integration.key.id);
		await approver.getByRole('button', { name: 'Approve browser' }).click();
		await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
		const cookies = await device.cookies();
		const cookie = cookies.find((cookie) => cookie.name.endsWith('.session_token'));
		assert.ok(cookie?.httpOnly);
		assert.ok(cookie.expires > Date.now() / 1000 + 89 * 86400);
		await device.close();
		device = await chromium.launchPersistentContext(join(directory, 'paired-browser'), {
			headless: true
		});
		page = await device.newPage();
		await page.goto(base);
		await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
		const browsers = (await (await owner.request.get(`${base}/api/account/browsers`)).json())
			.browsers;
		assert.equal(browsers.length, 1);
		assert.equal(browsers[0].integrationId, integration.key.id);
		assert.equal(browsers[0].current, false);
		const deviceBrowsers = await (await device.request.get(base + '/api/account/browsers')).json();
		assert.equal(deviceBrowsers.browsers[0].current, true);
		const db = new DatabaseSync(filename);
		try {
			// Age the fixed-lifetime session; ordinary reads must not renew its cookie.
			db.prepare('UPDATE session SET expiresAt=? WHERE id=?').run(
				Date.now() + 5 * 86400_000,
				browsers[0].id
			);
		} finally {
			db.close();
		}
		const renewed = await device.request.get(`${base}/api/account/browsers`);
		assert.equal(renewed.status(), 200);
		assert.equal(renewed.headers()['set-cookie'], undefined);
		const expiryDb = new DatabaseSync(filename);
		try {
			assert.ok(
				Number(
					expiryDb.prepare('SELECT expiresAt FROM session WHERE id=?').get(browsers[0].id).expiresAt
				) <
					Date.now() + 6 * 86400_000
			);
		} finally {
			expiryDb.close();
		}
		const revoked = await owner.request.post(`${base}/api/account/revoke-browser`, {
			headers: { Origin: base },
			data: { id: browsers[0].id }
		});
		assert.equal(revoked.status(), 200);
		assert.equal((await device.request.get(`${base}/api/account/browsers`)).status(), 401);
		// Isolate cookie replacement from the Overview's background requests.
		// This subcase deliberately injects/ages another login; delayed renewals from
		// that page must not race the API-only redemption and revocation assertions.
		await device.close();
		device = await chromium.launchPersistentContext(join(directory, 'paired-browser'), {
			headless: true
		});
		const secondGrant = await (
			await device.request.post(`${base}/api/pairing/start`, {
				headers: { Origin: base },
				data: { name: 'Linked browser' }
			})
		).json();
		await owner.request.post(`${base}/api/pairing/approve`, {
			headers: { Origin: base },
			data: { code: secondGrant.code, approve: true, integrationId: integration.key.id }
		});
		await device.addCookies(await owner.cookies());
		const oldCookie = (await device.cookies()).find((cookie) =>
			cookie.name.endsWith('.session_token')
		);
		const ageDb = new DatabaseSync(filename);
		try {
			ageDb
				.prepare(
					'UPDATE session SET expiresAt=? WHERE id NOT IN (SELECT session_id FROM paired_browser)'
				)
				.run(Date.now() + 5 * 86400_000);
		} finally {
			ageDb.close();
		}
		const redeemed = await device.request.post(`${base}/api/pairing/poll`, {
			headers: { Origin: base },
			data: { token: secondGrant.token }
		});
		assert.equal(redeemed.status(), 200);
		const redeemedCookie = (await device.cookies()).find((cookie) =>
			cookie.name.endsWith('.session_token')
		);
		assert.notEqual(redeemedCookie.value, oldCookie.value);
		assert.equal(
			(
				await owner.request.post(`${base}/api/account/disconnect-integration`, {
					headers: { Origin: base },
					data: { id: integration.key.id }
				})
			).status(),
			200
		);
		assert.equal(
			(await device.cookies()).find((cookie) => cookie.name.endsWith('.session_token')).value,
			redeemedCookie.value
		);
		assert.equal((await device.request.get(`${base}/api/account/browsers`)).status(), 401);
		assert.equal(
			(await fetch(`${base}/server/info`, { headers: { 'X-Api-Key': integration.token } })).status,
			401
		);
		// A pending code can be cancelled durably.
		const start = await device.request.post(`${base}/api/pairing/start`, {
			headers: { Origin: base },
			data: { name: 'Cancelled browser' }
		});
		const grant = await start.json();
		assert.equal(
			(
				await device.request.post(`${base}/api/pairing/cancel`, {
					headers: { Origin: base },
					data: { token: grant.token }
				})
			).status(),
			200
		);
		assert.equal(
			(
				await owner.request.post(`${base}/api/pairing/approve`, {
					headers: { Origin: base },
					data: { code: grant.code, approve: true }
				})
			).status(),
			400
		);
		assert.equal(
			(
				await device.request.post(`${base}/api/pairing/start`, {
					headers: { Origin: 'https://example.invalid' },
					data: { name: 'Blocked' }
				})
			).status(),
			403
		);
		console.log(
			'Pairing smoke passed: two-browser approval, shared-IP polling, persistent browser restart, fixed session expiry, revocation, cancellation, origin checks, 320px layout.'
		);
	} finally {
		await device.close();
		await approver.close();
	}
}
