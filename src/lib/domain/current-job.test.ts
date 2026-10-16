import { expect, test } from 'vite-plus/test';
import { initialSnapshot } from './printer.js';
import { jobControlReason } from './current-job.js';

test('job controls respect readiness, role, recovery and safety while allowing paused idle jobs', () => {
	const snapshot = initialSnapshot();
	expect(jobControlReason(snapshot)).toBeNull();
	expect(jobControlReason(snapshot, false)).toMatch(/connection/);
	expect(jobControlReason(snapshot, true, false)).toMatch(/operator/);
	snapshot.telemetryReady = false;
	expect(jobControlReason(snapshot)).toMatch(/fresh printer status/);
	snapshot.telemetryReady = true;
	snapshot.klippy = 'error';
	expect(jobControlReason(snapshot)).toMatch(/Klipper/);
	snapshot.klippy = 'ready';
	snapshot.liveRecovery = { id: 'recovery', message: 'Review the uncertain action.' };
	expect(jobControlReason(snapshot)).toBe('Review the uncertain action.');
	snapshot.liveRecovery = null;
	snapshot.safety = { enabled: true, halted: true, actions: [] };
	expect(jobControlReason(snapshot)).toMatch(/interlock/);
});
