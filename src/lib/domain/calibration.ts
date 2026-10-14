import { Schema } from 'effect';
import { CommandRejected } from './errors.js';
import { motionReason } from './motion.js';
import type { PrinterSnapshot } from './printer.js';
export const CALIBRATION_IDLE_MS = 10 * 60 * 1000;
export const calibrationSteps = [0.005, 0.01, 0.05, 0.1] as const;
const session = {
	sessionId: Schema.String.check(Schema.isUUID()),
	version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
};
export const CalibrationCommand = Schema.Union([
	Schema.Struct({
		type: Schema.Literal('calibrationBegin'),
		sessionId: Schema.String.check(Schema.isUUID()),
		expectedOffset: Schema.Number.check(Schema.isFinite()),
		confirmed: Schema.Boolean
	}),
	Schema.Struct({
		type: Schema.Literal('calibrationAdjust'),
		...session,
		delta: Schema.Literals([-0.1, -0.05, -0.01, -0.005, 0.005, 0.01, 0.05, 0.1])
	}),
	Schema.Struct({
		type: Schema.Literal('calibrationStage'),
		...session,
		stage: Schema.Literals(['adjusting', 'first-layer', 'review']),
		confirmed: Schema.optional(Schema.Boolean)
	}),
	Schema.Struct({
		type: Schema.Literal('calibrationFinish'),
		...session,
		outcome: Schema.Literals(['apply', 'save'])
	}),
	Schema.Struct({
		type: Schema.Literal('calibrationCancel'),
		...session,
		confirmed: Schema.Boolean,
		force: Schema.optional(Schema.Boolean)
	})
]);
export type CalibrationCommand = typeof CalibrationCommand.Type;
export interface CalibrationActor {
	id: string;
	name: string;
	role?: string;
	authorized?: () => boolean;
}
export interface CalibrationSession {
	id: string;
	version: number;
	ownerId: string;
	ownerName: string;
	stage: 'adjusting' | 'first-layer' | 'review' | 'applied' | 'saved' | 'cancelled' | 'interrupted';
	baseline: number;
	candidate: number;
	startedAt: number;
	expiresAt: number;
	message: string | null;
}
export interface CalibrationState {
	savedOffset: number;
	appliedOffset: number;
	session: CalibrationSession | null;
}
export const emptyCalibration = (): CalibrationState => ({
	savedOffset: 0,
	appliedOffset: 0,
	session: null
});
export const calibrationActive = (state: CalibrationState): boolean =>
	Boolean(state.session && ['adjusting', 'first-layer', 'review'].includes(state.session.stage));
