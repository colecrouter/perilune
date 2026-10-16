import { expect, test } from 'vite-plus/test';
import { parseActionForm } from './action-form.js';
const data = (values: Record<string, string | undefined>) => {
	const d = new FormData();
	for (const [key, value] of Object.entries({ id: crypto.randomUUID(), ...values }))
		if (value !== undefined) d.append(key, value);
	return d;
};
test('decodes explicit heater and job forms without inferring current job identity', () => {
	expect(
		parseActionForm(data({ intent: 'temperature', heater: 'bed', target: '60' })).command
	).toEqual({ type: 'temperature', heater: 'bed', target: 60 });
	expect(
		parseActionForm(data({ intent: 'pause', filename: 'example.gcode', runId: 'run' })).command
	).toEqual({ type: 'pause', expectedJob: { filename: 'example.gcode', runId: 'run' } });
});
test('rejects blank targets, duplicate fields, unsupported intents and unconfirmed cancellation', () => {
	for (const values of [
		{ intent: 'temperature', heater: 'bed', target: '' },
		{ intent: 'temperature', heater: 'bed', target: 'NaN' },
		{ intent: 'move' },
		{
			intent: 'cancel',
			filename: 'file',
			runId: '',
			coolBed: 'true',
			coolNozzle: 'true',
			confirmed: 'false'
		},
		{
			intent: 'cancel',
			filename: 'file',
			runId: '',
			coolBed: 'oops',
			coolNozzle: 'true',
			confirmed: 'true'
		}
	])
		expect(() => parseActionForm(data(values))).toThrow();
	const repeated = data({ intent: 'home', axes: 'all' });
	repeated.append('axes', 'z');
	expect(() => parseActionForm(repeated)).toThrow();
});
