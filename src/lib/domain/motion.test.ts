import { describe, it, expect } from 'vite-plus/test';
import { Schema } from 'effect';
import { initialSnapshot, initialLiveSnapshot, applyCommand, PrinterCommand } from './printer.js';
import { motionReason, jogDestination } from './motion.js';
const idle = () => {
	const state = initialSnapshot();
	state.job.state = 'cancelled';
	return state;
};
describe('manual movement policy', () => {
	it('moves one axis to its boundary while preserving the others', () => {
		const state = idle();
		state.motion.limits.x = { min: -10, max: 220 };
		const command = {
			type: 'move',
			target: { x: -10 },
			expectedPosition: { x: 110, y: 110, z: 20 }
		} as const;
		expect(applyCommand(state, command).motion.position).toEqual({ x: -10, y: 110, z: 20 });
		expect(state.motion.position.x).toBe(110);
	});
	it.each([-11, 221, NaN, Infinity])(
		'rejects an entered out-of-range destination %s without clamping',
		(x) => {
			const state = idle();
			expect(() =>
				applyCommand(state, {
					type: 'move',
					target: { x },
					expectedPosition: { x: 110, y: 110, z: 20 }
				})
			).toThrow();
			expect(state.motion.position.x).toBe(110);
		}
	);
	it('shortens jogs at the boundary', () => {
		const state = idle();
		state.motion.position.x = 2;
		expect(jogDestination(state.motion, 'x', -10)).toBe(0);
		expect(jogDestination(state.motion, 'x', Infinity)).toBeNull();
	});
	it('rejects a stale preview including a change to a preserved axis', () => {
		const state = idle();
		state.motion.position.y = 120;
		expect(() =>
			applyCommand(state, {
				type: 'move',
				target: { x: 0 },
				expectedPosition: { x: 110, y: 110, z: 20 }
			})
		).toThrow('position changed');
	});
	it.each(['printing', 'paused', 'unknown', 'error'] as const)(
		'disables movement during %s',
		(job) => {
			const state = idle();
			state.job.state = job;
			expect(motionReason(state, ['x'])).not.toBeNull();
			expect(() => applyCommand(state, { type: 'home', axes: 'xy' })).toThrow();
		}
	);
	it('explains disconnect, calibration, homing and unknown readiness', () => {
		const state = idle();
		state.connection = 'disconnected';
		expect(motionReason(state, ['x'])).toContain('Reconnect');
		state.connection = 'connected';
		state.motion.calibration = true;
		expect(motionReason(state, ['x'])).toContain('Calibration');
		state.motion.calibration = false;
		state.motion.homed = [];
		expect(motionReason(state, ['x'])).toContain('Home X');
		expect(motionReason(state, ['x', 'y'], true)).toBeNull();
		expect(motionReason(state, ['z'], true)).toContain('Home X and Y');
		state.motion.busy = null;
		expect(motionReason(state, ['x'])).toContain('unknown');
	});
	it('requires an explicit clearance acknowledgement for near-bed lowering', () => {
		const state = idle();
		const command = {
			type: 'move',
			target: { z: 0 },
			expectedPosition: { x: 110, y: 110, z: 20 }
		} as const;
		expect(() => applyCommand(state, command)).toThrow('Confirm bed clearance');
		expect(applyCommand(state, { ...command, confirmedLowering: true }).motion.position.z).toBe(0);
	});
	it('never permits movement on the live printer or fabricates its geometry', () => {
		const state = initialLiveSnapshot();
		expect(state.motion.limits.x).toBeNull();
		expect(motionReason(state, ['x'])).toContain('read-only');
	});
	it('rejects malformed motion requests before reaching the service', () => {
		for (const target of [NaN, Infinity])
			expect(() =>
				Schema.decodeUnknownSync(PrinterCommand)({
					type: 'move',
					target: { x: target },
					expectedPosition: { x: 0, y: 0, z: 0 }
				})
			).toThrow();
	});
});
