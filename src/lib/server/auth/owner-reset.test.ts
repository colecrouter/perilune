import { expect, it } from 'vite-plus/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyPassword } from 'better-auth/crypto';
import { createAuthService, digest } from './service.js';
const origin = 'http://localhost:4181',
	password = 'original-account-password';
let client = 100;
async function fixture(verifier?: (data: { hash: string; password: string }) => Promise<boolean>) {
	const directory = mkdtempSync(join(tmpdir(), 'perilune-owner-reset-'));
	const service = createAuthService(
		join(directory, 'auth.sqlite'),
		origin,
		undefined,
		verifier,
		false
	);
	service.db
		.prepare('INSERT INTO enrollment VALUES(?,?,?,?,NULL,?)')
		.run(digest('setup'), 'owner', 'setup', Date.now() + 60000, Date.now());
	await service.enroll({ token: 'setup', name: 'Owner', email: 'owner@example.test', password });
	const actorId = String(service.accounts()[0].id);
	const invite = service.invite(actorId, 'operator');
	await service.enroll({
		token: invite.split('#')[1],
		name: 'Operator',
		email: 'operator@example.test',
		password
	});
	const target = String(service.accounts().find((row) => row.role === 'operator')!.id);
	async function login(email: string) {
		const response = await service.handle(
			new Request(origin + '/api/auth/sign-in/email', {
				method: 'POST',
				headers: {
					origin,
					'content-type': 'application/json',
					'x-perilune-client-ip': `192.0.2.${client++}`
				},
				body: JSON.stringify({ email, password })
			})
		);
		expect(response.status).toBe(200);
		const cookie = response.headers
			.getSetCookie()
			.map((value) => value.split(';')[0])
			.join('; ');
		const identity = await service.identity(new Headers({ cookie }));
		expect(identity).toBeTruthy();
		return identity!;
	}
	const actor = await login('owner@example.test');
	return {
		service,
		target,
		actor,
		login,
		close() {
			service.close();
			rmSync(directory, { recursive: true, force: true });
		}
	};
}
it('issues a private one-time link without SMTP and only changes browser credentials on redemption', async () => {
	const f = await fixture();
	try {
		const targetSession = await f.login('operator@example.test');
		f.service.db
			.prepare(
				'INSERT INTO passkey(id,publicKey,userId,credentialID,counter,deviceType,backedUp) VALUES(?,?,?,?,?,?,?)'
			)
			.run('key', 'fixture', f.target, 'credential', 0, 'singleDevice', 0);
		const before = f.service.db
			.prepare('SELECT authVersion,loginVersion,emailVerified FROM user WHERE id=?')
			.get(f.target)!;
		const link = f.service.createOwnerReset(f.actor, f.target, true),
			token = link.url.split('#')[1];
		expect(f.service.valid(targetSession)).toBeTruthy();
		expect(
			f.service.db
				.prepare('SELECT authVersion,loginVersion,emailVerified FROM user WHERE id=?')
				.get(f.target)
		).toEqual(before);
		expect(
			await verifyPassword({
				hash: String(
					f.service.db.prepare('SELECT password FROM account WHERE userId=?').get(f.target)!
						.password
				),
				password
			})
		).toBe(true);
		const summary = JSON.stringify(f.service.ownerResetStatus(f.actor));
		expect(summary).not.toContain(token);
		expect(summary).not.toContain(digest(token));
		expect(JSON.stringify(f.service.db.prepare('SELECT * FROM auth_audit').all())).not.toContain(
			token
		);
		await f.service.resetPassword(token, 'replacement-password');
		expect(f.service.valid(targetSession)).toBeFalsy();
		expect(f.service.valid(f.actor)).toBeTruthy();
		expect(
			f.service.db
				.prepare('SELECT authVersion,loginVersion,emailVerified FROM user WHERE id=?')
				.get(f.target)
		).toEqual({ ...before, loginVersion: Number(before.loginVersion) + 1 });
		expect(
			f.service.db.prepare('SELECT count(*) AS n FROM passkey WHERE userId=?').get(f.target)?.n
		).toBe(1);
		expect(f.service.ownerResetStatus(f.actor).links[0].status).toBe('redeemed');
		await expect(f.service.resetPassword(token, 'another-password')).rejects.toThrow('invalid');
		expect(
			f.service.db
				.prepare("SELECT subject FROM auth_audit WHERE event='owner-reset.redemption-denied'")
				.get()?.subject
		).toBe(f.target);
	} finally {
		f.close();
	}
});
it('requires explicit confirmation and actual recent owner sign-in, excluding paired sessions', async () => {
	const f = await fixture();
	try {
		expect(() => f.service.createOwnerReset(f.actor, f.target, false)).toThrow('Confirm');
		const viewer = await f.login('operator@example.test');
		expect(() => f.service.createOwnerReset(viewer, f.target, true)).toThrow('Owner access');
		expect(() => f.service.createOwnerReset(f.actor, f.actor.user.id, true)).toThrow(
			'active operator or viewer'
		);
		for (const created of [Date.now() - 11 * 60000, Date.now() + 60000]) {
			f.service.db
				.prepare('UPDATE session SET createdAt=? WHERE id=?')
				.run(created, f.actor.session.id);
			expect(f.service.ownerResetStatus(f.actor).recent).toBe(false);
			expect(() => f.service.createOwnerReset(f.actor, f.target, true)).toThrow('Sign in again');
		}
		f.service.db
			.prepare('UPDATE session SET createdAt=? WHERE id=?')
			.run(Date.now(), f.actor.session.id);
		f.service.db
			.prepare('INSERT INTO paired_browser VALUES(?,?,?,NULL)')
			.run(f.actor.session.id, 'Paired owner', Date.now());
		expect(() => f.service.createOwnerReset(f.actor, f.target, true)).toThrow('Sign in again');
	} finally {
		f.close();
	}
});
it('supersedes and revokes unused links while preserving target sessions and throttling history', async () => {
	const f = await fixture();
	try {
		const session = await f.login('operator@example.test');
		const first = f.service.createOwnerReset(f.actor, f.target, true),
			second = f.service.createOwnerReset(f.actor, f.target, true);
		await expect(
			f.service.resetPassword(first.url.split('#')[1], 'replacement-password')
		).rejects.toThrow('invalid');
		f.service.revokeOwnerReset(f.actor, second.id);
		await expect(
			f.service.resetPassword(second.url.split('#')[1], 'replacement-password')
		).rejects.toThrow('invalid');
		expect(f.service.valid(session)).toBeTruthy();
		for (let i = 0; i < 3; i++) {
			const link = f.service.createOwnerReset(f.actor, f.target, true);
			f.service.revokeOwnerReset(f.actor, link.id);
		}
		expect(() => f.service.createOwnerReset(f.actor, f.target, true)).toThrow('Wait before');
		expect(
			f.service.db
				.prepare("SELECT event FROM auth_audit WHERE event='owner-reset.superseded'")
				.all()
		).toHaveLength(1);
	} finally {
		f.close();
	}
});
it.each([
	'expiry',
	'target email',
	'target epoch',
	'target owner',
	'target recovery',
	'issuer epoch',
	'issuer login',
	'issuer role',
	'issuer recovery'
] as const)('rejects redemption after %s changes', async (change) => {
	const f = await fixture();
	try {
		const link = f.service.createOwnerReset(f.actor, f.target, true);
		switch (change) {
			case 'expiry':
				f.service.db.prepare('UPDATE owner_reset_links SET expires=0 WHERE id=?').run(link.id);
				break;
			case 'target email':
				f.service.db.prepare("UPDATE user SET email='new@example.test' WHERE id=?").run(f.target);
				break;
			case 'target epoch':
				f.service.db.prepare('UPDATE user SET authVersion=authVersion+1 WHERE id=?').run(f.target);
				break;
			case 'target owner':
				f.service.db.prepare("UPDATE user SET role='owner' WHERE id=?").run(f.target);
				break;
			case 'target recovery':
				f.service.db.prepare('UPDATE account SET password=NULL WHERE userId=?').run(f.target);
				break;
			case 'issuer epoch':
				f.service.db
					.prepare('UPDATE user SET authVersion=authVersion+1 WHERE id=?')
					.run(f.actor.user.id);
				break;
			case 'issuer login':
				f.service.db
					.prepare('UPDATE user SET loginVersion=loginVersion+1 WHERE id=?')
					.run(f.actor.user.id);
				break;
			case 'issuer role':
				f.service.db.prepare("UPDATE user SET role='operator' WHERE id=?").run(f.actor.user.id);
				break;
			case 'issuer recovery':
				f.service.db
					.prepare('UPDATE account SET password=NULL WHERE userId=?')
					.run(f.actor.user.id);
				break;
		}
		await expect(
			f.service.resetPassword(link.url.split('#')[1], 'replacement-password')
		).rejects.toThrow('invalid');
	} finally {
		f.close();
	}
});
it('allows only one concurrent redemption and rechecks revocation after password hashing', async () => {
	const f = await fixture();
	try {
		const link = f.service.createOwnerReset(f.actor, f.target, true);
		const results = await Promise.allSettled([
			f.service.resetPassword(link.url.split('#')[1], 'first-new-password'),
			f.service.resetPassword(link.url.split('#')[1], 'second-new-password')
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const next = f.service.createOwnerReset(f.actor, f.target, true);
		const pending = f.service.resetPassword(next.url.split('#')[1], 'third-new-password');
		f.service.revokeOwnerReset(f.actor, next.id);
		await expect(pending).rejects.toThrow('invalid');
	} finally {
		f.close();
	}
});
it('fences an old-password sign-in that was verifying while owner-assisted redemption committed', async () => {
	let pause = false,
		release!: () => void,
		entered!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve)),
		started = new Promise<void>((resolve) => (entered = resolve));
	const f = await fixture(async (data) => {
		if (pause) {
			entered();
			await held;
		}
		return verifyPassword(data);
	});
	try {
		const link = f.service.createOwnerReset(f.actor, f.target, true);
		pause = true;
		const login = f.service.handle(
			new Request(origin + '/api/auth/sign-in/email', {
				method: 'POST',
				headers: {
					origin,
					'content-type': 'application/json',
					'x-perilune-client-ip': `192.0.2.${client++}`
				},
				body: JSON.stringify({ email: 'operator@example.test', password })
			})
		);
		await started;
		await f.service.resetPassword(link.url.split('#')[1], 'replacement-password');
		release();
		expect((await login).ok).toBe(false);
		expect(
			f.service.db.prepare('SELECT count(*) AS n FROM session WHERE userId=?').get(f.target)?.n
		).toBe(0);
	} finally {
		release();
		f.close();
	}
});
