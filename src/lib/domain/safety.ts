import { Schema } from 'effect';
import type { ActionRecord } from './printer.js';
const identity = Schema.Struct({
	filename: Schema.String,
	runId: Schema.String.check(Schema.isUUID())
});
export const SafetyRequest = Schema.Struct({
	id: Schema.String.check(Schema.isUUID()),
	confirmed: Schema.Literal(true),
	operation: Schema.Union([
		Schema.Struct({
			type: Schema.Literal('stop'),
			recoveryOf: Schema.String.check(Schema.isUUID()),
			expectedJob: identity
		}),
		Schema.Struct({
			type: Schema.Literal('cooldown'),
			recoveryOf: Schema.String.check(Schema.isUUID())
		}),
		Schema.Struct({
			type: Schema.Literal('abortProbe'),
			recoveryOf: Schema.String.check(Schema.isUUID())
		}),
		Schema.Struct({ type: Schema.Literal('emergency') })
	])
});
export type SafetyRequest = typeof SafetyRequest.Type;
export interface SafetyAction extends ActionRecord {
	kind: SafetyRequest['operation']['type'];
	acknowledged: boolean;
	observed: boolean;
	reviewedAt: number | null;
}
export interface SafetySnapshot {
	enabled: boolean;
	halted: boolean;
	actions: SafetyAction[];
}
export function safetyReason(safety?: SafetySnapshot): string | null {
	if (safety?.halted)
		return 'Emergency stop interlock is active. Resolve the hazard, restart Klipper and review safety before continuing.';
	if (safety?.actions.some((a) => ['queued', 'sending'].includes(a.status)))
		return 'A safety action is pending.';
	if (safety?.actions.some((a) => a.status === 'unknown' && a.reviewedAt === null))
		return 'Review the unknown safety action before continuing. It was not replayed.';
	return null;
}
export function parseSafetyForm(data: FormData): SafetyRequest {
	const field = (name: string) => {
		const values = data.getAll(name);
		if (values.length !== 1 || typeof values[0] !== 'string')
			throw new Error('Missing or repeated safety field.');
		return values[0];
	};
	const type = field('intent');
	const operation =
		type === 'stop'
			? {
					type,
					recoveryOf: field('recoveryOf'),
					expectedJob: { filename: field('filename'), runId: field('runId') }
				}
			: type === 'cooldown' || type === 'abortProbe'
				? { type, recoveryOf: field('recoveryOf') }
				: { type };
	if (field('confirmed') !== 'true') throw new Error('Confirm this safety action.');
	return Schema.decodeUnknownSync(SafetyRequest)({ id: field('id'), confirmed: true, operation });
}
