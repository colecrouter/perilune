import { safetyReason } from './safety.js';
import { Schema } from 'effect';
import type { CalibrationActor } from './calibration.js';
import { calibrationActive } from './calibration.js';
import { meshProbeActive } from './mesh-probe.js';
import { CommandRejected } from './errors.js';
import type { PrinterSnapshot } from './printer.js';

const runId = Schema.String.check(Schema.isUUID());
export const ExtrusionCommand = Schema.Union([
	Schema.Struct({
		type: Schema.Literal('extrusionBegin'),
		runId,
		rotationDistance: Schema.Number,
		before: Schema.Number,
		confirmed: Schema.Boolean
	}),
	Schema.Struct({
		type: Schema.Literal('extrusionFeed'),
		runId,
		distance: Schema.Literals([-25, -10, -5, 5, 10, 25]),
		confirmed: Schema.Boolean
	}),
	Schema.Struct({ type: Schema.Literal('extrusionMeasure'), runId, after: Schema.Number }),
	Schema.Struct({ type: Schema.Literal('extrusionFinish'), runId, coolNozzle: Schema.Boolean }),
	Schema.Struct({
		type: Schema.Literal('extrusionCancel'),
		runId,
		coolNozzle: Schema.Boolean,
		force: Schema.optional(Schema.Boolean)
	})
]);
export type ExtrusionCommand = typeof ExtrusionCommand.Type;
export interface ExtrusionProposal {
	rotationDistance: number;
	before: number;
	after: number;
	actual: number;
	proposed: number;
	repeat: boolean;
}
export interface ExtrusionSession {
	id: string;
	ownerId: string;
	ownerName: string;
	stage: 'feeding' | 'extruding' | 'measure' | 'review' | 'finished' | 'cancelled' | 'interrupted';
	distance: number;
	completed: number;
	rotationDistance: number | null;
	before: number | null;
	proposal: ExtrusionProposal | null;
	expiresAt: number;
	message: string | null;
}
export interface ExtrusionState {
	session: ExtrusionSession | null;
}
export const emptyExtrusion = (): ExtrusionState => ({ session: null });
export const extrusionActive = (state: ExtrusionState) =>
	Boolean(
		state.session && ['feeding', 'extruding', 'measure', 'review'].includes(state.session.stage)
	);
