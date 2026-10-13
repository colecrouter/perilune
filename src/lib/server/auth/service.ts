import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
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
	passwordVerifier?: (data: { hash: string; password: string }) => Promise<boolean>
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
		[3, processSchema]
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
			expiresIn: 60 * 60 * 24 * 7,
			cookieCache: { enabled: false },
			additionalFields: {
				authVersion: { type: 'number', required: true, defaultValue: 0, input: false }
			}
		},
		user: {
			additionalFields: {
				role: { type: 'string', required: true, defaultValue: 'viewer', input: false },
				authVersion: { type: 'number', required: true, defaultValue: 0, input: false }
			}
		},
		rateLimit: { enabled: true, storage: 'memory', window: 60, max: 60 },
		plugins: [passkey({ rpName: 'Perilune', rpID: new URL(origin).hostname, origin })],
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path === '/sign-in/email' || ctx.path === '/passkey/verify-authentication') {
					(
						ctx.context as typeof ctx.context & { periluneVersions: Map<string, number> }
					).periluneVersions = new Map(
						db
							.prepare('SELECT id,authVersion FROM user')
							.all()
							.map((user) => [String(user.id), Number(user.authVersion)])
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
						const user = db.prepare('SELECT authVersion FROM user WHERE id=?').get(session.userId);
						const versions = (
							ctx?.context as { periluneVersions?: Map<string, number> } | undefined
						)?.periluneVersions;
						const version =
							versions?.get(session.userId) ??
							(enrollment.getStore() ? Number(user?.authVersion) : -1);
						if (!user || Number(user.authVersion) !== version)
							throw new APIError('FORBIDDEN', { message: 'Please sign in again.' });
						if (!credential?.password)
							throw new APIError('FORBIDDEN', {
								message: 'Complete account recovery before signing in.'
							});
						return { data: { ...session, authVersion: version } };
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
				"SELECT s.expiresAt, u.role FROM session s JOIN user u ON u.id=s.userId JOIN account a ON a.userId=u.id AND a.providerId='credential' WHERE s.id=? AND a.password IS NOT NULL AND s.authVersion=u.authVersion"
			)
			.get(identity.session.id);
		return (
			row &&
			new Date(row.expiresAt as string | number).getTime() > Date.now() &&
			row.role === identity.user.role
		);
	};
	const sweep = () => {
		for (const watcher of watchers) if (!valid(watcher.session)) watcher.controller.abort();
	};
	const timer = setInterval(sweep, 1000);
	timer.unref();
	const audit = (actor: string | null, event: string, subject: string | null) =>
		db
			.prepare('INSERT INTO auth_audit(actor,event,subject,created) VALUES (?,?,?,?)')
			.run(actor, event, subject, Date.now());
	return {
		auth,
		db,
		origin,
		async identity(headers: Headers) {
			return auth.api.getSession({ headers, query: { disableCookieCache: true } });
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
			if (!body.token || body.token.length > 256)
				throw new Error('This enrollment link is invalid or expired.');
			// Reserve durably before asynchronous signup. A crashed reservation is deliberately fail-closed.
			const claim = db
				.prepare(
					`UPDATE enrollment SET claimed=? WHERE hash=? AND claimed IS NULL AND expires>? AND (kind!='setup' OR (NOT EXISTS(SELECT 1 FROM user) AND NOT EXISTS(SELECT 1 FROM enrollment WHERE kind='setup' AND claimed IS NOT NULL))) RETURNING role`
				)
				.get(Date.now(), digest(body.token), Date.now());
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
		invite(actor: string, role: Role) {
			const token = randomBytes(32).toString('base64url');
			const now = Date.now();
			db.prepare('INSERT INTO enrollment VALUES (?,?,?,?,NULL,?)').run(
				digest(token),
				role,
				'invite',
				now + 86400000,
				now
			);
			audit(actor, 'invite.created', role);
			return `${origin}/register#${token}`;
		},
		accounts: () => db.prepare('SELECT id,name,email,role FROM user ORDER BY createdAt').all(),
		invitations: () =>
			db
				.prepare(
					"SELECT hash,role,expires,claimed FROM enrollment WHERE kind='invite' ORDER BY created DESC"
				)
				.all(),
		revokeInvite(actor: string, hash: string) {
			db.prepare('DELETE FROM enrollment WHERE hash=? AND kind=?').run(hash, 'invite');
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
