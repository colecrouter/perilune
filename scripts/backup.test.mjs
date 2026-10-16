import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupInstallation } from './backup.mjs';
test('online snapshot includes WAL data, signing secret and private permissions; refuses overwrite', async () => {
	const originalSecret = process.env.PERILUNE_AUTH_SECRET;
	delete process.env.PERILUNE_AUTH_SECRET;
	const root = await mkdtemp(join(tmpdir(), 'perilune-backup-test-'));
	const database = join(root, 'source.sqlite'),
		target = join(root, 'backup');
	const db = new DatabaseSync(database);
	try {
		db.exec(
			"PRAGMA journal_mode=WAL; CREATE TABLE acceptance(value TEXT); INSERT INTO acceptance VALUES ('persisted');"
		);
		await writeFile(database + '.auth-secret', 'private-test-secret');
		await backupInstallation(database, target);
		const copy = new DatabaseSync(join(target, 'perilune.sqlite'));
		assert.equal(copy.prepare('SELECT value FROM acceptance').get().value, 'persisted');
		copy.close();
		assert.equal(
			await readFile(join(target, 'perilune.sqlite.auth-secret'), 'utf8'),
			'private-test-secret'
		);
		assert.equal((await stat(target)).mode & 0o777, 0o700);
		assert.equal((await stat(join(target, 'perilune.sqlite'))).mode & 0o777, 0o600);
		await assert.rejects(backupInstallation(database, target));
		assert.equal(JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8')).secret, 'file');
		process.env.PERILUNE_AUTH_SECRET = 'external-secret-overrides-stale-file';
		await backupInstallation(database, join(root, 'external'));
		assert.equal(
			JSON.parse(await readFile(join(root, 'external/manifest.json'), 'utf8')).secret,
			'external'
		);
		await assert.rejects(access(join(root, 'external/perilune.sqlite.auth-secret')));
	} finally {
		if (originalSecret === undefined) delete process.env.PERILUNE_AUTH_SECRET;
		else process.env.PERILUNE_AUTH_SECRET = originalSecret;
		db.close();
		await rm(root, { recursive: true, force: true });
	}
});
