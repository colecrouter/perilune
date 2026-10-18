import { execFileSync, spawnSync } from 'node:child_process';
import { verifyPassword } from 'better-auth/crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vite-plus/test';
import { createAuthService, digest } from './service.js';

const origin = 'http://localhost:4181';
const password = 'fixture-account-password';
function fixture(verifier?: (data: { hash: string; password: string }) => Promise<boolean>) {
	const directory = mkdtempSync(join(tmpdir(), 'perilune-auth-'));
	const service = createAuthService(join(directory, 'auth.sqlite'), origin, undefined, verifier);
	const setup = (token = 'setup-fixture') =>
		service.db
			.prepare('INSERT INTO enrollment VALUES (?,?,?,?,NULL,?)')
			.run(digest(token), 'owner', 'setup', Date.now() + 60000, Date.now());
	const close = () => {
		service.close();
		rmSync(directory, { recursive: true, force: true });
	};
	return { service, setup, close, filename: join(directory, 'auth.sqlite') };
}
let loginClient = 1;
async function login(service: ReturnType<typeof createAuthService>, email: string) {
	const response = await service.auth.handler(
		new Request(`${origin}/api/auth/sign-in/email`, {
			method: 'POST',
			headers: {
				Origin: origin,
				'Content-Type': 'application/json',
				'x-perilune-client-ip': `192.0.2.${loginClient++}`
			},
			body: JSON.stringify({ email, password })
		})
	);
	expect(response.status).toBe(200);
	const headers = new Headers({
		cookie: response.headers
			.getSetCookie()
			.map((cookie) => cookie.split(';')[0])
			.join('; ')
	});
	const identity = await service.identity(headers);
	expect(identity).toBeTruthy();
	return identity!;
}
describe('local authentication', () => {
	it('shows CLI help without opening a database and reports invalid usage cleanly', () => {
		const directory = mkdtempSync(join(tmpdir(), 'perilune-cli-help-'));
		const filename = join(directory, 'auth.sqlite');
		try {
			const env = { ...process.env, PERILUNE_DATABASE: filename };
			for (const args of [[], ['--help'], ['-h']]) {
				const result = spawnSync(process.execPath, ['scripts/auth.mjs', ...args], {
					env,
					encoding: 'utf8'
				});
				expect(result.status).toBe(0);
				expect(result.stdout).toContain('node scripts/auth.mjs setup');
				expect(result.stderr).toBe('');
				expect(existsSync(filename)).toBe(false);
			}
			const invalid = spawnSync(process.execPath, ['scripts/auth.mjs', 'unknown'], {
				env,
				encoding: 'utf8'
			});
			expect(invalid.status).toBe(1);
			expect(invalid.stderr).toContain('Unknown command: unknown');
			expect(invalid.stderr).not.toContain('ModuleJob');
			expect(existsSync(filename)).toBe(false);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
	it('allows setup token reissue before enrollment and refuses it cleanly afterward', async () => {
		const f = fixture();
		try {
			const env = { ...process.env, PERILUNE_DATABASE: f.filename };
			const first = spawnSync(process.execPath, ['scripts/auth.mjs', 'setup'], {
				env,
				encoding: 'utf8'
			});
			const second = spawnSync(process.execPath, ['scripts/auth.mjs', 'setup'], {
				env,
				encoding: 'utf8'
			});
			expect(first.status).toBe(0);
			expect(second.status).toBe(0);
			const oldToken = first.stdout.trim().split('\n').at(-1)!;
			const token = second.stdout.trim().split('\n').at(-1)!;
			expect(token).not.toBe(oldToken);
			await expect(
				f.service.enroll({ token: oldToken, name: 'Owner', email: 'owner@example.test', password })
			).rejects.toThrow();
			await f.service.enroll({ token, name: 'Owner', email: 'owner@example.test', password });
			const refused = spawnSync(process.execPath, ['scripts/auth.mjs', 'setup'], {
				env,
				encoding: 'utf8'
			});
			expect(refused.status).toBe(1);
			expect(refused.stderr.trim()).toBe(
				'Perilune: Setup is closed. Use recovery for an existing installation.'
			);
			expect(f.service.accounts()).toHaveLength(1);
		} finally {
			f.close();
		}
	});

	it('blocks public signup and server-only role injection', async () => {
		const f = fixture();
		try {
			const response = await f.service.auth.handler(
				new Request(`${origin}/api/auth/sign-up/email`, {
					method: 'POST',
					headers: { Origin: origin, 'Content-Type': 'application/json' },
					body: JSON.stringify({
						name: 'Intruder',
						email: 'intruder@example.test',
						password,
						role: 'owner'
					})
				})
			);
			expect(response.status).toBe(403);
			expect(f.service.accounts()).toHaveLength(0);
			await expect(
				f.service.auth.api.signUpEmail({
					body: { name: 'Intruder', email: 'intruder@example.test', password }
				})
			).rejects.toThrow();
		} finally {
			f.close();
		}
	});
	it('admits one owner in a concurrent setup race and closes setup', async () => {
		const f = fixture();
		try {
			f.setup('setup-fixture-1');
			f.setup('setup-fixture-2');
			const result = await Promise.allSettled(
				[1, 2].map((i) =>
					f.service.enroll({
						token: `setup-fixture-${i}`,
						name: 'Owner',
						email: `owner${i}@example.test`,
						password
					})
				)
			);
			expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			expect(f.service.accounts()).toHaveLength(1);
			expect(f.service.needsSetup()).toBe(false);
			f.setup('new-setup');
			await expect(
				f.service.enroll({
					token: 'new-setup',
					name: 'Owner',
					email: 'owner3@example.test',
					password
				})
			).rejects.toThrow();
		} finally {
			f.close();
		}
	});
	it('enforces expiring single-use invitations and the invited role', async () => {
		const f = fixture();
		try {
			f.setup();
			await f.service.enroll({
				token: 'setup-fixture',
				name: 'Owner',
				email: 'owner@example.test',
				password
			});
			const link = f.service.invite('fixture', 'viewer');
			const token = new URL(link).hash.slice(1);
			await f.service.enroll({ token, name: 'Viewer', email: 'viewer@example.test', password });
			expect(f.service.accounts().find((user) => user.email === 'viewer@example.test')?.role).toBe(
				'viewer'
			);
			await expect(
				f.service.enroll({ token, name: 'Again', email: 'again@example.test', password })
			).rejects.toThrow();
			const expired = new URL(f.service.invite('fixture', 'operator')).hash.slice(1);
			f.service.db.prepare('UPDATE enrollment SET expires=0 WHERE hash=?').run(digest(expired));
			await expect(
				f.service.enroll({
					token: expired,
					name: 'Expired',
					email: 'expired@example.test',
					password
				})
			).rejects.toThrow();
		} finally {
			f.close();
		}
	});
	it('rejects an old login that finishes after recovery and password reset', async () => {
		const started = Promise.withResolvers<void>();
		const gate = Promise.withResolvers<void>();
		const f = fixture(async (data) => {
			started.resolve();
			await gate.promise;
			return verifyPassword(data);
		});
		try {
			f.setup();
			await f.service.enroll({
				token: 'setup-fixture',
				name: 'Owner',
				email: 'owner@example.test',
				password
			});
			const login = f.service.auth.api.signInEmail({
				body: { email: 'owner@example.test', password }
			});
			const outcome = login.then(
				() => false,
				() => true
			);
			await started.promise;
			const output = execFileSync(
				process.execPath,
				['scripts/auth.mjs', 'recover', 'owner@example.test', '--server-stopped'],
				{
					env: { ...process.env, PERILUNE_DATABASE: f.filename, PERILUNE_ORIGIN: origin },
					encoding: 'utf8'
				}
			);
			const token = output.trim().split('\n').at(-1)!.split('#reset=')[1]!;
			await f.service.auth.api.resetPassword({
				body: { token, newPassword: 'changed-owner-password' }
			});
			gate.resolve();
			expect(await outcome).toBe(true);
			expect(f.service.db.prepare('SELECT count(*) AS count FROM session').get()?.count).toBe(0);
		} finally {
			gate.resolve();
			f.close();
		}
	});
	it('revokes active leases on logout, expiry and account removal', async () => {
		const f = fixture();
		try {
			f.setup();
			await f.service.enroll({
				token: 'setup-fixture',
				name: 'Owner',
				email: 'owner@example.test',
				password
			});
			const owner = await login(f.service, 'owner@example.test');
			const lease = f.service.watch(owner);
			expect(lease.signal.aborted).toBe(false);
			f.service.db.prepare('DELETE FROM session WHERE id=?').run(owner.session.id);
			f.service.sweep();
			expect(lease.signal.aborted).toBe(true);
			lease.release();
			const next = await login(f.service, 'owner@example.test');
			const expiry = f.service.watch(next);
			f.service.db.prepare('UPDATE session SET expiresAt=0 WHERE id=?').run(next.session.id);
			f.service.sweep();
			expect(expiry.signal.aborted).toBe(true);
			expiry.release();
			const token = new URL(f.service.invite(owner.user.id, 'operator')).hash.slice(1);
			await f.service.enroll({ token, name: 'Operator', email: 'operator@example.test', password });
			const operator = await login(f.service, 'operator@example.test');
			const active = f.service.watch(operator);
			f.service.revokeAccount(owner.user.id, operator.user.id);
			expect(active.signal.aborted).toBe(true);
			active.release();
			expect(() => f.service.revokeAccount(owner.user.id, owner.user.id)).toThrow();
		} finally {
			f.close();
		}
	});
});

describe('browser pairing', () => {
	it('requires explicit approval, issues a persistent normal session once, and revokes it independently', async () => {
		const f = fixture();
		try {
			f.setup();
			await f.service.enroll({
				token: 'setup-fixture',
				name: 'Owner',
				email: 'pair@example.test',
				password
			});
			const owner = await login(f.service, 'pair@example.test');
			const grant = f.service.startPairing('Desktop slicer');
			expect(await f.service.redeemPairing(grant.token)).toBeNull();
			expect(f.service.pairingRequest(grant.code)?.name).toBe('Desktop slicer');
			f.service.approvePairing(owner, grant.code, true);
			expect(() => f.service.approvePairing(owner, grant.code, true)).toThrow();
			const cookie = await f.service.redeemPairing(grant.token);
			expect(cookie?.attributes.httpOnly).toBe(true);
			expect(cookie?.attributes.maxAge).toBe(90 * 86400);
			const headers = new Headers({
				cookie: `${cookie!.name}=${encodeURIComponent(cookie!.value)}`
			});
			const paired = await f.service.identity(headers);
			expect(paired?.user.id).toBe(owner.user.id);
			expect(f.service.valid(paired!)).toBeTruthy();
			expect(f.service.browsers(owner.user.id)).toHaveLength(1);
			await expect(f.service.redeemPairing(grant.token)).rejects.toThrow();
			f.service.revokeBrowser('another-user', paired!.session.id);
			expect(f.service.valid(paired!)).toBeTruthy();
			const watcher = f.service.watch(paired!);
			f.service.revokeBrowser(owner.user.id, paired!.session.id);
			expect(watcher.signal.aborted).toBe(true);
			expect(f.service.valid(paired!)).toBeFalsy();
			expect(f.service.valid(owner)).toBeTruthy();
			watcher.release();
		} finally {
			f.close();
		}
	});
	it('rejects denied, expired and recovery-invalidated grants', async () => {
		const f = fixture();
		try {
			f.setup();
			await f.service.enroll({
				token: 'setup-fixture',
				name: 'Owner',
				email: 'pair@example.test',
				password
			});
			const owner = await login(f.service, 'pair@example.test');
			const denied = f.service.startPairing('Denied');
			f.service.approvePairing(owner, denied.code, false);
			await expect(f.service.redeemPairing(denied.token)).rejects.toThrow();
			const expired = f.service.startPairing('Expired');
			f.service.db.prepare('UPDATE browser_pairing SET expires=0 WHERE code=?').run(expired.code);
			expect(() => f.service.approvePairing(owner, expired.code, true)).toThrow();
			await expect(f.service.redeemPairing(expired.token)).rejects.toThrow();
			const recovered = f.service.startPairing('Recovered');
			f.service.approvePairing(owner, recovered.code, true);
			f.service.db
				.prepare('UPDATE user SET authVersion=authVersion+1 WHERE id=?')
				.run(owner.user.id);
			await expect(f.service.redeemPairing(recovered.token)).rejects.toThrow();
			await expect(f.service.redeemPairing(recovered.token)).rejects.toThrow();
		} finally {
			f.close();
		}
	});
});

it('cancels an approved grant while session creation is in flight and revokes a redeemed grant', async () => {
	const f = fixture();
	try {
		f.setup();
		await f.service.enroll({
			token: 'setup-fixture',
			name: 'Owner',
			email: 'cancel@example.test',
			password
		});
		const owner = await login(f.service, 'cancel@example.test');
		const grant = f.service.startPairing('Cancelled');
		f.service.approvePairing(owner, grant.code, true);
		const redemption = f.service.redeemPairing(grant.token);
		f.service.cancelPairing(grant.token);
		await expect(redemption).rejects.toThrow('cancelled');
		expect(f.service.browsers(owner.user.id)).toHaveLength(0);
		const second = f.service.startPairing('Redeemed');
		f.service.approvePairing(owner, second.code, true);
		await f.service.redeemPairing(second.token);
		f.service.cancelPairing(second.token);
		expect(f.service.browsers(owner.user.id)).toHaveLength(0);
	} finally {
		f.close();
	}
});

describe('fixed-lifetime authentication cookie ordering', () => {
	it('does not renew ordinary reads or auth session reads and cannot clear a newer login on delayed sign-out', async () => {
		const f = fixture();
		try {
			f.setup();
			await f.service.enroll({
				token: 'setup-fixture',
				name: 'Owner',
				email: 'owner@example.test',
				password
			});
			const old = await login(f.service, 'owner@example.test');
			const { makeSignature } = await import('better-auth/crypto');
			const secret = (await import('node:fs'))
				.readFileSync(f.filename + '.auth-secret', 'utf8')
				.trim();
			const cookie =
				'better-auth.session_token=' +
				encodeURIComponent(
					old.session.token + '.' + (await makeSignature(old.session.token, secret))
				);
			const expiry = Date.now() + 5 * 86400_000;
			f.service.db.prepare('UPDATE session SET expiresAt=? WHERE id=?').run(expiry, old.session.id);
			const ordinary = await f.service.resolveIdentity(new Headers({ cookie }));
			expect(ordinary.headers.getSetCookie()).toEqual([]);
			expect(
				f.service.db.prepare('SELECT expiresAt FROM session WHERE id=?').get(old.session.id)
					?.expiresAt
			).toBe(expiry);
			const read = await f.service.handle(
				new Request(origin + '/api/auth/get-session', { headers: { cookie } })
			);
			expect(read.status).toBe(200);
			expect(read.headers.getSetCookie()).toEqual([]);
			const newer = await login(f.service, 'owner@example.test');
			const signout = await f.service.handle(
				new Request(origin + '/api/auth/sign-out', {
					method: 'POST',
					headers: { cookie, Origin: origin }
				})
			);
			expect(signout.status).toBe(200);
			expect(signout.headers.getSetCookie()).toEqual([]);
			expect(f.service.valid(newer)).toBe(true);
			expect(f.service.valid(old)).toBeFalsy();
		} finally {
			f.close();
		}
	});
	it('suppresses expired-session cleanup cookies while keeping fresh session issuance', async () => {
		const f = fixture();
		try {
			f.setup();
			await f.service.enroll({
				token: 'setup-fixture',
				name: 'Owner',
				email: 'owner@example.test',
				password
			});
			const response = await f.service.handle(
				new Request(origin + '/api/auth/sign-in/email', {
					method: 'POST',
					headers: {
						Origin: origin,
						'Content-Type': 'application/json',
						'x-perilune-client-ip': '192.0.2.240'
					},
					body: JSON.stringify({ email: 'owner@example.test', password })
				})
			);
			expect(response.status).toBe(200);
			expect(
				response.headers.getSetCookie().some((cookie) => /Max-Age=7776000/i.test(cookie))
			).toBe(true);
			const cookie = response.headers
				.getSetCookie()
				.map((cookie) => cookie.split(';')[0])
				.join('; ');
			f.service.db.prepare('UPDATE session SET expiresAt=0').run();
			const expired = await f.service.handle(
				new Request(origin + '/api/auth/get-session', { headers: { cookie } })
			);
			expect(await expired.json()).toBeNull();
			expect(expired.headers.getSetCookie()).toEqual([]);
			const ordinary = await f.service.resolveIdentity(new Headers({ cookie }));
			expect(ordinary.response).toBeNull();
			expect(ordinary.headers.getSetCookie()).toEqual([]);
		} finally {
			f.close();
		}
	});
});
