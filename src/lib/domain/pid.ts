import { Schema } from 'effect';
import type { PrinterSnapshot } from './printer.js';
import { safetyReason } from './safety.js';
export const PidCommand = Schema.Struct({
	type: Schema.Literal('pidCalibrate'),
	heater: Schema.Literals(['nozzle', 'bed']),
	target: Schema.Int.check(Schema.isBetween({ minimum: 30, maximum: 300 })),
	confirmed: Schema.Literal(true)
});
export type PidCommand = typeof PidCommand.Type;
export interface PidParameters {
	kp: number;
	ki: number;
	kd: number;
}
export interface PidTelemetry {
	available: boolean;
	limits: Partial<Record<'nozzle' | 'bed', { min: number; max: number }>>;
	pending: Partial<Record<'nozzle' | 'bed', PidParameters>>;
}
export interface PidRun {
	id: string;
	ownerId: string;
	heater: 'nozzle' | 'bed';
	target: number;
	startedAt: number;
	stage: 'running' | 'staged' | 'resolved' | 'interrupted' | 'failed';
	parameters: PidParameters | null;
	message: string | null;
}
export interface PidState {
	enabled: boolean;
	run: PidRun | null;
}
export const pidActive = (state?: PidState) => state?.run?.stage === 'running';
export function pidParameters(value: unknown): PidParameters | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const options = Object.fromEntries(
		Object.entries(value).map(([key, value]) => [key.toLowerCase(), value])
	);
	if (options.control !== 'pid') return null;
	const kp = Number(options.pid_kp),
		ki = Number(options.pid_ki),
		kd = Number(options.pid_kd);
	if (
		![kp, ki, kd].every((value) => Number.isFinite(value) && value < 1e6) ||
		kp <= 0 ||
		ki <= 0 ||
		kd < 0
	)
		return null;
	return { kp, ki, kd };
}
export const samePid = (a?: PidParameters | null, b?: PidParameters | null) =>
	!!a && !!b && a.kp === b.kp && a.ki === b.ki && a.kd === b.kd;
export function pidReason(
	state: PrinterSnapshot,
	heater: 'nozzle' | 'bed',
	target: number,
	owner = true,
	checkPending = true
): string | null {
	if (!owner) return 'An owner must prepare and run PID calibration.';
	const safety = safetyReason(state.safety);
	if (safety) return safety;
	if (!state.pid?.enabled)
		return 'PID calibration is disabled on this server until coordinated heater testing.';
	if (state.liveRecovery) return state.liveRecovery.message;
	if (state.configurationBusy) return 'Finish configuration recovery first.';
	if (state.storage !== 'healthy') return 'Action storage is recovering.';
	if (state.connection !== 'connected' || state.klippy !== 'ready' || !state.telemetryReady)
		return 'Wait for fresh, ready printer telemetry.';
	if (!['standby', 'complete', 'cancelled', 'error'].includes(state.job.state))
		return 'Stop or finish the current print before tuning a heater.';
	if (state.motion.busy !== false || state.motion.calibration || pidActive(state.pid))
		return 'Another movement or calibration owns the printer.';
	if (checkPending && state.actions.some((action) => ['queued', 'sending'].includes(action.status)))
		return 'Wait for the pending action to finish.';
	if (state.heaters.nozzle.target !== 0 || state.heaters.bed.target !== 0)
		return 'Turn off both heater targets before starting calibration.';
	if (state.mode === 'moonraker' && state.liveMesh?.pendingConfig)
		return 'Review and save or discard existing pending printer settings before another calibration.';
	const capability = state.pidTelemetry;
	if (!capability?.available) return 'The built-in PID_CALIBRATE command is unavailable.';
	const limits = capability.limits[heater];
	if (!limits || !Number.isFinite(limits.min) || !Number.isFinite(limits.max))
		return 'Configured heater limits are unavailable.';
	if (
		!Number.isInteger(target) ||
		target < 30 ||
		target <= limits.min ||
		target > Math.min(300, limits.max - 10)
	)
		return 'Choose a target of at least 30°C and at least 10°C below the configured maximum.';
	const current = state.heaters[heater].current;
	if (current === null || !Number.isFinite(current)) return 'Heater temperature is unavailable.';
	if (current >= target - 5)
		return 'Let this heater cool to at least 5°C below the calibration target first.';
	return null;
}
