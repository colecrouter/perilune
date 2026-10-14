import { expect, it } from 'vite-plus/test';
import { initialSnapshot, applyCommand } from './printer.js';
import {
	applyCalibration,
	calibrationActive,
	interruptCalibration,
	restartCalibration,
	CALIBRATION_IDLE_MS
} from './calibration.js';
const owner = { id: 'operator-a', name: 'Operator A', role: 'operator' };
const other = { id: 'operator-b', name: 'Operator B', role: 'operator' };
const id = 'e79c4f1b-dc5d-4771-bc4e-274ddc16438b';
function idle() {
	const state = initialSnapshot();
	state.job.state = 'cancelled';
	state.heaters.nozzle.target = 0;
	state.heaters.bed.target = 0;
	return state;
}
function begin() {
	return applyCalibration(
		idle(),
		{ type: 'calibrationBegin', sessionId: id, expectedOffset: 0, confirmed: true },
		owner,
		1000
	);
}
it('owns a calibration only after ready, idle, homed, reviewed preparation', () => {
	for (const change of [
		(state: ReturnType<typeof idle>) => (state.job.state = 'printing'),
		(state: ReturnType<typeof idle>) => (state.motion.homed = []),
		(state: ReturnType<typeof idle>) => (state.heaters.bed.target = 60),
		(state: ReturnType<typeof idle>) => (state.storage = 'degraded'),
		(state: ReturnType<typeof idle>) => (state.mode = 'moonraker')
	]) {
		const state = idle();
		change(state);
		expect(() =>
			applyCalibration(
				state,
				{ type: 'calibrationBegin', sessionId: id, expectedOffset: 0, confirmed: true },
				owner
			)
		).toThrow();
	}
	expect(calibrationActive(begin().calibration)).toBe(true);
	expect(begin().motion.calibration).toBe(true);
	expect(() =>
		applyCalibration(
			idle(),
			{ type: 'calibrationBegin', sessionId: id, expectedOffset: 0, confirmed: false },
			owner
		)
	).toThrow('checklist');
	expect(() =>
		applyCalibration(
			idle(),
			{ type: 'calibrationBegin', sessionId: id, expectedOffset: 0, confirmed: true },
			{ ...owner, role: 'viewer' }
		)
	).toThrow('operator');
});
it('rejects stale revisions, different owners and expired sessions', () => {
	const command = {
		type: 'calibrationAdjust' as const,
		sessionId: id,
		version: 0,
		delta: -0.01 as const
	};
	const next = applyCalibration(begin(), command, owner, 1001);
	expect(next.calibration.session?.candidate).toBe(-0.01);
	expect(next.calibration.appliedOffset).toBe(0);
	expect(() => applyCalibration(next, command, owner, 1002)).toThrow('changed');
	expect(() => applyCalibration(begin(), command, other, 1001)).toThrow('Another operator');
	expect(() => applyCalibration(begin(), command, owner, 1000 + CALIBRATION_IDLE_MS)).toThrow(
		'expired'
	);
});
it('rejects out-of-range candidates and readiness changes at execution', () => {
	const state = begin();
	state.calibration.session!.candidate = -2;
	expect(() =>
		applyCalibration(
			state,
			{ type: 'calibrationAdjust', sessionId: id, version: 0, delta: -0.005 },
			owner,
			1001
		)
	).toThrow('−2');
	state.motion.busy = true;
	expect(() =>
		applyCalibration(
			state,
			{ type: 'calibrationAdjust', sessionId: id, version: 0, delta: 0.005 },
			owner,
			1001
		)
	).toThrow('readiness');
});
it('reserves motion, printing and heating while preserving cooldown', () => {
	const state = begin();
	for (const command of [
		{ type: 'home' as const, axes: 'all' as const },
		{ type: 'temperature' as const, heater: 'bed' as const, target: 60 },
		{ type: 'releaseMotors' as const, axes: 'all' as const, confirmed: true }
	])
		expect(() => applyCommand(state, command)).toThrow('Calibration owns');
	expect(applyCommand(state, { type: 'cooldown' }).motion.calibration).toBe(true);
});
it('requires the first-layer review and distinguishes apply from save', () => {
	let state = begin();
	expect(() =>
		applyCalibration(
			state,
			{ type: 'calibrationFinish', sessionId: id, version: 0, outcome: 'save' },
			owner,
			1001
		)
	).toThrow('Review');
	state = applyCalibration(
		state,
		{ type: 'calibrationAdjust', sessionId: id, version: 0, delta: -0.05 },
		owner,
		1001
	);
	state = applyCalibration(
		state,
		{ type: 'calibrationStage', sessionId: id, version: 1, stage: 'first-layer' },
		owner,
		1002
	);
	expect(() =>
		applyCalibration(
			state,
			{ type: 'calibrationStage', sessionId: id, version: 2, stage: 'review' },
			owner,
			1003
		)
	).toThrow('Confirm');
	state = applyCalibration(
		state,
		{ type: 'calibrationStage', sessionId: id, version: 2, stage: 'review', confirmed: true },
		owner,
		1003
	);
	const applied = applyCalibration(
		state,
		{ type: 'calibrationFinish', sessionId: id, version: 3, outcome: 'apply' },
		owner,
		1004
	);
	expect(applied.calibration).toMatchObject({
		appliedOffset: -0.05,
		savedOffset: 0,
		session: { stage: 'applied' }
	});
	expect(restartCalibration(applied.calibration)).toMatchObject({
		appliedOffset: 0,
		session: { stage: 'interrupted' }
	});
	const saved = applyCalibration(
		state,
		{ type: 'calibrationFinish', sessionId: id, version: 3, outcome: 'save' },
		owner,
		1004
	);
	expect(restartCalibration(saved.calibration)).toMatchObject({
		appliedOffset: -0.05,
		savedOffset: -0.05
	});
});
it('cancellation restores the prior temporary offset; only an owner can force it', () => {
	const base = idle();
	base.calibration.appliedOffset = 0.2;
	let state = applyCalibration(
		base,
		{ type: 'calibrationBegin', sessionId: id, expectedOffset: 0.2, confirmed: true },
		owner,
		1000
	);
	state = applyCalibration(
		state,
		{ type: 'calibrationAdjust', sessionId: id, version: 0, delta: -0.05 },
		owner,
		1001
	);
	const command = {
		type: 'calibrationCancel' as const,
		sessionId: id,
		version: 1,
		confirmed: true,
		force: true
	};
	expect(() => applyCalibration(state, command, other, 1002)).toThrow('Another operator');
	const ended = applyCalibration(state, command, { ...other, role: 'owner' }, 1002);
	expect(ended.calibration).toMatchObject({
		appliedOffset: 0.2,
		savedOffset: 0,
		session: { stage: 'cancelled' }
	});
	expect(ended.motion.calibration).toBe(false);
});
it('interruptions release the candidate without claiming it was applied', () => {
	const state = applyCalibration(
		begin(),
		{ type: 'calibrationAdjust', sessionId: id, version: 0, delta: 0.1 },
		owner,
		1001
	);
	expect(interruptCalibration(state.calibration, 'Disconnected')).toMatchObject({
		appliedOffset: 0,
		session: { stage: 'interrupted', message: 'Disconnected' }
	});
	expect(restartCalibration(state.calibration)).toMatchObject({
		appliedOffset: 0,
		session: { stage: 'interrupted' }
	});
});
