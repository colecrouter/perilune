import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, copyFile, chmod, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { realpathSync } from 'node:fs';
export async function backupInstallation(database, destination) {
	const target = resolve(destination);
	await mkdir(target, { mode: 0o700 });
	try {
		const db = new DatabaseSync(resolve(database), { readOnly: true });
		try {
			await backup(db, join(target, 'perilune.sqlite'));
		} finally {
			db.close();
		}
		await chmod(join(target, 'perilune.sqlite'), 0o600);
		const restored = new DatabaseSync(join(target, 'perilune.sqlite'), { readOnly: true });
		try {
			const checks = restored.prepare('PRAGMA quick_check').all();
			if (checks.some((row) => Object.values(row)[0] !== 'ok'))
				throw new Error('Backup integrity check failed.');
		} finally {
			restored.close();
		}
		let secret = 'external';
		if (!process.env.PERILUNE_AUTH_SECRET) {
			await copyFile(database + '.auth-secret', join(target, 'perilune.sqlite.auth-secret'));
			await chmod(join(target, 'perilune.sqlite.auth-secret'), 0o600);
			secret = 'file';
		}

		await writeFile(
			join(target, 'manifest.json'),
			JSON.stringify({ format: 1, created: new Date().toISOString(), secret }, null, 2) + '\n',
			{ mode: 0o600 }
		);
		return target;
	} catch (cause) {
		await rm(target, { recursive: true, force: true });
		throw cause;
	}
}
if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
	if (process.argv.length !== 3)
		throw new Error('Usage: node scripts/backup.mjs /private/backups/new-directory');
	const database = process.env.PERILUNE_DATABASE ?? './data/perilune.sqlite';
	console.log(await backupInstallation(database, process.argv[2]));
}
