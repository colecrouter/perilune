import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupInstallation } from './backup.mjs';
import { restoreInstallation } from './restore.mjs';
void test('restore preserves database/secret and refuses to overwrite existing or partial destinations', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'perilune-restore-'));
	const saved = process.env.PERILUNE_AUTH_SECRET;
	delete process.env.PERILUNE_AUTH_SECRET;
	try {
		const filename = join(directory, 'source.sqlite');
		const db = new DatabaseSync(filename);
		db.exec("CREATE TABLE fixture(value TEXT);INSERT INTO fixture VALUES('before')");
		db.close();
		await writeFile(filename + '.auth-secret', 'a'.repeat(48));
		const backup = await backupInstallation(filename, join(directory, 'backup'));
		const target = join(directory, 'restored/state.sqlite');
		await restoreInstallation(backup, target);
		const restored = new DatabaseSync(target, { readOnly: true });
		assert.equal(restored.prepare('SELECT value FROM fixture').get().value, 'before');
		restored.close();
		assert.equal(await readFile(target + '.auth-secret', 'utf8'), 'a'.repeat(48));
		await assert.rejects(restoreInstallation(backup, target), /must be empty/);
		await writeFile(join(directory, 'partial.sqlite-wal'), 'retained');
		await assert.rejects(
			restoreInstallation(backup, join(directory, 'partial.sqlite')),
			/must be empty/
		);
		process.env.PERILUNE_AUTH_SECRET = 'external';
		await assert.rejects(
			restoreInstallation(backup, join(directory, 'wrong-secret.sqlite')),
			/remove the external/
		);
	} finally {
		if (saved === undefined) delete process.env.PERILUNE_AUTH_SECRET;
		else process.env.PERILUNE_AUTH_SECRET = saved;
		await rm(directory, { recursive: true, force: true });
	}
});
