import { Effect } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import * as Migrator from 'effect/sql/Migrator';

export const migrate = Migrator.make({})({
	loader: Migrator.fromRecord({
		'001_actions': Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`CREATE TABLE actions (
				id TEXT PRIMARY KEY, payload TEXT NOT NULL, label TEXT NOT NULL,
				status TEXT NOT NULL, created_at INTEGER NOT NULL, message TEXT
			)`;
		})
	})
});
