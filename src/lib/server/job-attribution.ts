import { Effect } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
/** Called inside the caller's transaction alongside the verified start receipt. */
export function recordJobOwner(
	runId: string,
	actionId: string,
	owner: string,
	historyKey?: string
) {
	return Effect.gen(function* () {
		const sql = yield* SqlClient;
		yield* sql`INSERT INTO job_attribution(run_id,action_id,owner,history_key,created) VALUES(${runId},${actionId},${owner},${historyKey ?? null},${Date.now()})`;
		yield* sql`DELETE FROM job_attribution WHERE run_id <> ${runId} AND run_id NOT IN (SELECT run_id FROM job_attribution WHERE run_id <> ${runId} ORDER BY created DESC,run_id DESC LIMIT 4999)`;
	});
}
export function jobOwner(runId?: string, historyKey?: string) {
	return Effect.gen(function* () {
		const sql = yield* SqlClient;
		const local = runId
			? yield* sql<{
					owner: string;
					history_key: string | null;
				}>`SELECT owner,history_key FROM job_attribution WHERE run_id=${runId}`
			: [];
		if (local[0]) {
			if (historyKey && local[0].history_key !== null && local[0].history_key !== historyKey)
				return null;
			return local[0].owner;
		}
		const durable = historyKey
			? yield* sql<{
					owner: string;
				}>`SELECT owner FROM job_attribution WHERE history_key=${historyKey}`
			: [];
		return durable[0]?.owner ?? null;
	});
}
