import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { readFile, copyFile, chmod, mkdir, lstat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { realpathSync } from 'node:fs';

/** Restore only into a fresh destination. The caller must stop the app first. */
export async function restoreInstallation(source, database) {
	const directory = resolve(source),
		target = resolve(database);
	const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
	if (manifest.format !== 1 || !['file', 'external'].includes(manifest.secret))
		throw Error('Unsupported backup manifest');
	if (manifest.secret === 'external' && !process.env.PERILUNE_AUTH_SECRET)
		throw Error('Restore the original external PERILUNE_AUTH_SECRET first');
	if (manifest.secret === 'file' && process.env.PERILUNE_AUTH_SECRET)
		throw Error('This backup uses its saved secret file; remove the external secret override');
	for (const name of [target, target + '-wal', target + '-shm', target + '.auth-secret']) {
		try {
			await lstat(name);
		} catch (cause) {
			if (cause.code === 'ENOENT') continue;
			throw cause;
		}
		throw Error('Restore destination must be empty; preserve existing data and use a new volume');
	}
	const sourceDatabase = join(directory, 'perilune.sqlite');
	const db = new DatabaseSync(sourceDatabase, { readOnly: true });
	try {
		if (
			db
				.prepare('PRAGMA quick_check')
				.all()
				.some((row) => Object.values(row)[0] !== 'ok')
		)
			throw Error('Backup integrity check failed');
	} finally {
		db.close();
	}
	const secret =
		manifest.secret === 'file'
			? await readFile(join(directory, 'perilune.sqlite.auth-secret'))
			: null;
	if (secret && secret.toString().trim().length < 32) throw Error('Backup secret is invalid');
	await mkdir(dirname(target), { recursive: true, mode: 0o700 });
	// Exclusive copies never replace an existing file, even if another process races this check.
	await copyFile(sourceDatabase, target, constants.COPYFILE_EXCL);
	await chmod(target, 0o600);
	if (secret) {
		await copyFile(
			join(directory, 'perilune.sqlite.auth-secret'),
			target + '.auth-secret',
			constants.COPYFILE_EXCL
		);
		await chmod(target + '.auth-secret', 0o600);
	}
	return target;
}
if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
	if (process.argv.length !== 4 || process.argv[3] !== '--server-stopped')
		throw Error(
			'Usage: node scripts/restore.mjs BACKUP_DIRECTORY --server-stopped (fresh data directory only)'
		);
	console.log(
		await restoreInstallation(
			process.argv[2],
			process.env.PERILUNE_DATABASE ?? './data/perilune.sqlite'
		)
	);
}
