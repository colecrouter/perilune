import { Cause, Effect, Option } from 'effect';
import { SqlError, UnknownError, isSqlError } from 'effect/sql/SqlError';
import { makeWithDefaults } from 'drizzle-orm/effect-sqlite-node';
import type { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';

/** Reuses the provided Effect SQLite client; no connection, cache or logger is added. */
export const makeDatabase = makeWithDefaults({ paramsInErrors: false });

/** Preserve existing service SqlError contracts without exposing ORM query parameters. */
export const databaseQuery = <A, R>(query: Effect.Effect<A, EffectDrizzleQueryError, R>) =>
	query.pipe(
		Effect.catch((error) => {
			if (Cause.isCause(error.cause)) {
				const failure = Cause.findErrorOption(error.cause);
				if (Option.isSome(failure) && isSqlError(failure.value)) return Effect.fail(failure.value);
			}
			return Effect.fail(
				new SqlError({
					reason: new UnknownError({
						cause: undefined,
						message: 'Database query failed.',
						operation: 'execute'
					})
				})
			);
		})
	);
