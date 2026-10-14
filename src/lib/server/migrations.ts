import { Effect } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import * as Migrator from 'effect/sql/Migrator';

export const migrate = Migrator.make({})({
	loader: Migrator.fromRecord({
		'003_calibration': Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`ALTER TABLE actions ADD COLUMN actor_id TEXT`;
			yield* sql`CREATE TABLE simulator_calibration (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)`;
		}),
		'002_jobs': Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`CREATE TABLE job_files (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, modified INTEGER NOT NULL, hash TEXT NOT NULL, metadata TEXT NOT NULL, content BLOB NOT NULL)`;
			yield* sql`CREATE TABLE print_runs (id TEXT PRIMARY KEY, filename TEXT NOT NULL, started INTEGER NOT NULL, ended INTEGER, state TEXT NOT NULL, progress REAL)`;
			yield* sql`CREATE TABLE slicer_keys (id TEXT PRIMARY KEY, owner TEXT NOT NULL, epoch INTEGER NOT NULL, hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, suffix TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)`;
		}),
		'001_actions': Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`CREATE TABLE actions (
				id TEXT PRIMARY KEY, payload TEXT NOT NULL, label TEXT NOT NULL,
				status TEXT NOT NULL, created_at INTEGER NOT NULL, message TEXT
			)`;
		})
	})
});
