import { Schema } from 'effect';
export const LiveZCommand = Schema.Union([
	Schema.Struct({
		type: Schema.Literal('zProbeBegin'),
		run: Schema.String.check(Schema.isUUID()),
		confirmed: Schema.Literal(true)
	}),
	Schema.Struct({
		type: Schema.Literal('zProbeAdjust'),
		run: Schema.String.check(Schema.isUUID()),
		version: Schema.Int,
		expectedZ: Schema.Number.check(Schema.isFinite()),
		delta: Schema.Literals([-0.1, -0.05, -0.01, -0.005, 0.005, 0.01, 0.05, 0.1])
	}),
	Schema.Struct({
		type: Schema.Literal('zProbeAccept'),
		run: Schema.String.check(Schema.isUUID()),
		version: Schema.Int,
		expectedZ: Schema.Number.check(Schema.isFinite()),
		confirmed: Schema.Literal(true)
	}),
	Schema.Struct({
		type: Schema.Literal('zProbeAbort'),
		run: Schema.String.check(Schema.isUUID()),
		version: Schema.Int,
		confirmed: Schema.Literal(true)
	})
]);
export type LiveZCommand = typeof LiveZCommand.Type;
export interface ZProbeCapability {
	method: 'probe' | 'endstop' | null;
	active: boolean;
	z: number | null;
	offset: [number, number] | null;
	pending: boolean;
	pendingKeys: string[];
	pendingOffset: number | null;
}
export interface LiveZSession {
	id: string;
	ownerId: string;
	ownerName: string;
	version: number;
	stage: 'active' | 'staged' | 'resolved' | 'aborted' | 'interrupted';
	method: 'probe' | 'endstop';
	z: number | null;
	candidate: number | null;
	startedAt: number;
	expiresAt: number;
	message: string | null;
}
export interface LiveZState {
	session: LiveZSession | null;
}
export const liveZActive = (s?: LiveZState) => s?.session?.stage === 'active';
export function interruptLiveZ(s: LiveZState, message: string): LiveZState {
	return liveZActive(s)
		? { session: { ...s.session!, stage: 'interrupted', version: s.session!.version + 1, message } }
		: s;
}
