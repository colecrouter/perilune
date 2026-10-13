import { CommandRejected } from './errors.js';
import type { PrinterSnapshot } from './printer.js';

export const axes = ['x', 'y', 'z'] as const;
export type Axis = (typeof axes)[number];
export type Position = Record<Axis, number>;
export interface MotionSnapshot {
	position: Record<Axis, number | null>;
	limits: Record<Axis, { min: number; max: number } | null>;
	homed: Axis[];
	busy: boolean | null;
	calibration: boolean;
}
export const emptyMotion = (): MotionSnapshot => ({
	position: { x: null, y: null, z: null },
	limits: { x: null, y: null, z: null },
	homed: [],
	busy: null,
	calibration: false
});
export const simulatedMotion = (): MotionSnapshot => ({
	position: { x: 110, y: 110, z: 20 },
	limits: { x: { min: 0, max: 220 }, y: { min: 0, max: 220 }, z: { min: 0, max: 250 } },
	homed: ['x', 'y', 'z'],
	busy: false,
	calibration: false
});
export function motionReason(
	state: PrinterSnapshot,
	required: readonly Axis[],
	homing = false,
	includePending = true
): string | null {
	if (state.mode === 'moonraker')
		return 'Live movement is read-only until coordinated printer testing.';
	if (state.connection !== 'connected') return 'Reconnect the printer before moving.';
	if (state.klippy !== 'ready') return `Printer is ${state.klippy}. Wait until it is ready.`;
	if (state.storage !== 'healthy') return 'Action storage is recovering. Please wait.';
	if (['printing', 'paused', 'unknown', 'error'].includes(state.job.state))
		return state.job.state === 'paused'
			? 'Stop the paused print before manual movement.'
			: 'Manual movement is unavailable while a print is active or its state is uncertain.';
	if (state.motion.calibration)
		return 'Calibration owns the movement controls. Finish or cancel that workflow first.';
	if (state.motion.busy !== false) return 'The printer is busy or movement readiness is unknown.';
	if (
		includePending &&
		state.actions.some((action) => action.status === 'queued' || action.status === 'sending')
	)
		return 'Another action is pending. Wait for it to finish.';
	for (const axis of required) {
		if (!state.motion.limits[axis]) return `${axis.toUpperCase()} travel limits are unavailable.`;
		if (!homing && !state.motion.homed.includes(axis))
			return `Home ${axis.toUpperCase()} before moving.`;
		if (!homing && state.motion.position[axis] === null)
			return `${axis.toUpperCase()} position is unknown.`;
	}
	if (!homing && axes.some((axis) => state.motion.position[axis] === null))
		return 'The full printer position is unknown. Wait for position telemetry.';
	if (
		homing &&
		required.includes('z') &&
		!['x', 'y'].every((axis) => state.motion.homed.includes(axis as Axis)) &&
		!(required.includes('x') && required.includes('y'))
	)
		return 'Home X and Y before homing Z.';
	return null;
}
export function checkedMove(
	state: PrinterSnapshot,
	target: Partial<Position>,
	expected: Position,
	confirmedLowering = false
): Position {
	const selected = axes.filter((axis) => target[axis] !== undefined);
	if (!selected.length) throw new CommandRejected({ message: 'Choose at least one axis to move.' });
	const reason = motionReason(state, selected, false, false);
	if (reason) throw new CommandRejected({ message: reason });
	for (const axis of axes) {
		const current = state.motion.position[axis];
		if (
			current === null ||
			!Number.isFinite(expected[axis]) ||
			Math.abs(current - expected[axis]) > 0.001
		)
			throw new CommandRejected({
				message: 'Printer position changed. Review the destination and try again.'
			});
	}
	if (target.z !== undefined && target.z < 5 && target.z < expected.z && !confirmedLowering)
		throw new CommandRejected({ message: 'Confirm bed clearance before lowering Z near the bed.' });
	const result = { ...expected };
	for (const axis of selected) {
		const value = target[axis]!;
		const limit = state.motion.limits[axis]!;
		if (!Number.isFinite(value) || value < limit.min || value > limit.max)
			throw new CommandRejected({
				message: `${axis.toUpperCase()} must be between ${limit.min} and ${limit.max} mm. The destination was not changed.`
			});
		result[axis] = value;
	}
	return result;
}
export function jogDestination(state: MotionSnapshot, axis: Axis, delta: number): number | null {
	const current = state.position[axis];
	const limit = state.limits[axis];
	if (current === null || !limit || !Number.isFinite(delta)) return null;
	return Math.round(Math.max(limit.min, Math.min(limit.max, current + delta)) * 1000) / 1000;
}
