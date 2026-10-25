import { Context, Effect, Layer } from 'effect';
import { and, eq, sql as expression } from 'drizzle-orm';
import { makeDatabase, databaseQuery } from './persistence/database.js';
import { filamentChangeSettings as settings } from './persistence/schema.js';
import { SqlClient } from 'effect/sql/SqlClient';
import type { SqlError } from 'effect/sql/SqlError';
import {
	defaultFilamentChangeSettings,
	type FilamentChangeSettings
} from '#lib/domain/filament-change.js';
import { migrate } from './migrations.js';
export class FilamentChangeStore extends Context.Service<
	FilamentChangeStore,
	{
		get: (target: string) => Effect.Effect<FilamentChangeSettings, SqlError>;
		put: (target: string, value: FilamentChangeSettings) => Effect.Effect<boolean, SqlError>;
	}
>()('perilune/FilamentChangeStore') {}
export const FilamentChangeStoreLive = Layer.effect(
	FilamentChangeStore,
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		const db = yield* makeDatabase;
		yield* migrate;
		return {
			get: (target) =>
				db
					.select({ revision: settings.revision, value: settings.value })
					.from(settings)
					.where(eq(settings.target, target))
					.pipe(
						databaseQuery,
						Effect.map((rows) =>
							rows[0]
								? { ...JSON.parse(rows[0].value), revision: rows[0].revision }
								: { ...defaultFilamentChangeSettings }
						)
					),
			put: (target, value) =>
				sql.withTransaction(
					Effect.gen(function* () {
						const locks =
							yield* sql`SELECT 1 FROM live_action_reservation WHERE target=${target} UNION ALL SELECT 1 FROM filament_change_sessions WHERE target=${target} AND json_extract(state,'$.stage') != 'finished'`;
						if (locks.length) return false;
						// Missing rows may only be created from revision zero. Existing rows
						// are updated only when their authoritative revision still matches.
						const rows = yield* (
							value.revision === 0
								? db
										.insert(settings)
										.values({ target, revision: 1, value: JSON.stringify(value) })
										.onConflictDoNothing({ target: settings.target })
										.returning({ revision: settings.revision })
								: db
										.update(settings)
										.set({
											revision: expression`${settings.revision} + 1`,
											value: JSON.stringify(value)
										})
										.where(and(eq(settings.target, target), eq(settings.revision, value.revision)))
										.returning({ revision: settings.revision })
						).pipe(databaseQuery);
						return rows.length === 1;
					})
				)
		};
	})
);
