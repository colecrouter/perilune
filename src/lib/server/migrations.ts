import { Effect } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import * as Migrator from 'effect/sql/Migrator';

export const migrate = Migrator.make({})({
	loader: Migrator.fromRecord({
		'012_safety_actions': Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`CREATE TABLE printer_safety_state(target TEXT PRIMARY KEY, token TEXT NOT NULL, halted INTEGER NOT NULL)`;
			yield* sql`CREATE TABLE safety_actions(id TEXT PRIMARY KEY, target TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL, record TEXT NOT NULL)`;
		}),
		'011_live_actions': Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`CREATE TABLE live_action_reservation(target TEXT PRIMARY KEY, action_id TEXT NOT NULL)`;
		}),
		'010_console': Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`CREATE TABLE console_commands(id TEXT PRIMARY KEY,owner TEXT NOT NULL,script TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,message TEXT,output TEXT NOT NULL)`;
			yield* sql`CREATE TABLE macro_shortcuts(owner TEXT NOT NULL,name TEXT NOT NULL,PRIMARY KEY(owner,name))`;
		}),
		'009_notifications': Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`CREATE TABLE push_keys (id INTEGER PRIMARY KEY CHECK(id=1), public_key TEXT NOT NULL, private_key TEXT NOT NULL)`;
			yield* sql`CREATE TABLE push_devices (id TEXT PRIMARY KEY, owner TEXT NOT NULL, epoch INTEGER NOT NULL, endpoint TEXT NOT NULL UNIQUE, subscription TEXT NOT NULL, preferences TEXT NOT NULL, updated INTEGER NOT NULL)`;
			yield* sql`CREATE TABLE push_deliveries (event TEXT NOT NULL, device TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(event,device))`;
			yield* sql`CREATE TABLE push_images (id TEXT PRIMARY KEY, owner TEXT NOT NULL, epoch INTEGER NOT NULL, bytes BLOB NOT NULL, mime TEXT NOT NULL, expires INTEGER NOT NULL)`;
		}),
		'008_config_applications': Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`CREATE TABLE config_applications(id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, fingerprint TEXT NOT NULL, record TEXT NOT NULL, before_text TEXT NOT NULL, after_text TEXT NOT NULL, expires_at INTEGER NOT NULL)`;
		}),
		'007_configuration': Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`CREATE TABLE config_files(path TEXT PRIMARY KEY,text TEXT NOT NULL,version TEXT NOT NULL,updated_at INTEGER NOT NULL)`;
			yield* sql`CREATE TABLE config_backups(id TEXT PRIMARY KEY,path TEXT NOT NULL,text TEXT NOT NULL,created_at INTEGER NOT NULL,actor TEXT NOT NULL)`;
			yield* sql`CREATE TABLE config_saves(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,created_at INTEGER NOT NULL)`;
		}),
		'006_extrusion': Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`CREATE TABLE simulator_extrusion (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)`;
		}),
		'005_live_mesh': Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`CREATE TABLE live_mesh_workflow (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)`;
		}),
		'004_mesh_probe': Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`CREATE TABLE simulator_mesh_probe (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)`;
		}),
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
