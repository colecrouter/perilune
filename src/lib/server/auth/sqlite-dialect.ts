import {
	NodeSqliteDialect,
	type NodeSqliteDialectConfig
} from '@better-auth/kysely-adapter/node-sqlite-dialect';
import { CompiledQuery } from 'kysely';

export type TransactionReservation = () => Promise<() => Promise<void>>;

/** Reserve the process SQL connection before taking SQLite's writer lock. */
export class AuthSqliteDialect extends NodeSqliteDialect {
	constructor(
		private readonly options: NodeSqliteDialectConfig,
		private readonly reserve?: TransactionReservation
	) {
		super(options);
	}
	override createDriver() {
		const driver = super.createDriver();
		let release: (() => Promise<void>) | undefined;
		const releaseReservation = async () => {
			const current = release;
			release = undefined;
			await current?.();
		};
		driver.beginTransaction = async (connection) => {
			release = await this.reserve?.();
			try {
				await connection.executeQuery(CompiledQuery.raw('begin immediate'));
			} catch (cause) {
				await releaseReservation();
				throw cause;
			}
		};
		for (const operation of ['commitTransaction', 'rollbackTransaction'] as const) {
			const original = driver[operation].bind(driver);
			driver[operation] = async (connection) => {
				try {
					await original(connection);
				} finally {
					if (!this.options.database.isTransaction) await releaseReservation();
				}
			};
		}
		const destroy = driver.destroy.bind(driver);
		driver.destroy = async () => {
			try {
				await destroy();
			} finally {
				await releaseReservation();
			}
		};
		return driver;
	}
}
