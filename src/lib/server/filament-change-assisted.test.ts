import { expect, it } from 'vite-plus/test';
import { assistedFilamentPlan } from './filament-change-assisted.js';
import { filamentChangeCapability } from './filament-change-capability.js';
import { emptyMoonrakerSnapshot } from './moonraker.js';
import {
	defaultAssistedFilamentProfile,
	defaultFilamentChangeSettings,
	type FilamentChangeSession
} from '#lib/domain/filament-change.js';
const objects = ['extruder', 'gcode_move', 'pause_resume'];
const config = {
	printer: { kinematics: 'corexy', max_velocity: '300' },
	extruder: { nozzle_diameter: '0.4', filament_diameter: '1.75' }
};
function fixture() {
	const capability = filamentChangeCapability(objects, config)!;
	const settings = {
		...defaultFilamentChangeSettings,
		mode: 'assisted' as const,
		reviewed: true,
		fingerprint: capability.fingerprint,
		assisted: {
			...defaultAssistedFilamentProfile,
			parking: 'perilune' as const,
			parkX: 10,
			parkY: 20
		}
	};
	const fresh = {
		...emptyMoonrakerSnapshot(),
		filamentChange: capability,
		gcodePosition: { x: 100, y: 100, z: 20, e: 100 }
	};
	fresh.filament = {
		canExtrude: true,
		position: 100,
		active: 'extruder',
		maxDistance: 50,
		minTemp: 170
	};
	fresh.heaters.nozzle = { current: 200, target: 200 };
	fresh.motion = {
		...fresh.motion,
		position: { x: 100, y: 100, z: 20 },
		limits: { x: { min: 0, max: 250 }, y: { min: 0, max: 250 }, z: { min: 0, max: 250 } }
	};
	const session: FilamentChangeSession = {
		id: crypto.randomUUID(),
		ownerId: 'owner',
		filename: 'print',
		runId: 'run',
		generation: 1,
		settingsRevision: 1,
		fingerprint: capability.fingerprint,
		step: 1,
		stage: 'paused',
		startedAt: Date.now(),
		expiresAt: Date.now() + 60000,
		message: 'paused',
		assisted: { parked: false }
	};
	const command = {
		type: 'filamentChangePark' as const,
		sessionId: session.id,
		expectedStep: 1,
		expectedJob: { filename: 'print', runId: 'run' },
		confirmed: true
	};
	return { fresh, settings, session, command };
}
it('derives extrusion velocity from Klipper defaults and excludes unsupported topology or overridden commands', () => {
	expect(filamentChangeCapability(objects, config)?.assisted?.maxVelocity).toBeCloseTo(
		(300 * 4 * 0.4 ** 2) / (Math.PI * (1.75 / 2) ** 2)
	);
	for (const name of [
		'extruder1',
		'dual_carriage',
		'skew_correction',
		'bed_tilt',
		'axis_twist_compensation',
		'z_thermal_adjust',
		'manual_stepper custom',
		'gcode_macro M221',
		'gcode_macro G1'
	])
		expect(filamentChangeCapability([...objects, name], config)?.assisted?.supported).toBe(false);
	expect(
		filamentChangeCapability(objects, {
			...config,
			printer: { ...config.printer, kinematics: 'delta' }
		})?.assisted?.supported
	).toBe(false);
});
it('plans one Z lift before XY, preserves modal state and checks both coordinate spaces', () => {
	const f = fixture();
	const plan = assistedFilamentPlan(f.command, f.session, f.settings, f.fresh);
	expect(plan.operations).toEqual([
		{
			type: 'controlScript',
			script: expect.stringMatching(
				/SAVE_GCODE_STATE NAME=perilune_swap_.*\nG91\nM220 S100\nG1 Z5.000 F300\nG1 X-90.000 Y-80.000 F1800\nM400\nRESTORE_GCODE_STATE NAME=perilune_swap_.*/
			)
		}
	]);
	expect(plan.session.pendingMove).toMatchObject({
		kind: 'park',
		position: { x: 10, y: 20, z: 25 }
	});
	f.fresh.motion.position.z = 249;
	expect(() => assistedFilamentPlan(f.command, f.session, f.settings, f.fresh)).toThrow('headroom');
	f.fresh.motion.position.z = 20;
	f.fresh.gcodePosition.z = 249;
	expect(() => assistedFilamentPlan(f.command, f.session, f.settings, f.fresh)).toThrow('headroom');
});
it('rejects duplicate parking, custom pause double-parking, active meshes and missing parser telemetry', () => {
	const f = fixture();
	f.session.assisted = { parked: true };
	expect(() => assistedFilamentPlan(f.command, f.session, f.settings, f.fresh)).toThrow('already');
	f.session.assisted = { parked: false };
	f.fresh.filamentChange.assisted!.customPause = true;
	expect(() => assistedFilamentPlan(f.command, f.session, f.settings, f.fresh)).toThrow(
		'custom PAUSE'
	);
	f.fresh.filamentChange.assisted!.customPause = false;
	f.fresh.bedMesh.status = 'invalid';
	expect(() => assistedFilamentPlan(f.command, f.session, f.settings, f.fresh)).toThrow('bed mesh');
});
it('does not trust changed parking, cold extrusion or over-limit profiles', () => {
	const f = fixture();
	const command = { ...f.command, type: 'filamentChangeFeed' as const, operation: 'load' as const };
	f.session.assisted = {
		parked: true,
		position: { x: 100, y: 100, z: 20 },
		physicalPosition: { x: 100, y: 100, z: 20 }
	};
	f.fresh.gcodePosition.x = 101;
	expect(() => assistedFilamentPlan(command, f.session, f.settings, f.fresh)).toThrow(
		'position changed'
	);
	f.fresh.gcodePosition.x = 100;
	f.fresh.heaters.nozzle.target = 0;
	expect(() => assistedFilamentPlan(command, f.session, f.settings, f.fresh)).toThrow('cold');
	f.fresh.heaters.nozzle.target = 200;
	f.fresh.filament!.maxDistance = 10;
	expect(() => assistedFilamentPlan(command, f.session, f.settings, f.fresh)).toThrow('limit');
});
