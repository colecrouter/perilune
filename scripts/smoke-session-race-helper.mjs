import { appRequest, remoteEndpoint } from './smoke-remote-helper.mjs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const sessionCookie = async (context) =>
	(await context.cookies()).find((cookie) => cookie.name.endsWith('.session_token'))?.value;
// Reorders real browser response delivery; no production delay hook is needed.
export async function testSessionCookieOrdering(owner, base, filename) {
	const browser = owner.browser();
	for (const replacement of ['login', 'pairing']) {
		const device = await browser.newContext();
		let createdCookie, release;
		try {
			await device.addCookies(await owner.cookies());
			const page = await device.newPage();
			await page.goto(base + '/health');
			const db = new DatabaseSync(filename);
			db.prepare('UPDATE session SET expiresAt=?').run(Date.now() + 5 * 86400_000);
			db.close();
			let ready;
			const captured = new Promise((r) => (ready = r)),
				held = new Promise((r) => (release = r));
			let renewalCookie = false;
			const heldEndpoint = remoteEndpoint('integrations', 'getIntegrations') + '?held=1';
			await page.route('**' + heldEndpoint, async (route) => {
				const response = await route.fetch();
				renewalCookie = !!response.headers()['set-cookie'];
				ready();
				await held;
				await route.fulfill({ response });
			});
			const delayed = page.evaluate(async (path) => {
				const r = await fetch(path);
				return r.status;
			}, heldEndpoint);
			await captured;
			const prior = await sessionCookie(device);
			if (replacement === 'login') {
				const r = await appRequest(device.request, 'POST', base + '/api/auth/sign-in/email', {
					headers: { Origin: base },
					data: { email: 'owner@example.test', password: 'fixture-owner-password' }
				});
				assert.equal(r.status(), 200);
			} else {
				const grant = await (
					await appRequest(device.request, 'POST', base + '/api/pairing/start', {
						headers: { Origin: base },
						data: { name: 'Race fixture' }
					})
				).json();
				const approved = await appRequest(owner.request, 'POST', base + '/api/pairing/approve', {
					headers: { Origin: base },
					data: { code: grant.code, approve: true }
				});
				assert.equal(approved.status(), 200);
				const redeemed = await appRequest(device.request, 'POST', base + '/api/pairing/poll', {
					headers: { Origin: base },
					data: { token: grant.token }
				});
				assert.equal(redeemed.status(), 200);
			}
			const installed = await sessionCookie(device);
			assert.notEqual(installed, prior);
			createdCookie = (await device.cookies()).find((cookie) =>
				cookie.name.endsWith('.session_token')
			);
			release();
			assert.equal(await delayed, 200);
			const overwritten = (await sessionCookie(device)) !== installed;
			console.log(
				JSON.stringify({
					replacement,
					oldResponseRenewedCookie: renewalCookie,
					newSessionOverwritten: overwritten,
					independentOwnerSessionStillValid:
						(await appRequest(owner.request, 'GET', base + '/api/account/browsers')).status() ===
						200
				})
			);
			assert.equal(overwritten, false, 'A delayed old response must not replace the new session');
			assert.equal(renewalCookie, false);
			assert.equal(
				(await appRequest(owner.request, 'GET', base + '/api/account/browsers')).status(),
				200
			);
		} finally {
			release?.();
			if (createdCookie) {
				const signedOut = await appRequest(device.request, 'POST', base + '/api/auth/sign-out', {
					headers: { Origin: base, Cookie: createdCookie.name + '=' + createdCookie.value }
				});
				assert.equal(signedOut.status(), 200);
			}
			await device.close();
		}
	}
	console.log(
		'Session ordering smoke passed: delayed old reads cannot replace login or pairing, independent sessions remain valid.'
	);
}
