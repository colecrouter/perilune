import { expect, it } from 'vite-plus/test';
import {
	advanceExtrusion,
	calculateExtrusion,
	extrusionActive,
	extrusionReason,
	interruptExtrusion
} from './extrusion.js';
import { applyCommand, initialSnapshot } from './printer.js';
const actor = { id: 'operator', name: 'Operator', role: 'operator' };
const ready = () => {
	const state = initialSnapshot();
	state.job.state = 'cancelled';
	state.motion.homed = [];
	return state;
};
const begin = () =>
	applyCommand(
		ready(),
		{
			type: 'extrusionBegin',
			runId: crypto.randomUUID(),
			rotationDistance: 7.5,
			before: 70,
			confirmed: true
		},
		undefined,
		actor
	);
it('calculates from measured travel with the correct correction direction', () => {
	expect(calculateExtrusion(7.5, 70, 22)).toEqual({
		rotationDistance: 7.5,
		before: 70,
		after: 22,
		actual: 48,
		proposed: 7.2,
		repeat: false
	});
	expect(calculateExtrusion(7.5, 70, 17)).toMatchObject({
		actual: 53,
		proposed: 7.95,
		repeat: true
	});
	for (const values of [
		[0, 70, 20],
		[0.0001, 70, 20],
		[NaN, 70, 20],
		[7.5, 70, 70],
		[7.5, 70, -1],
		[7.5, 70, 46],
		[7.5, 49, 0],
		[Infinity, 70, 20]
	])
		expect(() => calculateExtrusion(...(values as [number, number, number]))).toThrow();
});
it('allows unhomed E-only feeding but rejects unsafe readiness and competing calibration', () => {
	expect(extrusionReason(ready())).toBeNull();
	for (const modify of [
		(s: ReturnType<typeof ready>) => {
			s.heaters.nozzle.current = 30;
		},
		(s: ReturnType<typeof ready>) => {
			s.heaters.nozzle.target = 0;
		},
		(s: ReturnType<typeof ready>) => {
			s.job.state = 'paused';
		},
		(s: ReturnType<typeof ready>) => {
			s.motion.busy = null;
		},
		(s: ReturnType<typeof ready>) => {
			s.telemetryReady = false;
		},
		(s: ReturnType<typeof ready>) => {
			s.motion.calibration = true;
		}
	]) {
		const s = ready();
		modify(s);
		expect(extrusionReason(s)).not.toBeNull();
	}
	expect(() =>
		applyCommand(
			ready(),
			{ type: 'extrusionFeed', runId: crypto.randomUUID(), distance: 5, confirmed: false },
			undefined,
			actor
		)
	).toThrow('Confirm');
});
it('runs for the requested distance, retains an actor-owned measurement lease, and exports without applying', () => {
	let state = begin();
	const runId = state.extrusion.session!.id;
	for (let i = 0; i < 49; i++) state = { ...state, extrusion: advanceExtrusion(state.extrusion) };
	expect(state.extrusion.session?.stage).toBe('extruding');
	state = { ...state, extrusion: advanceExtrusion(state.extrusion) };
	expect(state.extrusion.session?.stage).toBe('measure');
	expect(extrusionActive(state.extrusion)).toBe(true);
	expect(() =>
		applyCommand(state, { type: 'extrusionMeasure', runId, after: 20 }, undefined, {
			...actor,
			id: 'other'
		})
	).toThrow('owns');
	expect(() => applyCommand(state, { type: 'home', axes: 'all' })).toThrow('owns');
	state = applyCommand(state, { type: 'extrusionMeasure', runId, after: 22 }, undefined, actor);
	expect(state.extrusion.session?.proposal?.proposed).toBe(7.2);
	state = applyCommand(
		state,
		{ type: 'extrusionFinish', runId, coolNozzle: true },
		undefined,
		actor
	);
	expect(state.motion.calibration).toBe(false);
	expect(state.heaters.nozzle.target).toBe(0);
	expect(state.extrusion.session?.rotationDistance).toBe(7.5);
});
it('interrupts without replay and lets an owner cancel another operator’s run', () => {
	const state = begin(),
		runId = state.extrusion.session!.id;
	expect(interruptExtrusion(state.extrusion, 'Restarted').session?.stage).toBe('interrupted');
	expect(advanceExtrusion(state.extrusion, Date.now() + 700_000).session?.stage).toBe(
		'interrupted'
	);
	expect(() =>
		applyCommand(
			state,
			{ type: 'extrusionCancel', runId, coolNozzle: false, force: true },
			undefined,
			{ ...actor, id: 'other' }
		)
	).toThrow('owns');
	const ended = applyCommand(
		state,
		{ type: 'extrusionCancel', runId, coolNozzle: false, force: true },
		undefined,
		{ id: 'owner', name: 'Owner', role: 'owner' }
	);
	expect(ended.heaters.nozzle.target).toBe(210);
	expect(ended.extrusion.session?.stage).toBe('cancelled');
});
