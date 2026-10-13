import { execFileSync } from 'node:child_process';
import { verifyPassword } from 'better-auth/crypto';
import { mkdtempSync, rmSync } from 'node:fs';
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
async function login(service: ReturnType<typeof createAuthService>, email: string) {
	const response = await service.auth.handler(
		new Request(`${origin}/api/auth/sign-in/email`, {
			method: 'POST',
			headers: { Origin: origin, 'Content-Type': 'application/json' },
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
