import { expect, it } from 'vite-plus/test';
import { Schema } from 'effect';
import { initialSnapshot, applyCommand } from './printer.js';
import { PidCommand, pidParameters, pidReason } from './pid.js';
const ready = () => {
	const s = initialSnapshot();
	s.job.state = 'standby';
	s.heaters = { nozzle: { current: 25, target: 0 }, bed: { current: 25, target: 0 } };
	return s;
};
it('requires a bounded integer temperature and explicit confirmation', () => {
	const decode = Schema.decodeUnknownSync(PidCommand);
	for (const target of [29, 301, 200.5, NaN])
		expect(() =>
			decode({ type: 'pidCalibrate', heater: 'nozzle', target, confirmed: true })
		).toThrow();
	expect(() =>
		decode({ type: 'pidCalibrate', heater: 'nozzle', target: 200, confirmed: false })
	).toThrow();
});
it('checks idle targets, cooling margin, configured limits, readiness and ownership', () => {
	const s = ready();
	expect(pidReason(s, 'nozzle', 200)).toBeNull();
	expect(pidReason(s, 'bed', 121)).toMatch(/maximum/);
	expect(pidReason(s, 'nozzle', 200, false)).toMatch(/owner/);
	s.heaters.bed.target = 60;
	expect(pidReason(s, 'nozzle', 200)).toMatch(/both heater/);
	s.heaters.bed.target = 0;
	s.heaters.nozzle.current = 195;
	expect(pidReason(s, 'nozzle', 200)).toMatch(/cool/);
	s.heaters.nozzle.current = 25;
	s.telemetryReady = false;
	expect(pidReason(s, 'nozzle', 200)).toMatch(/telemetry/);
});
it('accepts only finite sane pending PID gains and produces an explicitly synthetic simulator result', () => {
	expect(pidParameters({ control: 'pid', pid_Kp: '20', pid_Ki: '1.2', pid_Kd: '80' })).toEqual({
		kp: 20,
		ki: 1.2,
		kd: 80
	});
	for (const value of [
		null,
		{},
		{ control: 'watermark' },
		{ control: 'pid', pid_kp: Infinity, pid_ki: 1, pid_kd: 1 },
		{ control: 'pid', pid_kp: 20, pid_ki: 0, pid_kd: 80 }
	])
		expect(pidParameters(value)).toBeNull();
	const s = applyCommand(
		ready(),
		{ type: 'pidCalibrate', heater: 'nozzle', target: 200, confirmed: true },
		undefined,
		{ id: 'owner', name: 'Owner', role: 'owner' },
		'test-run'
	);
	expect(s.pid?.run).toMatchObject({ id: 'test-run', stage: 'staged' });
	expect(s.pid?.run?.message).toMatch(/simulator|example/i);
	expect(s.heaters.nozzle.target).toBe(0);
});
