import { describe, expect, it } from 'vite-plus/test';
import { appendTemperatureSample, heaterState, temperatureSensors } from './temperature.js';
import { initialSnapshot, initialLiveSnapshot, applyCommand } from './printer.js';
describe('temperature sampling', () => {
	it('retains a bounded hour and preserves zero targets', () => {
		const state = initialSnapshot();
		state.heaters.bed.target = 0;
		let history = appendTemperatureSample([], state, 1);
		for (let i = 1; i <= 800; i++) history = appendTemperatureSample(history, state, i * 5000);
		expect(history).toHaveLength(721);
		expect(history[0].at).toBe(400000);
		expect(history.at(-1)?.readings.heater_bed.target).toBe(0);
	});
	it('keeps old readings but records gaps instead of stale values during disconnects', () => {
		const state = initialSnapshot();
		const first = appendTemperatureSample([], state, 1000);
		state.connection = 'disconnected';
		const next = appendTemperatureSample(first, state, 6000);
		expect(next[0].readings.extruder.current).toBe(210);
		expect(next[1].readings.extruder).toEqual({ current: null, target: null });
		expect(appendTemperatureSample(next, state, 5000)).toBe(next);
	});
	it('discovers only present primary objects and keeps additional sensors', () => {
		const state = initialLiveSnapshot();
		state.availableObjects = ['heater_bed'];
		state.additionalTemperatures = [
			{ id: 'temperature_sensor host', label: 'Host', current: 40, target: null, heater: false }
		];
		expect(temperatureSensors(state).map((s) => s.label)).toEqual(['Bed', 'Host']);
	});
});
describe('heater status and controls', () => {
	it.each([
		[20, 0, 'Off'],
		[80, 0, 'Cooling'],
		[100, 210, 'Heating'],
		[211, 210, 'Holding'],
		[220, 210, 'Cooling'],
		[null, 210, 'Unknown']
	] as const)('labels %s / %s as %s', (current, target, label) =>
		expect(heaterState(current, target)).toBe(label)
	);
	it('marks stale heater status unknown', () =>
		expect(heaterState(210, 210, false)).toBe('Unknown'));
	it('cooldown applies both heaters as one action and rechecks readiness', () => {
		const state = initialSnapshot();
		expect(applyCommand(state, { type: 'cooldown' }).heaters).toEqual({
			nozzle: { current: 210, target: 0 },
			bed: { current: 60, target: 0 }
		});
		state.klippy = 'shutdown';
		expect(() => applyCommand(state, { type: 'cooldown' })).toThrow('ready');
	});
	it.each([NaN, Infinity, 75.5, 121])('rejects invalid bed target %s', (target) =>
		expect(() =>
			applyCommand(initialSnapshot(), { type: 'temperature', heater: 'bed', target })
		).toThrow()
	);
});