export function calibrationReason(state: PrinterSnapshot, pending = true): string | null {
	const reason = motionReason(state, ['x', 'y', 'z'], false, pending);
	if (reason) return reason;
	if (state.heaters.nozzle.target !== 0 || state.heaters.bed.target !== 0)
		return 'Turn off both heater targets before starting this simulator workflow.';
	return null;
}
export function interruptCalibration(state: CalibrationState, message: string): CalibrationState {
	if (!calibrationActive(state)) return state;
	return {
		...state,
		appliedOffset: state.session!.baseline,
		session: {
			...state.session!,
			stage: 'interrupted',
			version: state.session!.version + 1,
			message
		}
	};
}
export function restartCalibration(state: CalibrationState): CalibrationState {
	const next = interruptCalibration(
		state,
		'Backend restarted. The unfinished session was not resumed; unsaved adjustments were discarded.'
	);
	return {
		...next,
		appliedOffset: next.savedOffset,
		session:
			next.session?.stage === 'applied'
				? {
						...next.session,
						stage: 'interrupted',
						message:
							'Backend restarted. The temporary offset was cleared; the saved simulator default was restored.'
					}
				: next.session
	};
}
export function applyCalibration(
	state: PrinterSnapshot,
	command: CalibrationCommand,
	actor?: CalibrationActor,
	now = Date.now()
): PrinterSnapshot {
	if (state.mode !== 'simulator')
		throw new CommandRejected({
			message: 'Live calibration requires coordinated printer testing.'
		});
	if (actor?.role && !['owner', 'operator'].includes(actor.role))
		throw new CommandRejected({ message: 'An operator account is required.' });
	if (!actor?.id)
		throw new CommandRejected({ message: 'An authenticated operator must own this calibration.' });
	if (state.connection !== 'connected' || state.klippy !== 'ready' || state.storage !== 'healthy')
		throw new CommandRejected({
			message: 'Reconnect to a ready printer with healthy storage before continuing.'
		});
	const next = structuredClone(state);
	if (command.type === 'calibrationBegin') {
		const reason = calibrationReason(state, false);
		if (reason) throw new CommandRejected({ message: reason });
		if (!command.confirmed)
			throw new CommandRejected({ message: 'Review the preparation checklist first.' });
		if (
			!Number.isFinite(command.expectedOffset) ||
			Math.abs(command.expectedOffset - state.calibration.appliedOffset) > 0.0001
		)
			throw new CommandRejected({
				message: 'The applied offset changed. Review the current value.'
			});
		next.calibration.session = {
			id: command.sessionId,
			version: 0,
			ownerId: actor.id,
			ownerName: actor.name.slice(0, 80),
			stage: 'adjusting',
			baseline: state.calibration.appliedOffset,
			candidate: state.calibration.appliedOffset,
			startedAt: now,
			expiresAt: now + CALIBRATION_IDLE_MS,
			message: null
		};
		next.motion.calibration = true;
		return next;
	}
	const current = state.calibration.session;
	if (
		!current ||
		!calibrationActive(state.calibration) ||
		current.id !== command.sessionId ||
		current.version !== command.version
	)
		throw new CommandRejected({
			message: 'Calibration changed. Review the current step before trying again.'
		});
	if (current.expiresAt <= now)
		throw new CommandRejected({ message: 'This session expired. Start a new calibration.' });
	const force = command.type === 'calibrationCancel' && command.force && actor.role === 'owner';
	if (current.ownerId !== actor.id && !force)
		throw new CommandRejected({ message: 'Another operator owns this calibration session.' });
	const session = next.calibration.session!;
	session.version++;
	session.expiresAt = now + CALIBRATION_IDLE_MS;
	if (
		command.type !== 'calibrationCancel' &&
		(state.motion.busy !== false ||
			['printing', 'paused', 'unknown', 'error'].includes(state.job.state) ||
			!['x', 'y', 'z'].every((axis) => state.motion.homed.includes(axis as 'x' | 'y' | 'z')))
	)
		throw new CommandRejected({
			message: 'Printer readiness changed. Review the session before continuing.'
		});
	if (command.type === 'calibrationAdjust') {
		if (!calibrationSteps.some((step) => Math.abs(command.delta) === step))
			throw new CommandRejected({ message: 'Choose a supported fine adjustment.' });
		if (current.stage !== 'adjusting')
			throw new CommandRejected({ message: 'Return to adjustment before changing the offset.' });
		const candidate = Math.round((current.candidate + command.delta) * 1000) / 1000;
		if (!Number.isFinite(candidate) || Math.abs(candidate) > 2)
			throw new CommandRejected({
				message: 'Simulator adjustment must stay between −2 and +2 mm.'
			});
		session.candidate = candidate;
	} else if (command.type === 'calibrationStage') {
		const allowed =
			(current.stage === 'adjusting' && command.stage === 'first-layer') ||
			(current.stage === 'first-layer' && ['adjusting', 'review'].includes(command.stage)) ||
			(current.stage === 'review' && command.stage === 'adjusting');
		if (command.stage === 'review' && !command.confirmed)
			throw new CommandRejected({ message: 'Confirm you have reviewed the first-layer examples.' });
		if (!allowed)
			throw new CommandRejected({ message: 'Complete the current step before continuing.' });
		session.stage = command.stage;
	} else if (command.type === 'calibrationFinish') {
		if (current.stage !== 'review')
			throw new CommandRejected({
				message: 'Review the first-layer illustration before finishing.'
			});
		next.calibration.appliedOffset = current.candidate;
		if (command.outcome === 'save') next.calibration.savedOffset = current.candidate;
		session.stage = command.outcome === 'save' ? 'saved' : 'applied';
		session.message =
			command.outcome === 'save'
				? 'Saved as the simulator default. No printer configuration was written.'
				: 'Applied temporarily in this simulator process. Restarting restores the saved default.';
		next.motion.calibration = false;
	} else {
		if (!command.confirmed)
			throw new CommandRejected({ message: 'Confirm cancellation before discarding adjustments.' });
		next.calibration.appliedOffset = current.baseline;
		session.stage = 'cancelled';
		session.message = force
			? 'Ended by the account owner. Unsaved adjustments were discarded.'
			: 'Cancelled. Unsaved adjustments were discarded; the previous applied offset was retained.';
		next.motion.calibration = false;
	}
	return next;
}
