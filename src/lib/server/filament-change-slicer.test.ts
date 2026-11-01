import { expect, it } from 'vite-plus/test';
import { filamentChangePlan } from './filament-change-plan.js';
import { filamentChangeCapability } from './filament-change-capability.js';
import { emptyMoonrakerSnapshot } from './moonraker.js';
import {
	defaultFilamentChangeSettings,
	type FilamentChangeSession
} from '#lib/domain/filament-change.js';
function fixture() {
	const fresh = emptyMoonrakerSnapshot();
	fresh.connection = 'connected';
	fresh.telemetryReady = true;
	fresh.klippy = 'ready';
	fresh.generation = 1;
	fresh.paused = true;
	fresh.job = { ...fresh.job, filename: 'synthetic.gcode', runId: 'run', state: 'paused' };
	fresh.availableObjects = ['virtual_sdcard', 'pause_resume', 'extruder', 'gcode_move'];
	fresh.filamentChange = filamentChangeCapability(fresh.availableObjects, {
		printer: { kinematics: 'cartesian', max_velocity: 300 },
		extruder: { nozzle_diameter: 0.4, filament_diameter: 1.75 }
	})!;
	fresh.gcodePosition = { x: 100, y: 100, z: 5, e: 20 };
	fresh.motion = {
		...fresh.motion,
		busy: false,
		calibration: false,
		homed: ['x', 'y', 'z'],
		position: { x: 100, y: 100, z: 5 }
	};
	fresh.filament = {
		active: 'extruder',
		canExtrude: true,
		position: 20,
		maxDistance: 50,
		minTemp: 170
	};
	fresh.heaters.nozzle = { current: 210, target: 210 };
	const settings = {
		...defaultFilamentChangeSettings,
		mode: 'slicer' as const,
		reviewed: true,
		fingerprint: fresh.filamentChange.fingerprint
	};
	const session: FilamentChangeSession = {
		id: crypto.randomUUID(),
		ownerId: 'owner',
		filename: 'synthetic.gcode',
		runId: 'run',
		generation: 1,
		settingsRevision: 0,
		fingerprint: settings.fingerprint,
		step: 1,
		stage: 'paused',
		startedAt: Date.now(),
		expiresAt: Date.now() + 60000,
		message: 'Paused',
		slicerManaged: true,
		assisted: { parked: false }
	};
	const common = {
		sessionId: session.id,
		expectedStep: 1,
		expectedJob: { filename: session.filename, runId: 'run' },
		confirmed: true
	};
	const actor = { id: 'owner', name: 'Fixture owner', role: 'owner' as const };
	return { fresh, settings, session, common, actor };
}
it('manual controls only verify existing parking and use bounded extrusion with saved parser state', () => {
	const f = fixture();
	const park = filamentChangePlan(
		{ type: 'filamentChangePark', ...f.common },
		crypto.randomUUID(),
		f.session,
		f.settings,
		f.fresh,
		f.actor
	);
	expect(park.operations).toEqual([]);
	f.session = {
		...park.session,
		stage: 'paused',
		assisted: {
			parked: true,
			position: { x: 100, y: 100, z: 5 },
			physicalPosition: { x: 100, y: 100, z: 5 }
		}
	};
	const command = {
		type: 'filamentChangeFeed' as const,
		...f.common,
		expectedStep: f.session.step,
		operation: 'load' as const,
		distance: 10 as const
	};
	const feed = filamentChangePlan(
		command,
		crypto.randomUUID(),
		f.session,
		f.settings,
		f.fresh,
		f.actor
	);
	expect(feed.operations).toHaveLength(1);
	expect(feed.operations[0]).toMatchObject({
		type: 'controlScript',
		script: expect.stringMatching(
			/SAVE_GCODE_STATE.*\nM83\nM220 S100\nM221 S100\nG1 E10.000 F60.000\nM400\nRESTORE_GCODE_STATE/
		)
	});
	expect(feed.session.pendingMove).toMatchObject({ distance: 10, startE: 20 });
	expect(() =>
		filamentChangePlan(
			{ ...command, operation: 'unload' },
			crypto.randomUUID(),
			f.session,
			f.settings,
			f.fresh,
			f.actor
		)
	).toThrow('direction');
	f.fresh.filament!.maxDistance = 5;
	expect(() =>
		filamentChangePlan(command, crypto.randomUUID(), f.session, f.settings, f.fresh, f.actor)
	).toThrow('limit');
});
it('manual moves require clear parked coordinates, a hot nozzle and an explicit distance', () => {
	const f = fixture();
	const feed = {
		type: 'filamentChangeFeed' as const,
		...f.common,
		operation: 'load' as const,
		distance: 10 as const
	};
	expect(() =>
		filamentChangePlan(feed, crypto.randomUUID(), f.session, f.settings, f.fresh, f.actor)
	).toThrow('parking position');
	f.session.assisted = {
		parked: true,
		position: { x: 100, y: 100, z: 5 },
		physicalPosition: { x: 100, y: 100, z: 5 }
	};
	f.fresh.heaters.nozzle.target = 0;
	expect(() =>
		filamentChangePlan(feed, crypto.randomUUID(), f.session, f.settings, f.fresh, f.actor)
	).toThrow('cold');
	f.fresh.heaters.nozzle.target = 210;
	expect(() =>
		filamentChangePlan(
			{ ...feed, distance: undefined },
			crypto.randomUUID(),
			f.session,
			f.settings,
			f.fresh,
			f.actor
		)
	).toThrow('distance');
	f.fresh.gcodePosition!.x = 101;
	expect(() =>
		filamentChangePlan(feed, crypto.randomUUID(), f.session, f.settings, f.fresh, f.actor)
	).toThrow('position changed');
});
