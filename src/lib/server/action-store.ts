import type { PidState } from '#lib/domain/pid.js';
import { emptyExtrusion, type ExtrusionState } from '#lib/domain/extrusion.js';
import { emptyMeshProbe, type MeshProbeState } from '#lib/domain/mesh-probe.js';
import { emptyCalibration, type CalibrationState } from '#lib/domain/calibration.js';
import { Context, Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import type { SqlError } from 'effect/sql/SqlError';
import type { ActionRecord, ActionStatus, PrinterCommand } from '#lib/domain/printer.js';
import type { JobFile, JobMetadata } from '#lib/domain/jobs.js';
import { recordJobOwner } from './job-attribution.js';
import { migrate } from './migrations.js';

export class ActionStore extends Context.Service<
	ActionStore,
	{
		commitStart: (id: string, owner: string) => Effect.Effect<void, SqlError>;
		pid: Effect.Effect<PidState, SqlError>;
		commitPid: (
			id: string,
			status: ActionStatus,
			message: string | null,
			state: PidState
		) => Effect.Effect<void, SqlError>;
		extrusion: Effect.Effect<ExtrusionState, SqlError>;
		writeExtrusion: (state: ExtrusionState) => Effect.Effect<void, SqlError>;
		commitExtrusion: (
			id: string,
			status: ActionStatus,
			message: string | null,
			state: ExtrusionState
		) => Effect.Effect<void, SqlError>;
		meshProbe: Effect.Effect<MeshProbeState, SqlError>;
		writeMeshProbe: (state: MeshProbeState) => Effect.Effect<void, SqlError>;
		commitMeshProbe: (
			id: string,
			status: ActionStatus,
			message: string | null,
			state: MeshProbeState
		) => Effect.Effect<void, SqlError>;
		calibration: Effect.Effect<CalibrationState, SqlError>;
		writeCalibration: (state: CalibrationState) => Effect.Effect<void, SqlError>;
		commitCalibration: (
			id: string,
			status: ActionStatus,
			message: string | null,
			state: CalibrationState
		) => Effect.Effect<void, SqlError>;
		list: Effect.Effect<ActionRecord[], SqlError>;
		jobFile: (id: string) => Effect.Effect<JobFile | undefined, SqlError>;
		find: (
			id: string
		) => Effect.Effect<
			{ action: ActionRecord; payload: string; actorId: string | null } | undefined,
			SqlError
		>;
		insert: (
			action: ActionRecord,
			command: PrinterCommand,
			actorId?: string
		) => Effect.Effect<void, SqlError>;
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
	actor_id: string | null;
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
		const writeCalibration = (state: CalibrationState) =>
			sql`INSERT INTO simulator_calibration (id, state) VALUES (1, ${JSON.stringify(state)}) ON CONFLICT(id) DO UPDATE SET state=excluded.state`.pipe(
				Effect.asVoid
			);
		const writeMeshProbe = (state: MeshProbeState) =>
			sql`INSERT INTO simulator_mesh_probe (id, state) VALUES (1, ${JSON.stringify(state)}) ON CONFLICT(id) DO UPDATE SET state=excluded.state`.pipe(
				Effect.asVoid
			);
		const writeExtrusion = (state: ExtrusionState) =>
			sql`INSERT INTO simulator_extrusion (id,state) VALUES (1,${JSON.stringify(state)}) ON CONFLICT(id) DO UPDATE SET state=excluded.state`.pipe(
				Effect.asVoid
			);
		return {
			commitStart: (id, owner) =>
				sql
					.withTransaction(
						Effect.gen(function* () {
							yield* recordJobOwner(id, id, owner);
							yield* sql`UPDATE actions SET status='completed',message=NULL WHERE id=${id}`;
						})
					)
					.pipe(Effect.provideService(SqlClient, sql)),
			pid: sql<{ state: string }>`SELECT state FROM pid_state WHERE target='simulator'`.pipe(
				Effect.map((rows) =>
					rows[0] ? (JSON.parse(rows[0].state) as PidState) : { enabled: true, run: null }
				)
			),
			commitPid: (id, status, message, state) =>
				sql.withTransaction(
					Effect.gen(function* () {
						yield* sql`INSERT INTO pid_state(target,state) VALUES('simulator',${JSON.stringify(state)}) ON CONFLICT(target) DO UPDATE SET state=excluded.state`;
						yield* sql`UPDATE actions SET status=${status}, message=${message} WHERE id=${id}`;
					})
				),
			extrusion: sql<{ state: string }>`SELECT state FROM simulator_extrusion WHERE id=1`.pipe(
				Effect.map((rows) =>
					rows[0] ? (JSON.parse(rows[0].state) as ExtrusionState) : emptyExtrusion()
				)
			),
			writeExtrusion,
			commitExtrusion: (id, status, message, state) =>
				sql.withTransaction(
					Effect.gen(function* () {
						yield* writeExtrusion(state);
						yield* sql`UPDATE actions SET status=${status}, message=${message} WHERE id=${id}`;
					})
				),
			meshProbe: sql<{ state: string }>`SELECT state FROM simulator_mesh_probe WHERE id=1`.pipe(
				Effect.map((rows) =>
					rows[0] ? (JSON.parse(rows[0].state) as MeshProbeState) : emptyMeshProbe()
				)
			),
			writeMeshProbe,
			commitMeshProbe: (id, status, message, state) =>
				sql.withTransaction(
					Effect.gen(function* () {
						yield* writeMeshProbe(state);
						yield* sql`UPDATE actions SET status=${status}, message=${message} WHERE id=${id}`;
					})
				),
			calibration: sql<{ state: string }>`SELECT state FROM simulator_calibration WHERE id=1`.pipe(
				Effect.map((rows) =>
					rows[0] ? (JSON.parse(rows[0].state) as CalibrationState) : emptyCalibration()
				)
			),
			writeCalibration,
			commitCalibration: (id, status, message, state) =>
				sql.withTransaction(
					Effect.gen(function* () {
						yield* writeCalibration(state);
						yield* sql`UPDATE actions SET status=${status}, message=${message} WHERE id=${id}`;
					})
				),
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
						rows[0]
							? { action: fromRow(rows[0]), payload: rows[0].payload, actorId: rows[0].actor_id }
							: undefined
					)
				),
			insert: (action, command, actorId) =>
				sql`INSERT INTO actions (id, payload, label, status, created_at, actor_id) VALUES (${action.id}, ${JSON.stringify(command)}, ${action.label}, ${action.status}, ${action.createdAt}, ${actorId ?? null})`.pipe(
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
