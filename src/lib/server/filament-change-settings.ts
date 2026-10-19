import { Context, Effect, Layer } from 'effect';
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
		yield* migrate;
		return {
			get: (target) =>
				sql<{
					revision: number;
					value: string;
				}>`SELECT revision,value FROM filament_change_settings WHERE target=${target}`.pipe(
					Effect.map((rows) =>
						rows[0]
							? { ...JSON.parse(rows[0].value), revision: rows[0].revision }
							: { ...defaultFilamentChangeSettings }
					)
				),
			put: (target, value) =>
				sql<{
					revision: number;
				}>`INSERT INTO filament_change_settings(target,revision,value) SELECT ${target},1,${JSON.stringify(value)} WHERE ${value.revision}=0 OR EXISTS(SELECT 1 FROM filament_change_settings WHERE target=${target}) ON CONFLICT(target) DO UPDATE SET revision=filament_change_settings.revision+1,value=${JSON.stringify(value)} WHERE filament_change_settings.revision=${value.revision} RETURNING revision`.pipe(
					Effect.map((rows) => rows.length === 1)
				)
		};
	})
);