export function calculateExtrusion(
	rotationDistance: number,
	before: number,
	after: number
): ExtrusionProposal {
	if (
		![rotationDistance, before, after].every(Number.isFinite) ||
		rotationDistance < 0.001 ||
		rotationDistance > 1000 ||
		before < 50 ||
		before > 200 ||
		after < 0 ||
		after >= before
	)
		throw new CommandRejected({
			message:
				'Use a positive rotation distance, an initial mark 50–200 mm from the intake, and a remaining distance smaller than that mark.'
		});
	const actual = before - after;
	if (actual < 25 || actual > 75)
		throw new CommandRejected({
			message:
				'Travel differs too much from 50 mm. Check the measurement, slipping, and nozzle blockage before trying again.'
		});
	return {
		rotationDistance,
		before,
		after,
		actual,
		proposed: Math.round(((rotationDistance * actual) / 50) * 1000) / 1000,
		repeat: Math.abs(actual - 50) > 2
	};
}
export function extrusionReason(state: PrinterSnapshot, pending = true): string | null {
	const safety = safetyReason(state.safety);
	if (safety) return safety;
	if (state.liveRecovery) return state.liveRecovery.message;
	if (state.configurationBusy) return 'Configuration recovery owns the printer.';
	if (state.mode !== 'simulator' && !state.liveControls)
		return 'Live filament movement requires coordinated testing. The measurement calculator is available below.';
	if (state.connection !== 'connected' || state.klippy !== 'ready' || !state.telemetryReady)
		return 'Wait for a ready printer connection.';
	if (state.storage !== 'healthy') return 'Action storage is recovering.';
	if (!['standby', 'complete', 'cancelled'].includes(state.job.state))
		return 'Finish or stop the current job first.';
	if (
		calibrationActive(state.calibration) ||
		meshProbeActive(state.meshProbe) ||
		(state.motion.calibration && !extrusionActive(state.extrusion))
	)
		return 'Another calibration owns the printer.';
	if (state.motion.busy !== false) return 'The printer is busy or its readiness is unknown.';
	if (pending && state.actions.some((a) => ['queued', 'sending'].includes(a.status)))
		return 'Wait for the pending action.';
	if (
		state.mode === 'moonraker' &&
		(!state.filament?.canExtrude ||
			state.filament.active !== 'extruder' ||
			state.filament.position === null)
	)
		return 'Wait for a hot, ready primary extruder with known position.';
	const { current, target } = state.heaters.nozzle;
	if (
		current === null ||
		target === null ||
		!Number.isFinite(current) ||
		!Number.isFinite(target) ||
		target < 170 ||
		target > 280 ||
		current < 170 ||
		current > 285 ||
		Math.abs(current - target) > 5
	)
		return 'Heat the nozzle to the filament’s printing temperature (170–280°C application range; the printer must also permit extrusion) and wait until it settles.';
	return null;
}
export function interruptExtrusion(state: ExtrusionState, message: string): ExtrusionState {
	return extrusionActive(state)
		? { session: { ...state.session!, stage: 'interrupted', message } }
		: state;
}
export function advanceExtrusion(state: ExtrusionState, now = Date.now()): ExtrusionState {
	if (!extrusionActive(state)) return state;
	const session = state.session!;
	if (session.expiresAt <= now)
		return interruptExtrusion(state, 'The workflow expired. It was not resumed.');
	if (!['feeding', 'extruding'].includes(session.stage)) return state;
	const completed = Math.min(Math.abs(session.distance), session.completed + 1);
	return {
		session: {
			...session,
			completed,
			stage:
				completed < Math.abs(session.distance)
					? session.stage
					: session.stage === 'feeding'
						? 'finished'
						: 'measure'
		}
	};
}
export function applyExtrusion(
	state: PrinterSnapshot,
	command: ExtrusionCommand,
	actor?: CalibrationActor
): PrinterSnapshot {
	const reject = (message: string): never => {
		throw new CommandRejected({ message });
	};
	if (!actor || !['owner', 'operator'].includes(actor.role ?? '') || actor.authorized?.() === false)
		reject('An authorized operator is required.');
	if (state.mode !== 'simulator') reject('Live extrusion is not enabled.');
	const next = structuredClone(state);
	if (command.type === 'extrusionBegin' || command.type === 'extrusionFeed') {
		if (extrusionActive(state.extrusion))
			reject('Finish or cancel the current filament workflow first.');
		const reason = extrusionReason(state, false);
		if (reason) reject(reason);
		if (!command.confirmed) reject('Confirm loaded filament and clear nozzle space.');
		if (command.type === 'extrusionBegin')
			calculateExtrusion(command.rotationDistance, command.before, command.before - 50);
		next.extrusion = {
			session: {
				id: command.runId,
				ownerId: actor!.id,
				ownerName: actor!.name,
				stage: command.type === 'extrusionBegin' ? 'extruding' : 'feeding',
				distance: command.type === 'extrusionBegin' ? 50 : command.distance,
				completed: 0,
				rotationDistance: command.type === 'extrusionBegin' ? command.rotationDistance : null,
				before: command.type === 'extrusionBegin' ? command.before : null,
				proposal: null,
				expiresAt: Date.now() + 10 * 60_000,
				message: null
			}
		};
	} else {
		const session = next.extrusion.session;
		if (!session || !extrusionActive(next.extrusion) || session.id !== command.runId)
			reject('This filament workflow is no longer active.');
		if (
			session!.ownerId !== actor!.id &&
			!(command.type === 'extrusionCancel' && command.force && actor!.role === 'owner')
		)
			reject('Another operator owns this workflow.');
		if (session!.expiresAt <= Date.now() && command.type !== 'extrusionCancel')
			reject('The workflow expired.');
		if (command.type === 'extrusionMeasure') {
			if (session!.stage !== 'measure') reject('Wait until the measured extrusion finishes.');
			session!.proposal = calculateExtrusion(
				session!.rotationDistance!,
				session!.before!,
				command.after
			);
			session!.stage = 'review';
			session!.expiresAt = Date.now() + 10 * 60_000;
		} else {
			if (command.type === 'extrusionFinish' && session!.stage !== 'review')
				reject('Review a measured result before finishing.');
			session!.stage = command.type === 'extrusionCancel' ? 'cancelled' : 'finished';
			if (command.coolNozzle) next.heaters.nozzle.target = 0;
		}
	}
	next.motion.calibration = extrusionActive(next.extrusion);
	return next;
}
