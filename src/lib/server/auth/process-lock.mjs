/**
 * This installation runs in one process/OS namespace. The SQLite transaction
 * serializes startup and local recovery; stale process IDs are reclaimed.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {boolean} reuseCurrentProcess
 */
export function claimProcess(db, reuseCurrentProcess = false) {
	db.exec('BEGIN IMMEDIATE');
	try {
		const previous = db.prepare('SELECT pid FROM auth_process WHERE id=1').get();
		const pid = Number(previous?.pid);
		if (previous && !(reuseCurrentProcess && pid === process.pid)) {
			try {
				process.kill(pid, 0);
				throw new Error(
					'Stop Perilune before recovering credentials or starting another process with this database.'
				);
			} catch (cause) {
				if (/** @type {NodeJS.ErrnoException} */ (cause).code !== 'ESRCH') throw cause;
			}
		}
		db.prepare(
			'INSERT INTO auth_process VALUES(1,?) ON CONFLICT(id) DO UPDATE SET pid=excluded.pid'
		).run(process.pid);
		db.exec('COMMIT');
	} catch (cause) {
		db.exec('ROLLBACK');
		throw cause;
	}
}
