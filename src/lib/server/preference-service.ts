import { Context, Effect, Layer } from 'effect';
import { eq, sql } from 'drizzle-orm';
import { makeDatabase, databaseQuery } from './persistence/database.js';
import { userPreferences } from './persistence/schema.js';
import type { SqlError } from 'effect/sql/SqlError';
import {
	defaultPreferences,
	type Preferences,
	type PreferencePatch
} from '#lib/domain/preferences.js';
import { overviewLayout } from '#lib/domain/overview-layout.js';
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
		const db = yield* makeDatabase;
		yield* migrate;
		const from = (value?: string): Preferences => {
			const stored = value ? JSON.parse(value) : {};
			return {
				...defaultPreferences,
				...stored,
				overviewLayout: overviewLayout(stored.overviewLayout)
			};
		};
		return {
			get: (owner) =>
				db
					.select({ value: userPreferences.value })
					.from(userPreferences)
					.where(eq(userPreferences.owner, owner))
					.pipe(
						databaseQuery,
						Effect.map((rows) => from(rows[0]?.value))
					),
			// Merge in SQLite so simultaneous tabs changing different keys cannot replace
			// each other's settings. A patch contains validated display fields only.
			patch: (owner, patch) =>
				db
					.insert(userPreferences)
					.values({ owner, value: JSON.stringify(patch) })
					.onConflictDoUpdate({
						target: userPreferences.owner,
						set: { value: sql`json_patch(${userPreferences.value}, excluded.value)` }
					})
					.returning({ value: userPreferences.value })
					.pipe(
						databaseQuery,
						Effect.map((rows) => from(rows[0].value))
					)
		};
	})
);
