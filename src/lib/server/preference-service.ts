import { Context, Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import type { SqlError } from 'effect/sql/SqlError';
import {
	defaultPreferences,
	type Preferences,
	type PreferencePatch
} from '#lib/domain/preferences.js';
import { migrate } from './migrations.js';
export class PreferenceService extends Context.Service<
	PreferenceService,
	{
		get: (owner: string) => Effect.Effect<Preferences, SqlError>;
		patch: (owner: string, patch: PreferencePatch) => Effect.Effect<Preferences, SqlError>;
	}
>()('perilune/PreferenceService') {}
export const PreferenceServiceLive = Layer.effect(
	PreferenceService,
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		yield* migrate;
		const from = (value?: string): Preferences => ({
			...defaultPreferences,
			...(value ? JSON.parse(value) : {})
		});
		return {
			get: (owner) =>
				sql<{ value: string }>`SELECT value FROM user_preferences WHERE owner=${owner}`.pipe(
					Effect.map((rows) => from(rows[0]?.value))
				),
			// Merge in SQLite so simultaneous tabs changing different keys cannot replace
			// each other's settings. A patch contains validated display fields only.
			patch: (owner, patch) =>
				sql<{
					value: string;
				}>`INSERT INTO user_preferences(owner,value) VALUES(${owner},${JSON.stringify(patch)}) ON CONFLICT(owner) DO UPDATE SET value=json_patch(user_preferences.value,excluded.value) RETURNING value`.pipe(
					Effect.map((rows) => from(rows[0].value))
				)
		};
	})
);
