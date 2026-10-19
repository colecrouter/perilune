import { claimProcess } from '../src/lib/server/auth/process-lock.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
const usage = `Usage:
  node scripts/auth.mjs setup
  node scripts/auth.mjs setup-reset --server-stopped
  node scripts/auth.mjs recover <owner-email> --server-stopped

Setup creates a one-time token before the first owner account exists.
Stop Perilune before resetting setup or recovering an owner account.`;

function main() {
	const command = process.argv[2];
	if (!command || command === '--help' || command === '-h') {
		console.log(usage);
		return;
	}
	if (!['setup', 'setup-reset', 'recover'].includes(command))
		throw new Error(`Unknown command: ${command}\n${usage}`);
	if (
		(command === 'recover' || command === 'setup-reset') &&
		!process.argv.includes('--server-stopped')
	)
		throw new Error('Stop the server, then rerun with --server-stopped.');
	if (command === 'recover' && (!process.argv[3] || process.argv[3].startsWith('--')))
		throw new Error(`An owner email is required.\n${usage}`);
	const filename = process.env.PERILUNE_DATABASE ?? './data/perilune.sqlite';
	mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
	const db = new DatabaseSync(filename);
	try {
		chmodSync(filename, 0o600);
		db.exec(
			'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS auth_migrations(version INTEGER PRIMARY KEY)'
		);
		if (!db.prepare('SELECT 1 FROM auth_migrations WHERE version=1').get()) {
			db.exec('BEGIN IMMEDIATE');
			try {
				if (!db.prepare('SELECT 1 FROM auth_migrations WHERE version=1').get()) {
					db.exec(readFileSync(new URL('../src/lib/server/auth/001.sql', import.meta.url), 'utf8'));
					db.exec(`CREATE TABLE enrollment(hash TEXT PRIMARY KEY,role TEXT NOT NULL,kind TEXT NOT NULL,expires INTEGER NOT NULL,claimed INTEGER,created INTEGER NOT NULL);
 CREATE TABLE auth_audit(id INTEGER PRIMARY KEY,actor TEXT,event TEXT NOT NULL,subject TEXT,created INTEGER NOT NULL);
 INSERT INTO auth_migrations VALUES(1)`);
				}
				db.exec('COMMIT');
			} catch (cause) {
				db.exec('ROLLBACK');
				throw cause;
			}
		}
		for (const version of [2, 3, 4, 5]) {
			db.exec('BEGIN IMMEDIATE');
			try {
				if (!db.prepare('SELECT 1 FROM auth_migrations WHERE version=?').get(version)) {
					db.exec(
						readFileSync(
							new URL(`../src/lib/server/auth/00${version}.sql`, import.meta.url),
							'utf8'
						)
					);
					db.prepare('INSERT INTO auth_migrations VALUES(?)').run(version);
				}
				db.exec('COMMIT');
			} catch (cause) {
				db.exec('ROLLBACK');
				throw cause;
			}
		}

		if (command === 'recover' || command === 'setup-reset') claimProcess(db, true);
		const token = randomBytes(32).toString('base64url');
		const hash = createHash('sha256').update(token).digest('hex');
		if (command === 'setup') {
			db.exec('BEGIN IMMEDIATE');
			try {
				if (db.prepare('SELECT 1 FROM user LIMIT 1').get())
					throw new Error('Setup is closed. Use recovery for an existing installation.');
				if (db.prepare("SELECT 1 FROM enrollment WHERE kind='setup' AND claimed IS NOT NULL").get())
					throw new Error(
						'Setup enrollment is pending or failed. Stop the server before using setup-reset to clear a failed reservation.'
					);
				db.prepare("DELETE FROM enrollment WHERE kind='setup'").run();
				const now = Date.now();
				db.prepare('INSERT INTO enrollment VALUES(?,?,?,?,NULL,?)').run(
					hash,
					'owner',
					'setup',
					now + 1800000,
					now
				);
				db.exec('COMMIT');
			} catch (cause) {
				db.exec('ROLLBACK');
				throw cause;
			}
			console.log(`One-time setup token (expires in 30 minutes):\n${token}`);
		} else if (command === 'setup-reset') {
			if (db.prepare('SELECT 1 FROM user LIMIT 1').get()) throw new Error('Setup is closed.');
			db.prepare("DELETE FROM enrollment WHERE kind='setup'").run();
			console.log(
				'Failed setup reservation cleared. Run setup to mint a fresh token before restarting.'
			);
		} else if (command === 'recover') {
			const email = process.argv[3];
			if (!email) throw new Error('Usage: node scripts/auth.mjs recover owner@example.com');
			const user = db.prepare("SELECT id FROM user WHERE email=? AND role='owner'").get(email);
			if (!user) throw new Error('Owner account not found.');
			db.exec('BEGIN IMMEDIATE');
			try {
				db.prepare('UPDATE user SET authVersion=authVersion+1 WHERE id=?').run(user.id);
				db.prepare('DELETE FROM session WHERE userId=?').run(user.id);
				db.prepare('DELETE FROM passkey WHERE userId=?').run(user.id);
				db.prepare(
					"UPDATE account SET password=NULL WHERE userId=? AND providerId='credential'"
				).run(user.id);
				db.prepare(
					"DELETE FROM verification WHERE value=? AND identifier LIKE 'reset-password:%'"
				).run(user.id);
				db.prepare(
					'INSERT INTO verification(id,identifier,value,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)'
				).run(
					randomBytes(16).toString('hex'),
					`reset-password:${token}`,
					String(user.id),
					Date.now() + 1800000,
					Date.now(),
					Date.now()
				);
				db.prepare('INSERT INTO auth_audit(actor,event,subject,created) VALUES(NULL,?,?,?)').run(
					'owner.recovery',
					user.id,
					Date.now()
				);
				db.exec('COMMIT');
			} catch (cause) {
				db.exec('ROLLBACK');
				throw cause;
			}
			console.log(
				`Sessions and passkeys revoked. Reset the owner password within 30 minutes:\n${process.env.PERILUNE_ORIGIN ?? 'http://localhost:4181'}/login#reset=${token}`
			);
		}
	} finally {
		db.close();
	}
}
try {
	main();
} catch (cause) {
	console.error(
		`Perilune: ${cause instanceof Error ? cause.message : 'Authentication command failed.'}`
	);
	process.exitCode = 1;
}
