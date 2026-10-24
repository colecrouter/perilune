import { Effect } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import type { PrinterSnapshot, FailureNotice } from '#lib/domain/printer.js';

/** Receipts remain immutable history. Only unresolved, unacknowledged failures are alerts. */
export const failureNotices = (snapshot: PrinterSnapshot, owner: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		const ordinary = yield* sql<{ id: string }>`SELECT a.id FROM actions a
			WHERE a.status='failed' AND a.actor_id=${owner}
			AND a.id IN (SELECT value FROM json_each(${JSON.stringify(snapshot.actions.map((a) => a.id))}))
			AND NOT EXISTS (SELECT 1 FROM failure_notice_acknowledgements ack WHERE ack.owner=${owner} AND ack.receipt=a.id)
			AND NOT EXISTS (SELECT 1 FROM actions resolved
				WHERE resolved.status='completed' AND resolved.created_at>=a.created_at
				AND json_extract(a.payload,'$.type') LIKE 'meshProbe%'
				AND json_extract(resolved.payload,'$.type') IN ('meshProbeCancel','meshProbeFinish','meshProbeReconcile')
				AND json_extract(resolved.payload,'$.probeId')=json_extract(a.payload,'$.probeId'))`;
		const safety = yield* sql<{ id: string }>`SELECT a.id FROM safety_actions a
			WHERE a.actor=${owner} AND json_extract(a.record,'$.status')='failed'
			AND a.id IN (SELECT value FROM json_each(${JSON.stringify((snapshot.safety?.actions ?? []).map((a) => a.id))}))
			AND json_extract(a.record,'$.reviewedAt') IS NULL
			AND NOT EXISTS (SELECT 1 FROM failure_notice_acknowledgements ack WHERE ack.owner=${owner} AND ack.receipt=a.id)`;
		const ordinaryIds = new Set(ordinary.map((r) => r.id));
		const safetyIds = new Set(safety.map((r) => r.id));
		return [
			...snapshot.actions
				.filter((a) => ordinaryIds.has(a.id))
				.map((a): FailureNotice => ({ ...a, path: '/actions' })),
			...(snapshot.safety?.actions ?? [])
				.filter((a) => safetyIds.has(a.id))
				.map((a): FailureNotice => ({ ...a, path: '/safety' }))
		].sort((a, b) => b.createdAt - a.createdAt);
	});
export const withFailureNotices = (snapshot: PrinterSnapshot, owner: string) =>
	failureNotices(snapshot, owner).pipe(
		Effect.map((notices) => ({ ...snapshot, failureNotices: notices }))
	);

export const acknowledgeFailures = (
	snapshot: PrinterSnapshot,
	owner: string,
	ids: readonly string[]
) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		const visible = yield* failureNotices(snapshot, owner);
		yield* sql.withTransaction(
			Effect.gen(function* () {
				for (const notice of visible)
					if (ids.includes(notice.id))
						yield* sql`INSERT OR IGNORE INTO failure_notice_acknowledgements(owner,receipt) VALUES(${owner},${notice.id})`;
			})
		);
	});
