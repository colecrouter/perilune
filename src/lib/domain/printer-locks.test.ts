import { expect, it } from 'vite-plus/test';
import { initialSnapshot } from './printer.js';
import { printerLockNotices } from './printer-locks.js';
import { consoleGuidance, consoleReason } from './console.js';
const mesh = (stage: 'probing' | 'review' | 'uncertain' | 'saved') => {
	const state = initialSnapshot();
	state.meshProbe.session = {
		id: 'mesh',
		ownerId: 'owner',
		ownerName: 'Owner',
		stage,
		result: null,
		completedSamples: 0,
		startedAt: 0,
		expiresAt: 1,
		message: null
	};
	state.motion.calibration = stage !== 'saved';
	return state;
};
it('distinguishes healthy ownership from uncertain recovery and clears on resolution', () => {
	expect(printerLockNotices(mesh('probing'))[0]).toMatchObject({
		kind: 'progress',
		href: '/calibration/mesh'
	});
	expect(printerLockNotices(mesh('review'))[0].title).toBe('Bed-mesh review is waiting');
	expect(printerLockNotices(mesh('uncertain'))[0]).toMatchObject({
		kind: 'attention',
		title: 'Bed-mesh recovery needs attention'
	});
	expect(printerLockNotices(mesh('saved'))).toEqual([]);
});
it('connects actual console admission reasons to the responsible workflow', () => {
	const state = mesh('uncertain');
	expect(consoleGuidance(state)?.href).toBe('/calibration/mesh');
	expect(consoleReason(state)).toContain('bed-mesh');
	state.connection = 'reconnecting';
	expect(consoleGuidance(state)).toBeUndefined();
	state.connection = 'connected';
	state.mode = 'moonraker';
	state.liveConsole = true;
	state.liveRecovery = { id: 'action', message: 'Check action' };
	expect(consoleGuidance(state)).toBeUndefined();
});
it('does not expose session messages or mistake completed calibration for a lock', () => {
	const state = mesh('uncertain');
	state.meshProbe.session!.message = 'private diagnostic';
	expect(JSON.stringify(printerLockNotices(state))).not.toContain('private diagnostic');
	state.meshProbe.session = null;
	state.motion.calibration = false;
	state.pid = {
		enabled: true,
		run: {
			id: 'pid',
			ownerId: 'owner',
			heater: 'nozzle',
			target: 150,
			startedAt: 0,
			stage: 'staged',
			parameters: null,
			message: null
		}
	};
	expect(printerLockNotices(state)).toEqual([]);
	state.pid.run!.stage = 'running';
	expect(printerLockNotices(state)[0].href).toBe('/calibration/pid');
});
it('prioritizes attention over progress and keeps a safe destination for unknown calibration ownership', () => {
	const state = initialSnapshot();
	state.motion.calibration = true;
	expect(printerLockNotices(state)[0]).toMatchObject({ kind: 'attention', href: '/calibration' });
	state.configurationBusy = true;
	state.storage = 'degraded';
	const notices = printerLockNotices(state);
	expect(notices.at(-1)?.kind).toBe('progress');
	expect(notices.find((n) => n.id === 'configuration')?.ownerRequired).toBe(true);
});
