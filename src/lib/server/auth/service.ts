import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { makeSignature } from 'better-auth/crypto';
import { getCookies } from 'better-auth/cookies';
import accountSchema from './005.sql?raw';
import ownerResetSchema from './006.sql?raw';
import { hashPassword } from 'better-auth/crypto';
import pairingSchema from './004.sql?raw';
import { passkey } from '@better-auth/passkey';
import schema from './001.sql?raw';
import recoverySchema from './002.sql?raw';
import processSchema from './003.sql?raw';

export type Role = 'owner' | 'operator' | 'viewer';
export const roles: readonly Role[] = ['owner', 'operator', 'viewer'];
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export function createAuthService(
	filename: string,
	origin: string,
	suppliedSecret?: string,
	passwordVerifier?: (data: { hash: string; password: string }) => Promise<boolean>,
	mailEnabled = false
) {
	mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
	const db = new DatabaseSync(filename);
	chmodSync(filename, 0o600);
	db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL');
	db.exec('CREATE TABLE IF NOT EXISTS auth_migrations (version INTEGER PRIMARY KEY)');
	if (!db.prepare('SELECT 1 FROM auth_migrations WHERE version = 1').get()) {
		db.exec('BEGIN IMMEDIATE');
		try {
			if (!db.prepare('SELECT 1 FROM auth_migrations WHERE version = 1').get()) {
				db.exec(schema);
				db.exec(`CREATE TABLE enrollment (hash TEXT PRIMARY KEY, role TEXT NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL, claimed INTEGER, created INTEGER NOT NULL);
				CREATE TABLE auth_audit (id INTEGER PRIMARY KEY, actor TEXT, event TEXT NOT NULL, subject TEXT, created INTEGER NOT NULL);
				INSERT INTO auth_migrations VALUES (1)`);
			}
			db.exec('COMMIT');
		} catch (cause) {
			db.exec('ROLLBACK');
			throw cause;
		}
	}
	for (const [version, sql] of [
		[2, recoverySchema],
		[3, processSchema],
		[4, pairingSchema],
		[5, accountSchema],
		[6, ownerResetSchema]
	] as const) {
		db.exec('BEGIN IMMEDIATE');
		try {
			if (!db.prepare('SELECT 1 FROM auth_migrations WHERE version=?').get(version)) {
				db.exec(sql);
				db.prepare('INSERT INTO auth_migrations VALUES(?)').run(version);
			}
			db.exec('COMMIT');
		} catch (cause) {
			db.exec('ROLLBACK');
			throw cause;
		}
	}
	let secret = suppliedSecret;
	if (!secret) {
		const path = `${filename}.auth-secret`;
		try {
			secret = readFileSync(path, 'utf8').trim();
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
			try {
				writeFileSync(path, randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' });
			} catch (writeError) {
				if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError;
			}
			secret = readFileSync(path, 'utf8').trim();
		}
	}
	if (secret.length < 32)
		throw new Error('Authentication secret must contain at least 32 characters.');
	const enrollment = new AsyncLocalStorage<{ role: Role }>();
	const pairing = new AsyncLocalStorage<{ owner: string; epoch: number; loginVersion: number }>();
	const auth = betterAuth({
		appName: 'Perilune',
		baseURL: origin,
		secret,
		database: db,
		advanced: { ipAddress: { ipAddressHeaders: ['x-perilune-client-ip'] } },
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 12,
			maxPasswordLength: 128,
			...(passwordVerifier ? { password: { verify: passwordVerifier } } : {}),
			revokeSessionsOnPasswordReset: true,
			onPasswordReset: async ({ user }) => {
				db.prepare('DELETE FROM passkey WHERE userId=?').run(user.id);
			}
		},
		session: {
			expiresIn: 60 * 60 * 24 * 90,
			disableSessionRefresh: true,
			cookieCache: { enabled: false },
			additionalFields: {
				authVersion: { type: 'number', required: true, defaultValue: 0, input: false },
				loginVersion: { type: 'number', required: true, defaultValue: 0, input: false }
			}
		},
		user: {
			additionalFields: {
				role: { type: 'string', required: true, defaultValue: 'viewer', input: false },
				authVersion: { type: 'number', required: true, defaultValue: 0, input: false },
				loginVersion: { type: 'number', required: true, defaultValue: 0, input: false }
			}
		},
		rateLimit: { enabled: true, storage: 'memory', window: 60, max: 60 },
		plugins: [passkey({ rpName: 'Perilune', rpID: new URL(origin).hostname, origin })],
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path === '/sign-in/email' || ctx.path === '/passkey/verify-authentication') {
					(
						ctx.context as typeof ctx.context & { periluneVersions: Map<string, string> }
					).periluneVersions = new Map(
						db
							.prepare('SELECT id,authVersion,loginVersion FROM user')
							.all()
							.map((user) => [
								String(user.id),
								`${Number(user.authVersion)}:${Number(user.loginVersion)}`
							])
					);
				}
				if (ctx.path === '/sign-up/email' && !enrollment.getStore())
					throw new APIError('FORBIDDEN', { message: 'Use an invitation to create an account.' });
			})
		},
		databaseHooks: {
			session: {
				create: {
					before: async (session, ctx) => {
						const credential = db
							.prepare("SELECT password FROM account WHERE userId=? AND providerId='credential'")
							.get(session.userId);
						const user = db
							.prepare('SELECT authVersion,loginVersion FROM user WHERE id=?')
							.get(session.userId);
						const versions = (
							ctx?.context as { periluneVersions?: Map<string, string> } | undefined
						)?.periluneVersions;
						const version =
							versions?.get(session.userId) ??
							(pairing.getStore()?.owner === session.userId
								? `${pairing.getStore()!.epoch}:${pairing.getStore()!.loginVersion}`
								: enrollment.getStore()
									? `${Number(user?.authVersion)}:${Number(user?.loginVersion)}`
									: 'invalid');
						if (!user || `${Number(user.authVersion)}:${Number(user.loginVersion)}` !== version)
							throw new APIError('FORBIDDEN', { message: 'Please sign in again.' });
						if (!credential?.password)
							throw new APIError('FORBIDDEN', {
								message: 'Complete account recovery before signing in.'
							});
						return {
							data: {
								...session,
								authVersion: Number(user.authVersion),
								loginVersion: Number(user.loginVersion)
							}
						};
					}
				}
			},
			user: {
				create: {
					before: async (user) => {
						const capability = enrollment.getStore();
						if (!capability)
							throw new APIError('FORBIDDEN', { message: 'Enrollment is required.' });
						return { data: { ...user, role: capability.role } };
					}
				}
			}
		}
	});
	type Identity = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
	const watchers = new Set<{ controller: AbortController; session: Identity }>();
	const valid = (identity: Identity) => {
		const row = db
			.prepare(
				"SELECT s.expiresAt, u.role FROM session s JOIN user u ON u.id=s.userId JOIN account a ON a.userId=u.id AND a.providerId='credential' WHERE s.id=? AND a.password IS NOT NULL AND s.authVersion=u.authVersion AND s.loginVersion=u.loginVersion"
			)
			.get(identity.session.id);
		return (
			row &&
			new Date(row.expiresAt as string | number).getTime() > Date.now() &&
			row.role === identity.user.role
		);
	};
	const recentOwner = (identity: Identity) => {
		if (!valid(identity) || identity.user.role !== 'owner') return false;
		const session = db.prepare('SELECT createdAt FROM session WHERE id=?').get(identity.session.id);
		const created = session ? new Date(session.createdAt as string | number).getTime() : 0;
		return (
			created <= Date.now() &&
			created > Date.now() - 10 * 60000 &&
			!db.prepare('SELECT 1 FROM paired_browser WHERE session_id=?').get(identity.session.id)
		);
	};
	const eligibleOwnerReset = (hash: string) =>
		db
			.prepare(`
		SELECT r.* FROM owner_reset_links r
		JOIN user actor ON actor.id=r.actor
		JOIN account credential ON credential.userId=actor.id AND credential.providerId='credential'
		JOIN user target ON target.id=r.target
		WHERE r.hash=? AND r.status='active' AND r.expires>?
		AND actor.role='owner' AND actor.authVersion=r.actor_epoch AND actor.loginVersion=r.actor_login_version
		AND credential.password IS NOT NULL AND target.role IN ('operator','viewer')
	`)
			.get(hash, Date.now());
	const sweep = () => {
		for (const watcher of watchers) if (!valid(watcher.session)) watcher.controller.abort();
	};
	const timer = setInterval(sweep, 1000);
	timer.unref();
	const audit = (actor: string | null, event: string, subject: string | null) =>
		db
			.prepare('INSERT INTO auth_audit(actor,event,subject,created) VALUES (?,?,?,?)')
			.run(actor, event, subject, Date.now());

	const mailKey = createHash('sha256')
		.update(secret + ':account-mail')
		.digest();
	const seal = (value: unknown) => {
		const iv = randomBytes(12),
			cipher = createCipheriv('aes-256-gcm', mailKey, iv);
		const ciphertext = Buffer.concat([
			cipher.update(JSON.stringify(value), 'utf8'),
			cipher.final()
		]);
		return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
	};
	const unseal = (value: string) => {
		const bytes = Buffer.from(value, 'base64'),
			cipher = createDecipheriv('aes-256-gcm', mailKey, bytes.subarray(0, 12));
		cipher.setAuthTag(bytes.subarray(12, 28));
		return JSON.parse(
			Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
		) as { to: string; subject: string; text: string };
	};
	const throttle = (key: string, max = 3) => {
		const now = Date.now();
		db.prepare('DELETE FROM account_throttle WHERE expires<=?').run(now);
		const row = db
			.prepare(
				'INSERT INTO account_throttle VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count'
			)
			.get(digest(key), now + 15 * 60000);
		return Number(row?.count) <= max;
	};
	const enqueue = (
		to: string,
		kind: string,
		text: string,
		owner: string | null = null,
		tokenHash: string | null = null,
		invitationHash: string | null = null
	) => {
		if (!mailEnabled) throw Error('Email is not configured on this installation.');
		if (
			Number(
				db
					.prepare("SELECT count(*) AS n FROM account_mail WHERE status IN ('queued','sending')")
					.get()?.n
			) >= 100
		)
			throw Error('Email queue is full. Try again later.');
		const id = randomBytes(16).toString('hex'),
			user = owner
				? db.prepare('SELECT authVersion,loginVersion FROM user WHERE id=?').get(owner)
				: null;
		db.prepare('INSERT INTO account_mail VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
			id,
			owner,
			kind,
			seal({
				to,
				subject:
					kind === 'reset'
						? 'Reset your Perilune password'
						: kind === 'verify'
							? 'Verify your Perilune recovery address'
							: kind === 'invite'
								? 'Your Perilune invitation'
								: kind === 'changed'
									? 'Your Perilune password changed'
									: 'Perilune email test',
				text
			}),
			'queued',
			Date.now(),
			Date.now() + 5 * 60000,
			tokenHash,
			invitationHash,
			user?.authVersion ?? null,
			user?.loginVersion ?? null
		);
		return id;
	};
	const transaction = <T>(fn: () => T): T => {
		db.exec('BEGIN IMMEDIATE');
		try {
			const result = fn();
			db.exec('COMMIT');
			return result;
		} catch (e) {
			db.exec('ROLLBACK');
			throw e;
		}
	};
	const tokenFor = (owner: string, purpose: 'verify' | 'reset' | 'owner-reset') => {
		const user = db
			.prepare('SELECT email,authVersion,loginVersion FROM user WHERE id=?')
			.get(owner);
		if (!user) throw Error('Account unavailable.');
		const token = randomBytes(32).toString('base64url'),
			hash = digest(token);
		db.prepare('DELETE FROM account_tokens WHERE owner=? AND purpose=?').run(owner, purpose);
		db.prepare('INSERT INTO account_tokens VALUES(?,?,?,?,?,?,?)').run(
			hash,
			purpose,
			owner,
			String(user.email),
			Number(user.authVersion),
			Number(user.loginVersion),
			Date.now() + 30 * 60000
		);
		return { token, hash, email: String(user.email) };
	};
	return {
		mailEnabled,
		recoverMail() {
			db.prepare("UPDATE account_mail SET status='unknown',sealed='' WHERE status='sending'").run();
			db.prepare('DELETE FROM account_mail WHERE created<?').run(Date.now() - 7 * 86400000);
		},
		publicLimit(ip: string) {
			return throttle('public-global', 1000) && throttle('public-ip:' + ip, 50);
		},
		recoveryStatus(owner: string) {
			const user = db.prepare('SELECT email,emailVerified FROM user WHERE id=?').get(owner);
			if (!user) throw Error('Account unavailable.');
			return {
				enabled: mailEnabled,
				email: String(user.email),
				verified: !!user.emailVerified,
				deliveries: db
					.prepare(
						'SELECT id,kind,status,created FROM account_mail WHERE owner=? ORDER BY created DESC LIMIT 5'
					)
					.all(owner)
			};
		},
		ownerResetStatus(identity: Identity) {
			if (!valid(identity) || identity.user.role !== 'owner') throw Error('Owner access required.');
			const links = db
				.prepare(`SELECT r.id,r.hash,r.actor,r.target,r.created,r.expires,r.status,r.updated,
			 issuer.name AS actor_name,recipient.name AS target_name
			 FROM owner_reset_links r LEFT JOIN user issuer ON issuer.id=r.actor
			 LEFT JOIN user recipient ON recipient.id=r.target ORDER BY r.created DESC,r.id DESC LIMIT 30`)
				.all();
			return {
				recent: recentOwner(identity),
				links: links.map((row) => ({
					id: String(row.id),
					actor: String(row.actor_name ?? 'Removed account'),
					target: String(row.target_name ?? 'Removed account'),
					created: Number(row.created),
					expires: Number(row.expires),
					updated: Number(row.updated),
					status:
						row.status !== 'active'
							? String(row.status)
							: Number(row.expires) <= Date.now()
								? 'expired'
								: !eligibleOwnerReset(String(row.hash)) ||
									  !db
											.prepare(`SELECT 1 FROM account_tokens t JOIN user u ON u.id=t.owner
					 JOIN account a ON a.userId=u.id AND a.providerId='credential' WHERE t.hash=? AND t.email=u.email
					 AND t.epoch=u.authVersion AND t.login_version=u.loginVersion AND a.password IS NOT NULL`)
											.get(row.hash)
									? 'invalidated'
									: 'active'
				}))
			};
		},
		createOwnerReset(identity: Identity, target: string, confirmed: boolean) {
			try {
				if (!valid(identity) || identity.user.role !== 'owner')
					throw Error('Owner access required.');
				if (!recentOwner(identity))
					throw Error(
						'Sign in again with your password or passkey to create a reset link. Browser pairing does not confirm this action.'
					);
				if (!confirmed)
					throw Error('Confirm the account and the password-reset consequences first.');
				if (!throttle('owner-reset:' + identity.user.id, 5) || !throttle('owner-reset-global', 100))
					throw Error('Wait before creating another reset link.');
				return transaction(() => {
					if (!recentOwner(identity))
						throw Error('Sign in again with your password or passkey to create a reset link.');
					if (
						Number(
							db
								.prepare(
									"SELECT count(*) AS n FROM owner_reset_links WHERE status='active' AND expires>?"
								)
								.get(Date.now())?.n
						) >= 100
					)
						throw Error('Too many active reset links. Revoke an unused link or wait for expiry.');
					const user = db
						.prepare(`SELECT u.id FROM user u JOIN account a ON a.userId=u.id AND a.providerId='credential'
					 WHERE u.id=? AND u.role IN ('operator','viewer') AND a.password IS NOT NULL`)
						.get(target);
					if (!user)
						throw Error(
							'Choose an active operator or viewer account. Owner recovery must use the host procedure.'
						);
					const now = Date.now();
					if (
						db
							.prepare(
								"UPDATE owner_reset_links SET status='revoked',updated=? WHERE target=? AND status='active'"
							)
							.run(now, target).changes
					)
						audit(identity.user.id, 'owner-reset.superseded', target);
					const capability = tokenFor(target, 'owner-reset');
					const id = randomBytes(16).toString('hex'),
						expires = now + 10 * 60000;
					db.prepare('UPDATE account_tokens SET expires=? WHERE hash=?').run(
						expires,
						capability.hash
					);
					db.prepare('INSERT INTO owner_reset_links VALUES(?,?,?,?,?,?,?,?,?,?)').run(
						id,
						capability.hash,
						identity.user.id,
						target,
						identity.user.authVersion,
						identity.user.loginVersion,
						now,
						expires,
						'active',
						now
					);
					db.prepare(
						'DELETE FROM owner_reset_links WHERE id IN (SELECT id FROM owner_reset_links ORDER BY created DESC,id DESC LIMIT -1 OFFSET 500)'
					).run();
					audit(identity.user.id, 'owner-reset.created', target);
					return { id, url: `${origin}/forgot-password#${capability.token}`, expires };
				});
			} catch (cause) {
				if (valid(identity) && identity.user.role === 'owner')
					audit(identity.user.id, 'owner-reset.denied', target);
				throw cause;
			}
		},
		revokeOwnerReset(identity: Identity, id: string) {
			if (!valid(identity) || identity.user.role !== 'owner') throw Error('Owner access required.');
			transaction(() => {
				const row = db
					.prepare(
						"UPDATE owner_reset_links SET status='revoked',updated=? WHERE id=? AND status='active' RETURNING hash,target"
					)
					.get(Date.now(), id);
				if (!row) throw Error('This reset link is no longer active.');
				db.prepare('DELETE FROM account_tokens WHERE hash=?').run(row.hash);
				audit(identity.user.id, 'owner-reset.revoked', String(row.target));
			});
		},
		requestVerification(owner: string) {
			if (!mailEnabled) throw Error('Email is not configured on this installation.');
			if (!throttle('verify:' + owner))
				throw Error('Wait before requesting another verification email.');
			return transaction(() => {
				const t = tokenFor(owner, 'verify');
				enqueue(
					t.email,
					'verify',
					`Verify this recovery address within 30 minutes:\n${origin}/verify-email#${t.token}\nIgnore this message if you did not request it.`,
					owner,
					t.hash
				);
			});
		},
		verifyEmail(token: string) {
			if (!/^[A-Za-z0-9_-]{43}$/.test(token))
				throw Error('This verification link is invalid or expired.');
			db.exec('BEGIN IMMEDIATE');
			try {
				const row = db
					.prepare(
						"DELETE FROM account_tokens WHERE hash=? AND purpose='verify' AND expires>? RETURNING *"
					)
					.get(digest(token), Date.now());
				if (
					!row ||
					!db
						.prepare(
							'UPDATE user SET emailVerified=1 WHERE id=? AND email=? AND authVersion=? AND loginVersion=?'
						)
						.run(row.owner, row.email, row.epoch, row.login_version).changes
				)
					throw Error('This verification link is invalid or expired.');
				audit(String(row.owner), 'email.verified', null);
				db.exec('COMMIT');
			} catch (e) {
				db.exec('ROLLBACK');
				throw e;
			}
		},
		requestReset(email: string, ip: string) {
			// Same response and synchronous work class for missing/unverified accounts. SMTP runs separately.
			if (!mailEnabled) return;
			const allowed = throttle('reset-global', 300) && throttle('reset-ip:' + ip, 10),
				addressAllowed = throttle('reset-address:' + email.trim().toLowerCase());
			if (!allowed || !addressAllowed) return;
			const user = db
				.prepare(
					"SELECT u.id FROM user u JOIN account a ON a.userId=u.id AND a.providerId='credential' WHERE u.email=? COLLATE NOCASE AND u.emailVerified=1 AND a.password IS NOT NULL"
				)
				.get(email.trim());
			if (!user) return;
			try {
				transaction(() => {
					const t = tokenFor(String(user.id), 'reset');
					enqueue(
						t.email,
						'reset',
						`Choose a new password within 30 minutes:\n${origin}/forgot-password#${t.token}\nRequesting this link does not change your account.`,
						String(user.id),
						t.hash
					);
				});
			} catch {
				/* Public requests never expose queue/account state. */
			}
		},
		async resetPassword(token: string, password: string) {
			if (!/^[A-Za-z0-9_-]{43}$/.test(token) || password.length < 12 || password.length > 128)
				throw Error('Use a valid reset link and a password of 12–128 characters.');
			const knownReset = db
				.prepare('SELECT target FROM owner_reset_links WHERE hash=?')
				.get(digest(token));
			const hashed = await hashPassword(password);
			db.exec('BEGIN IMMEDIATE');
			try {
				const row = db
					.prepare(
						"DELETE FROM account_tokens WHERE hash=? AND purpose IN ('reset','owner-reset') AND expires>? RETURNING *"
					)
					.get(digest(token), Date.now());
				if (
					!row ||
					(row.purpose === 'owner-reset' && !eligibleOwnerReset(String(row.hash))) ||
					!db
						.prepare(
							"UPDATE user SET loginVersion=loginVersion+1 WHERE id=? AND email=? AND (emailVerified=1 OR ?='owner-reset') AND authVersion=? AND loginVersion=? AND EXISTS(SELECT 1 FROM account WHERE userId=user.id AND providerId='credential' AND password IS NOT NULL)"
						)
						.run(row.owner, row.email, row.purpose, row.epoch, row.login_version).changes
				)
					throw Error('This reset link is invalid, expired or already used.');
				if (
					!db
						.prepare("UPDATE account SET password=? WHERE userId=? AND providerId='credential'")
						.run(hashed, row.owner).changes
				)
					throw Error('Account unavailable.');
				db.prepare('DELETE FROM session WHERE userId=?').run(row.owner);
				db.prepare('DELETE FROM browser_pairing WHERE owner=?').run(row.owner);
				db.prepare('DELETE FROM account_tokens WHERE owner=?').run(row.owner);
				db.prepare(
					"DELETE FROM verification WHERE value=? AND identifier LIKE 'reset-password:%'"
				).run(row.owner);
				db.prepare(
					"UPDATE owner_reset_links SET status=CASE WHEN hash=? THEN 'redeemed' ELSE 'revoked' END,updated=? WHERE target=? AND status='active'"
				).run(row.hash, Date.now(), row.owner);
				if (row.purpose === 'owner-reset') audit(String(row.owner), 'owner-reset.redeemed', null);
				audit(String(row.owner), 'password.reset', null);
				if (
					mailEnabled &&
					db.prepare('SELECT emailVerified FROM user WHERE id=?').get(row.owner)?.emailVerified &&
					Number(
						db
							.prepare(
								"SELECT count(*) AS n FROM account_mail WHERE status IN ('queued','sending')"
							)
							.get()?.n
					) < 100
				)
					enqueue(
						String(row.email),
						'changed',
						`Your Perilune password was changed. Browser sessions were signed out. Passkeys and slicer integrations were preserved. Contact the host if this was unexpected.\n${origin}`,
						String(row.owner)
					);
				db.exec('COMMIT');
			} catch (e) {
				db.exec('ROLLBACK');
				if (knownReset) audit(null, 'owner-reset.redemption-denied', String(knownReset.target));
				throw e;
			}
			sweep();
		},
		testMail(owner: string) {
			if (!throttle('test:' + owner)) throw Error('Wait before sending another test.');
			const user = db.prepare('SELECT email FROM user WHERE id=?').get(owner);
			if (!user) throw Error('Account unavailable.');
			return enqueue(
				String(user.email),
				'test',
				`This installation can send account email.\n${origin}`,
				owner
			);
		},
		claimMail() {
			db.prepare('DELETE FROM account_mail WHERE created<?').run(Date.now() - 7 * 86400000);
			db.prepare('DELETE FROM account_tokens WHERE expires<=?').run(Date.now());
			db.prepare(
				"UPDATE account_mail SET status='expired',sealed='' WHERE status='queued' AND expires<=?"
			).run(Date.now());
			const row = db
				.prepare(
					"UPDATE account_mail SET status='sending' WHERE id=(SELECT id FROM account_mail WHERE status='queued' ORDER BY created LIMIT 1) RETURNING *"
				)
				.get();
			if (!row) return null;
			const user = row.owner
				? db.prepare('SELECT authVersion,loginVersion FROM user WHERE id=?').get(row.owner)
				: null;
			const validToken =
				!row.token_hash ||
				db
					.prepare(
						`SELECT 1 FROM account_tokens t JOIN user u ON u.id=t.owner WHERE t.hash=? AND t.expires>? AND t.email=u.email AND t.epoch=u.authVersion AND t.login_version=u.loginVersion AND (t.purpose!='reset' OR EXISTS(SELECT 1 FROM account a WHERE a.userId=u.id AND a.providerId='credential' AND a.password IS NOT NULL))`
					)
					.get(row.token_hash, Date.now());
			const validInvite =
				!row.invitation_hash ||
				db
					.prepare(
						'SELECT 1 FROM enrollment e LEFT JOIN invitation_details d ON d.hash=e.hash WHERE e.hash=? AND e.claimed IS NULL AND e.expires>? AND COALESCE(d.revoked,0)=0'
					)
					.get(row.invitation_hash, Date.now());
			if (
				(row.owner &&
					(!user || user.authVersion !== row.epoch || user.loginVersion !== row.login_version)) ||
				!validToken ||
				!validInvite
			) {
				db.prepare("UPDATE account_mail SET status='cancelled',sealed='' WHERE id=?").run(row.id);
				return null;
			}
			try {
				return { id: String(row.id), ...unseal(String(row.sealed)) };
			} catch {
				db.prepare("UPDATE account_mail SET status='failed',sealed='' WHERE id=?").run(row.id);
				return null;
			}
		},
		finishMail(id: string, status: 'sent' | 'failed' | 'unknown') {
			db.prepare("UPDATE account_mail SET status=?,sealed='' WHERE id=? AND status='sending'").run(
				status,
				id
			);
		},
		auth,
		db,
		origin,
		async identity(headers: Headers) {
			const identity = await auth.api.getSession({
				headers,
				query: { disableCookieCache: true, disableRefresh: true }
			});
			return identity && valid(identity) ? identity : null;
		},
		async resolveIdentity(headers: Headers) {
			// Reads never write or clear browser authentication cookies: a late
			// response must not restore an older identity or erase a newer one.
			const identity = await auth.api.getSession({
				headers,
				query: { disableCookieCache: true, disableRefresh: true }
			});
			return { response: identity && valid(identity) ? identity : null, headers: new Headers() };
		},
		async handle(request: Request) {
			const response = await auth.handler(request);
			const path = new URL(request.url).pathname;
			const createsSession =
				request.method === 'POST' &&
				response.ok &&
				['/api/auth/sign-in/email', '/api/auth/passkey/verify-authentication'].includes(path);
			if (createsSession) return response;
			const protectedNames = Object.values(getCookies(auth.options)).map((cookie) => cookie.name);
			const headers = new Headers(response.headers);
			headers.delete('set-cookie');
			for (const cookie of response.headers.getSetCookie()) {
				const name = cookie.slice(0, cookie.indexOf('='));
				if (
					!protectedNames.some(
						(protectedName) => name === protectedName || name.startsWith(protectedName + '.')
					)
				)
					headers.append('set-cookie', cookie);
			}
			// In particular, sign-out deletes the captured session in the DB
			// but never sends a delayed deletion for a newer browser cookie.
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers
			});
		},
		startPairing(name: string) {
			const now = Date.now();
			db.prepare('DELETE FROM browser_pairing WHERE expires<=?').run(now);
			if (Number(db.prepare('SELECT count(*) AS count FROM browser_pairing').get()?.count) >= 100)
				throw new Error('Too many pairing requests. Try again in a few minutes.');
			const token = randomBytes(32).toString('base64url');
			const code = randomBytes(5).toString('hex').toUpperCase();
			const expires = now + 300_000;
			db.prepare('INSERT INTO browser_pairing(hash,code,name,expires) VALUES(?,?,?,?)').run(
				digest(token),
				code,
				name.trim().slice(0, 80) || 'Paired browser',
				expires
			);
			return { token, code, expires, url: `${origin}/pair` };
		},
		pairingRequest(code: string) {
			return db
				.prepare(
					'SELECT name,expires FROM browser_pairing WHERE code=? AND expires>? AND approved=0'
				)
				.get(code.toUpperCase(), Date.now());
		},
		approvePairing(identity: Identity, code: string, approve: boolean, integrationId?: string) {
			if (!valid(identity)) throw new Error('Please sign in again.');
			const row = db
				.prepare('SELECT authVersion,loginVersion FROM user WHERE id=?')
				.get(identity.user.id)!;
			if (
				integrationId &&
				!db
					.prepare(
						'SELECT id FROM slicer_keys WHERE id=? AND owner=? AND epoch=? AND (expires=0 OR expires>?)'
					)
					.get(integrationId, identity.user.id, Number(row.authVersion), Date.now())
			)
				throw new Error('Choose an active integration owned by your account.');
			const result = approve
				? db
						.prepare(
							'UPDATE browser_pairing SET owner=?,epoch=?,login_version=?,integration_id=?,approved=1 WHERE code=? AND expires>? AND approved=0'
						)
						.run(
							identity.user.id,
							Number(row.authVersion),
							Number(row.loginVersion),
							integrationId ?? null,
							code.toUpperCase(),
							Date.now()
						)
				: db
						.prepare('DELETE FROM browser_pairing WHERE code=? AND expires>? AND approved=0')
						.run(code.toUpperCase(), Date.now());
			if (!result.changes) throw new Error('Pairing request expired or was already handled.');
			audit(identity.user.id, approve ? 'browser.approved' : 'browser.denied', null);
		},
		async redeemPairing(token: string) {
			if (token.length !== 43) throw new Error('Invalid pairing request.');
			const request = db
				.prepare('SELECT * FROM browser_pairing WHERE hash=? AND expires>?')
				.get(digest(token), Date.now());
			if (!request) throw new Error('Pairing expired or was cancelled. Start again.');
			if (!request.approved) return null;
			// Claim before asynchronous session creation. Ambiguous outcomes never reopen a grant.
			if (
				!db
					.prepare('UPDATE browser_pairing SET approved=2 WHERE hash=? AND approved=1')
					.run(digest(token)).changes
			)
				throw new Error('Pairing request already used.');
			const owner = String(request.owner);
			const context = await auth.$context;
			const session = await pairing.run(
				{ owner, epoch: Number(request.epoch), loginVersion: Number(request.login_version) },
				() => context.internalAdapter.createSession(owner)
			);
			if (!session) throw new Error('Could not create browser session.');
			db.prepare(
				'INSERT INTO paired_browser(session_id,name,created,integration_id) VALUES(?,?,?,?)'
			).run(
				session.id,
				String(request.name),
				Date.now(),
				request.integration_id === null ? null : String(request.integration_id)
			);
			if (
				!db
					.prepare('UPDATE browser_pairing SET session_id=? WHERE hash=? AND approved=2')
					.run(session.id, digest(token)).changes
			) {
				db.prepare('DELETE FROM session WHERE id=?').run(session.id);
				throw new Error('Pairing cancelled.');
			}
			const cookie = getCookies(auth.options).sessionToken;
			return {
				name: cookie.name,
				value: `${session.token}.${await makeSignature(session.token, secret!)}`,
				attributes: cookie.attributes
			};
		},
		cancelPairing(token: string) {
			if (token.length !== 43) throw new Error('Invalid pairing request.');
			const row = db
				.prepare('DELETE FROM browser_pairing WHERE hash=? RETURNING session_id')
				.get(digest(token));
			if (row?.session_id) db.prepare('DELETE FROM session WHERE id=?').run(String(row.session_id));
			sweep();
		},
		browsers(owner: string) {
			return db
				.prepare(
					'SELECT p.session_id AS id,p.name,p.created,p.integration_id AS integrationId,s.updatedAt AS lastUsed,s.expiresAt AS expires FROM paired_browser p JOIN session s ON s.id=p.session_id WHERE s.userId=? AND s.expiresAt>? ORDER BY p.created DESC'
				)
				.all(owner, Date.now());
		},
		disconnectIntegration(owner: string, id: string) {
			db.exec('BEGIN IMMEDIATE');
			try {
				db.prepare(
					'DELETE FROM session WHERE userId=? AND id IN (SELECT session_id FROM paired_browser WHERE integration_id=?)'
				).run(owner, id);
				db.prepare('DELETE FROM browser_pairing WHERE owner=? AND integration_id=?').run(owner, id);
				db.prepare('DELETE FROM slicer_keys WHERE owner=? AND id=?').run(owner, id);
				audit(owner, 'integration.disconnected', id);
				db.exec('COMMIT');
			} catch (cause) {
				db.exec('ROLLBACK');
				throw cause;
			}
			sweep();
		},
		revokeBrowser(owner: string, id: string) {
			db.prepare(
				'DELETE FROM session WHERE id=? AND userId=? AND id IN (SELECT session_id FROM paired_browser)'
			).run(id, owner);
			audit(owner, 'browser.revoked', id);
			sweep();
		},
		watch(session: Identity) {
			const controller = new AbortController();
			const watcher = { controller, session };
			watchers.add(watcher);
			if (!valid(session)) controller.abort();
			return {
				signal: controller.signal,
				release: () => {
					watchers.delete(watcher);
				}
			};
		},
		sweep,
		valid,
		needsSetup: () => !db.prepare('SELECT 1 FROM user LIMIT 1').get(),
		async enroll(body: { token: string; name: string; email: string; password: string }) {
			if (
				!body.name.trim() ||
				body.name.length > 100 ||
				!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
				body.email.length > 254 ||
				body.password.length < 12 ||
				body.password.length > 128
			)
				throw new Error('Enter a name, email, and password of at least 12 characters.');
			body.email = body.email.trim().toLowerCase();
			if (!body.token || body.token.length > 256)
				throw new Error('This enrollment link is invalid or expired.');
			// Reserve durably before asynchronous signup. A crashed reservation is deliberately fail-closed.
			const claim = db
				.prepare(
					`UPDATE enrollment SET claimed=? WHERE hash=? AND claimed IS NULL AND expires>? AND NOT EXISTS(SELECT 1 FROM invitation_details d WHERE d.hash=enrollment.hash AND (d.revoked=1 OR (d.email IS NOT NULL AND d.email!=? COLLATE NOCASE))) AND (kind!='setup' OR (NOT EXISTS(SELECT 1 FROM user) AND NOT EXISTS(SELECT 1 FROM enrollment WHERE kind='setup' AND claimed IS NOT NULL))) RETURNING role`
				)
				.get(Date.now(), digest(body.token), Date.now(), body.email);
			if (!claim) throw new Error('This enrollment link is invalid, expired, or already used.');
			try {
				await enrollment.run({ role: claim.role as Role }, () =>
					auth.api.signUpEmail({
						body: { name: body.name, email: body.email, password: body.password }
					})
				);
				audit(null, 'account.enrolled', body.email);
			} catch (cause) {
				// Never reopen a token after an ambiguous account-creation outcome.
				audit(null, 'enrollment.failed', null);
				throw cause;
			}
		},
		invitationInfo(token: string) {
			if (!/^[A-Za-z0-9_-]{43}$/.test(token))
				return { state: 'invalid', role: null, expires: null, emailRequired: false };
			const row = db
				.prepare(
					"SELECT e.role,e.expires,e.claimed,d.email,d.revoked FROM enrollment e LEFT JOIN invitation_details d ON d.hash=e.hash WHERE e.hash=? AND e.kind='invite'"
				)
				.get(digest(token));
			return row
				? {
						state: row.revoked
							? 'revoked'
							: row.claimed
								? 'used'
								: Number(row.expires) <= Date.now()
									? 'expired'
									: 'ready',
						role: String(row.role),
						expires: Number(row.expires),
						emailRequired: !!row.email
					}
				: { state: 'invalid', role: null, expires: null, emailRequired: false };
		},
		invite(actor: string, role: Role, email?: string) {
			const recipient = email?.trim().toLowerCase();
			if (
				email !== undefined &&
				(!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 254)
			)
				throw Error('Enter a valid invitation email.');
			if (!throttle('invite:' + actor, 10)) throw Error('Wait before creating more invitations.');
			return transaction(() => {
				const token = randomBytes(32).toString('base64url'),
					hash = digest(token),
					now = Date.now(),
					url = `${origin}/register#${token}`;
				db.prepare('INSERT INTO enrollment VALUES(?,?,?,?,NULL,?)').run(
					hash,
					role,
					'invite',
					now + 86400000,
					now
				);
				db.prepare('INSERT INTO invitation_details VALUES(?,?,0)').run(hash, recipient ?? null);
				if (recipient)
					enqueue(
						recipient,
						'invite',
						`You were invited to Perilune as ${role}. This invitation expires in 24 hours.\n${url}`,
						actor,
						null,
						hash
					);
				audit(actor, 'invite.created', role);
				return url;
			});
		},
		accounts: () => db.prepare('SELECT id,name,email,role FROM user ORDER BY createdAt').all(),
		invitations: () =>
			db
				.prepare(
					"SELECT e.hash,e.role,e.expires,e.claimed,d.email,COALESCE(d.revoked,0) AS revoked FROM enrollment e LEFT JOIN invitation_details d ON d.hash=e.hash WHERE e.kind='invite' ORDER BY e.created DESC LIMIT 100"
				)
				.all(),
		revokeInvite(actor: string, hash: string) {
			db.prepare(
				"INSERT INTO invitation_details(hash,email,revoked) SELECT hash,NULL,1 FROM enrollment WHERE hash=? AND kind='invite' ON CONFLICT(hash) DO UPDATE SET revoked=1"
			).run(hash);
			audit(actor, 'invite.revoked', null);
		},
		revokeAccount(actor: string, id: string) {
			if (actor === id) throw new Error('You cannot remove your own account.');
			db.exec('BEGIN IMMEDIATE');
			try {
				const target = db.prepare('SELECT role FROM user WHERE id=?').get(id);
				const owners = db.prepare("SELECT count(*) AS count FROM user WHERE role='owner'").get();
				if (target?.role === 'owner' && Number(owners?.count) <= 1)
					throw new Error('Keep at least one owner.');
				db.prepare('DELETE FROM user WHERE id=?').run(id);
				audit(actor, 'account.revoked', id);
				db.exec('COMMIT');
			} catch (cause) {
				db.exec('ROLLBACK');
				throw cause;
			}
			sweep();
		},
		close() {
			clearInterval(timer);
			for (const watcher of watchers) watcher.controller.abort();
			watchers.clear();
			db.close();
		}
	};
}
export type AuthService = ReturnType<typeof createAuthService>;
export type Identity = NonNullable<Awaited<ReturnType<AuthService['identity']>>>;
