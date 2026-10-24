import { NodeSqliteDialect } from '@better-auth/kysely-adapter/node-sqlite-dialect';
import { CompiledQuery } from 'kysely';

/** Reserve the writer before Better Auth reads data it will later modify. */
export class AuthSqliteDialect extends NodeSqliteDialect {
	override createDriver() {
		const driver = super.createDriver();
		driver.beginTransaction = async (connection) => {
			await connection.executeQuery(CompiledQuery.raw('begin immediate'));
		};
		return driver;
	}
}
