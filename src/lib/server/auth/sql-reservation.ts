import { Effect, Exit, Scope } from 'effect';
import type { SqlClient } from 'effect/sql/SqlClient';
import type { TransactionReservation } from './sqlite-dialect.js';

/** Reserve the process connection without starting a transaction on it. */
export const sqlTransactionReservation =
	(client: () => Promise<Pick<SqlClient, 'reserve'>>): TransactionReservation =>
	async () => {
		const sql = await client();
		const scope = Effect.runSync(Scope.make());
		try {
			await Effect.runPromise(Effect.provideService(sql.reserve, Scope.Scope, scope));
		} catch (cause) {
			await Effect.runPromise(Scope.close(scope, Exit.void));
			throw cause;
		}
		return () => Effect.runPromise(Scope.close(scope, Exit.void));
	};
