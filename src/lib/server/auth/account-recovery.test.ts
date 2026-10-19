import { expect, it } from 'vite-plus/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyPassword } from 'better-auth/crypto';
import { createAuthService, digest } from './service.js';
const origin = 'http://localhost:4181',
	password = 'original-account-password';
async function fixture(
	verifier?: (data: { hash: string; password: string }) => Promise<boolean>,
	enabled = true
) {
	const dir = mkdtempSync(join(tmpdir(), 'perilune-reset-')),
		filename = join(dir, 'auth.sqlite');
	const service = createAuthService(filename, origin, undefined, verifier, enabled);
	service.db
		.prepare('INSERT INTO enrollment VALUES(?,?,?,?,NULL,?)')
		.run(digest('setup'), 'owner', 'setup', Date.now() + 60000, Date.now());
	await service.enroll({ token: 'setup', name: 'Owner', email: 'owner@example.test', password });
	const user = service.accounts()[0],
		id = String(user.id);
	const login = () =>
		service.handle(
			new Request(origin + '/api/auth/sign-in/email', {
				method: 'POST',
				headers: { origin, 'content-type': 'application/json' },
				body: JSON.stringify({ email: 'owner@example.test', password })
			})
		);
	const verify = () => {
		service.requestVerification(id);
		const mail = service.claimMail()!;
		expect(mail.to).toBe('owner@example.test');
		const token = mail.text.match(/#([\w-]{43})/)![1];
		service.finishMail(mail.id, 'sent');
		service.verifyEmail(token);
		return token;
	};
	const reset = () => {
		service.requestReset('owner@example.test', 'fixture');
		const mail = service.claimMail()!;
		expect(mail).toBeTruthy();
		const token = mail.text.match(/#([\w-]{43})/)![1];
		service.finishMail(mail.id, 'sent');
		return token;
	};
	return {
		service,
		id,
		filename,
		login,
		verify,
		reset,
		close: () => {
			service.close();
			rmSync(dir, { recursive: true, force: true });
		}
	};
}
it('requires verified email, stores only hashed/encrypted token material and consumes links once', async () => {
	const f = await fixture();
	try {
		f.service.requestReset('owner@example.test', 'fixture');
		expect(f.service.claimMail()).toBeNull();
		const token = f.verify();
		expect(f.service.recoveryStatus(f.id).deliveries).toHaveLength(1);
		expect(f.service.recoveryStatus(f.id).deliveries[0]).toMatchObject({
			kind: 'verify',
			status: 'sent'
		});
		expect(() => f.service.verifyEmail(token)).toThrow();
		const reset = f.reset();
		expect(
			JSON.stringify(f.service.db.prepare('SELECT * FROM account_tokens').all())
		).not.toContain(reset);
		await f.service.resetPassword(reset, 'new-password-for-owner');
		await expect(f.service.resetPassword(reset, 'another-new-password')).rejects.toThrow('invalid');
		expect(f.service.recoveryStatus(f.id).verified).toBe(true);
	} finally {
		f.close();
	}
});
it('commits only one competing reset and preserves passkeys and integration epoch', async () => {
	const f = await fixture();
	try {
		f.verify();
		const token = f.reset(),
			before = f.service.db
				.prepare('SELECT authVersion,loginVersion FROM user WHERE id=?')
				.get(f.id)!;
		const response = await f.login();
		const identity = await f.service.identity(
			new Headers({
				cookie: response.headers
					.getSetCookie()
					.map((c) => c.split(';')[0])
					.join('; ')
			})
		);
		expect(identity).toBeTruthy();
		const grant = f.service.startPairing('Slicer');
		f.service.approvePairing(identity!, grant.code, true);
		f.service.db
			.prepare(
				'INSERT INTO passkey(id,publicKey,userId,credentialID,counter,deviceType,backedUp) VALUES(?,?,?,?,?,?,?)'
			)
			.run('key', 'fixture', f.id, 'credential', 0, 'singleDevice', 0);
		const results = await Promise.allSettled([
			f.service.resetPassword(token, 'new-password-first'),
			f.service.resetPassword(token, 'new-password-second')
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(
			f.service.db.prepare('SELECT authVersion,loginVersion FROM user WHERE id=?').get(f.id)
		).toEqual({ ...before, loginVersion: Number(before.loginVersion) + 1 });
		expect(f.service.db.prepare('SELECT count(*) AS n FROM passkey').get()?.n).toBe(1);
		expect(f.service.valid(identity!)).toBeFalsy();
		await expect(f.service.redeemPairing(grant.token)).rejects.toThrow();
	} finally {
		f.close();
	}
});
it('fences a password login already verifying when the reset commits', async () => {
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	let entered!: () => void;
	const started = new Promise<void>((r) => (entered = r));
	const f = await fixture(async (data) => {
		entered();
		await held;
		return verifyPassword(data);
	});
	try {
		f.verify();
		const token = f.reset();
		const pending = f.login();
		await started;
		await f.service.resetPassword(token, 'new-password-after-race');
		release();
		expect((await pending).ok).toBe(false);
		expect(f.service.db.prepare('SELECT count(*) AS n FROM session').get()?.n).toBe(0);
	} finally {
		release();
		f.close();
	}
});
it('cannot bypass emergency recovery or changed email, and cancels stale queued tokens', async () => {
	const f = await fixture();
	try {
		f.verify();
		const token = f.reset();
		f.service.db.prepare('UPDATE account SET password=NULL WHERE userId=?').run(f.id);
		await expect(f.service.resetPassword(token, 'new-password-bypass')).rejects.toThrow('invalid');
		f.service.requestReset('owner@example.test', 'different');
		expect(f.service.claimMail()).toBeNull();
		f.service.requestVerification(f.id);
		f.service.db.prepare("UPDATE user SET email='changed@example.test' WHERE id=?").run(f.id);
		const mail = f.service.claimMail(); // Eligibility must include current email, not just epochs.
		expect(mail).toBeNull();
	} finally {
		f.close();
	}
});
it('rolls back issuance on a full queue and quarantines interrupted SMTP on restart', async () => {
	const f = await fixture();
	try {
		f.verify();
		const token = f.reset();
		for (let i = 0; i < 100; i++)
			f.service.db
				.prepare('INSERT INTO account_mail VALUES(?,NULL,?,?,?, ?,?,NULL,NULL,NULL,NULL)')
				.run('full' + i, 'test', 'sealed', 'queued', Date.now(), Date.now() + 60000);
		f.service.requestReset('owner@example.test', 'fixture');
		expect(
			f.service.db.prepare('SELECT hash FROM account_tokens WHERE purpose=?').get('reset')?.hash
		).toBe(digest(token));
		f.service.db.prepare("DELETE FROM account_mail WHERE id LIKE 'full%'").run();
		f.service.testMail(f.id);
		expect(f.service.claimMail()).toBeTruthy();
		const other = createAuthService(f.filename, origin, undefined, undefined, true);
		try {
			other.recoverMail();
			expect(other.claimMail()).toBeNull();
			expect(
				other.db
					.prepare("SELECT count(*) AS n FROM account_mail WHERE status='unknown' AND sealed=''")
					.get()?.n
			).toBe(1);
		} finally {
			other.close();
		}
	} finally {
		f.close();
	}
});
it('binds emailed invitations to their recipient and preserves revoked status', async () => {
	const f = await fixture();
	try {
		const url = f.service.invite(f.id, 'viewer', 'guest@example.test'),
			token = url.split('#')[1];
		expect(f.service.invitationInfo(token)).toMatchObject({
			state: 'ready',
			role: 'viewer',
			emailRequired: true
		});
		await expect(
			f.service.enroll({ token, name: 'Guest', email: 'wrong@example.test', password })
		).rejects.toThrow();
		const mail = f.service.claimMail();
		expect(mail?.to).toBe('guest@example.test');
		f.service.revokeInvite(f.id, digest(token));
		expect(f.service.invitationInfo(token).state).toBe('revoked');
		await expect(
			f.service.enroll({ token, name: 'Guest', email: 'guest@example.test', password })
		).rejects.toThrow();
	} finally {
		f.close();
	}
});
it('fences a pairing redemption already creating its browser session during reset', async () => {
	const f = await fixture();
	let release!: () => void;
	try {
		f.verify();
		const response = await f.login();
		const identity = await f.service.identity(
			new Headers({
				cookie: response.headers
					.getSetCookie()
					.map((c) => c.split(';')[0])
					.join('; ')
			})
		);
		const grant = f.service.startPairing('Paused redemption');
		f.service.approvePairing(identity!, grant.code, true);
		const context = await f.service.auth.$context,
			create = context.internalAdapter.createSession.bind(context.internalAdapter);
		let entered!: () => void;
		const started = new Promise<void>((r) => (entered = r)),
			held = new Promise<void>((r) => (release = r));
		context.internalAdapter.createSession = async (...args) => {
			entered();
			await held;
			return create(...args);
		};
		const pending = f.service.redeemPairing(grant.token);
		const rejected = expect(pending).rejects.toThrow();
		await started;
		const token = f.reset();
		await f.service.resetPassword(token, 'new-password-after-pair');
		release();
		await rejected;
		expect(f.service.db.prepare('SELECT count(*) AS n FROM session').get()?.n).toBe(0);
	} finally {
		release?.();
		f.close();
	}
});
it('shows delivery history only to the matching account', async () => {
	const f = await fixture();
	try {
		f.service.testMail(f.id);
		const link = f.service.invite(f.id, 'viewer');
		await f.service.enroll({
			token: link.split('#')[1],
			name: 'Guest',
			email: 'guest@example.test',
			password
		});
		const guest = f.service.accounts().find((row) => row.email === 'guest@example.test')!;
		expect(f.service.recoveryStatus(f.id).deliveries).toHaveLength(1);
		expect(f.service.recoveryStatus(String(guest.id)).deliveries).toEqual([]);
	} finally {
		f.close();
	}
});
