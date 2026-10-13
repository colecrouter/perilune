import { describe, expect, it } from 'vite-plus/test';
import { Schema } from 'effect';
import { applyCommand, initialSnapshot, PrinterCommand } from './printer.js';

describe('printer command policy', () => {
	it.each([
		[true, false, 0, 210],
		[false, true, 60, 0],
		[true, true, 0, 0],
		[false, false, 60, 210]
	])('independently cools bed=%s and nozzle=%s', (coolBed, coolNozzle, bed, nozzle) => {
		const original = initialSnapshot();
		const next = applyCommand(original, { type: 'cancel', coolBed, coolNozzle });
		expect(next.job.state).toBe('cancelled');
		expect(next.heaters.bed.target).toBe(bed);
		expect(next.heaters.nozzle.target).toBe(nozzle);
		expect(original.job.state).toBe('printing');
	});
	it('rejects stale controls from a second client', () => {
		const paused = applyCommand(initialSnapshot(), { type: 'pause' });
		expect(() => applyCommand(paused, { type: 'pause' })).toThrow('no longer running');
		expect(applyCommand(paused, { type: 'resume' }).job.state).toBe('printing');
	});
	it('enforces different bed and nozzle limits', () => {
		expect(() =>
			applyCommand(initialSnapshot(), { type: 'temperature', heater: 'bed', target: 121 })
		).toThrow('120');
		expect(
			applyCommand(initialSnapshot(), { type: 'temperature', heater: 'nozzle', target: 250 })
				.heaters.nozzle.target
		).toBe(250);
	});
	it.each([-1, 301, 20.5, NaN, Infinity])('rejects malformed targets: %s', (target) => {
		expect(() =>
			Schema.decodeUnknownSync(PrinterCommand)({ type: 'temperature', heater: 'nozzle', target })
		).toThrow();
	});
});
