import { Context, Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import type { SqlError } from 'effect/sql/SqlError';
import type { ActionRecord, ActionStatus, PrinterCommand } from '#lib/domain/printer.js';
import type { JobFile, JobMetadata } from '#lib/domain/jobs.js';
import { migrate } from './migrations.js';

export class ActionStore extends Context.Service<
	ActionStore,
	{
		list: Effect.Effect<ActionRecord[], SqlError>;
		jobFile: (id: string) => Effect.Effect<JobFile | undefined, SqlError>;
		find: (
			id: string
		) => Effect.Effect<{ action: ActionRecord; payload: string } | undefined, SqlError>;
		insert: (action: ActionRecord, command: PrinterCommand) => Effect.Effect<void, SqlError>;
		setStatus: (
			id: string,
			status: ActionStatus,
			message: string | null
		) => Effect.Effect<void, SqlError>;
		probe: Effect.Effect<void, SqlError>;
	}
>()('perilune/ActionStore') {}

interface StoredAction {
	id: string;
	payload: string;
	label: string;
	status: ActionStatus;
	created_at: number;
	message: string | null;
}
const fromRow = (row: StoredAction): ActionRecord => ({
	id: row.id,
	label: row.label,
	status: row.status,
	createdAt: row.created_at,
	message: row.message
});

export const ActionStoreLive = Layer.effect(
	ActionStore,
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		yield* migrate;
		// A process restart cannot establish whether a sent command completed. Never replay it.
		yield* sql`UPDATE actions SET status = 'unknown', message = 'Backend restarted. This action was not replayed.' WHERE status IN ('queued', 'sending')`;
		return {
			jobFile: (id) =>
				sql<{
					id: string;
					name: string;
					size: number;
					modified: number;
					metadata: string;
				}>`SELECT id,name,size,modified,metadata FROM job_files WHERE id=${id}`.pipe(
					Effect.map((rows) =>
						rows[0]
							? {
									...rows[0],
									source: 'local' as const,
									metadata: JSON.parse(rows[0].metadata) as JobMetadata
								}
							: undefined
					)
				),
			list: sql<StoredAction>`SELECT * FROM actions ORDER BY created_at DESC LIMIT 20`.pipe(
				Effect.map((rows) => rows.map(fromRow))
			),
			find: (id) =>
				sql<StoredAction>`SELECT * FROM actions WHERE id = ${id}`.pipe(
					Effect.map((rows) =>
						rows[0] ? { action: fromRow(rows[0]), payload: rows[0].payload } : undefined
					)
				),
			insert: (action, command) =>
				sql`INSERT INTO actions (id, payload, label, status, created_at) VALUES (${action.id}, ${JSON.stringify(command)}, ${action.label}, ${action.status}, ${action.createdAt})`.pipe(
					Effect.asVoid
				),
			setStatus: (id, status, message) =>
				sql`UPDATE actions SET status = ${status}, message = ${message} WHERE id = ${id}`.pipe(
					Effect.asVoid
				),
			probe: sql`SELECT 1`.pipe(Effect.asVoid)
		};
	})
);
