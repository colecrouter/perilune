import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompiledQuery } from 'kysely';
import { expect, it } from 'vite-plus/test';
import { AuthSqliteDialect } from './sqlite-dialect.js';

it.each(['commit', 'rollback'] as const)(
	'reserves a writer before the first auth read and releases it after %s',
	async (completion) => {
		const directory = mkdtempSync(join(tmpdir(), 'perilune-auth-lock-'));
		const filename = join(directory, 'state.sqlite');
		const database = new DatabaseSync(filename);
		database.exec('PRAGMA journal_mode=WAL; CREATE TABLE fixture(value TEXT)');
		const other = new DatabaseSync(filename);
		other.exec('PRAGMA busy_timeout=0');
		const driver = new AuthSqliteDialect({ database }).createDriver();
		await driver.init();
		const connection = await driver.acquireConnection();
		try {
			await driver.beginTransaction(connection, {});
			await connection.executeQuery(CompiledQuery.raw('SELECT * FROM fixture'));
			// A deferred transaction allows this write, making auth's snapshot stale.
			expect(() => other.prepare('INSERT INTO fixture VALUES (?)').run('background')).toThrow(
				/database is locked/
			);
			await connection.executeQuery(CompiledQuery.raw("INSERT INTO fixture VALUES ('auth')"));
			if (completion === 'commit') await driver.commitTransaction(connection);
			else await driver.rollbackTransaction(connection);
			other.prepare('INSERT INTO fixture VALUES (?)').run('background');
			expect(other.prepare('SELECT value FROM fixture ORDER BY rowid').all()).toEqual(
				completion === 'commit'
					? [{ value: 'auth' }, { value: 'background' }]
					: [{ value: 'background' }]
			);
		} finally {
			if (database.isTransaction) await driver.rollbackTransaction(connection);
			await driver.releaseConnection(connection);
			await driver.destroy();
			other.close();
			rmSync(directory, { recursive: true, force: true });
		}
	}
);
