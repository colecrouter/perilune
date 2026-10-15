import { expect, it } from 'vite-plus/test';
import { initialLiveSnapshot } from './printer.js';
import { liveMeshPlan, liveMeshReason } from './live-mesh.js';
const config = {
	bed_mesh: { mesh_min: '30,30', mesh_max: '205,215', probe_count: '5,5' },
	bltouch: { x_offset: '-24', y_offset: '-13', samples: '2' }
};
it('derives a discrete rectangular plan and rejects unsupported probe paths', () => {
	expect(liveMeshPlan(config)).toEqual({
		min: [30, 30],
		max: [205, 215],
		offset: [-24, -13],
		columns: 5,
		rows: 5,
		samples: 2
	});
	for (const extra of [
		{ zero_reference_position: '0,0' },
		{ mesh_radius: '100' },
		{ faulty_region_1_min: '0,0' },
		{ probe_count: 'NaN,5' },
		{ mesh_min: '205,30' }
	])
		expect(liveMeshPlan({ ...config, bed_mesh: { ...config.bed_mesh, ...extra } })).toBeNull();
	expect(liveMeshPlan({ ...config, homing_override: { gcode: 'G28' } })).toBeNull();
	for (const name of ['G28', 'BED_MESH_CALIBRATE', 'BED_MESH_PROFILE', 'SAVE_CONFIG'])
		expect(liveMeshPlan({ ...config, [`gcode_macro ${name}`]: { gcode: 'CUSTOM' } })).toBeNull();
});
it('uses probe offsets for travel limits and requires fresh idle cold state', () => {
	const state = initialLiveSnapshot();
	Object.assign(state, {
		connection: 'connected',
		klippy: 'ready',
		telemetryReady: true,
		job: { ...state.job, state: 'complete' },
		heaters: { bed: { target: 0, current: 23 }, nozzle: { target: 0, current: 23 } },
		motion: {
			...state.motion,
			busy: false,
			limits: { x: { min: -6, max: 230 }, y: { min: -14, max: 230 }, z: { min: -3, max: 250 } }
		},
		liveMesh: { enabled: true, plan: liveMeshPlan(config), pendingConfig: false }
	});
	expect(liveMeshReason(state)).toBeNull(); // Unhomed is allowed: begin includes reviewed homing.
	state.motion.limits.x!.max = 220;
	expect(liveMeshReason(state)).toMatch(/travel/);
	state.motion.limits.x!.max = 230;
	state.telemetryReady = false;
	expect(liveMeshReason(state)).toMatch(/fresh/);
	state.telemetryReady = true;
	state.heaters.bed.target = 60;
	expect(liveMeshReason(state)).toMatch(/cold/);
	state.heaters.bed.target = 0;
	state.bedMesh.profiles = Array.from({ length: 31 }, (_, i) => ({
		name: `profile-${i}`,
		min: [20, 20],
		max: [200, 200],
		points: [
			[0, 0],
			[0, 0]
		]
	}));
	expect(liveMeshReason(state)).toMatch(/complete profile/);
	state.liveMesh.plan!.columns = 65;
	state.liveMesh.plan!.rows = 65;
	state.bedMesh.profiles = Array.from({ length: 5 }, (_, i) => ({
		name: `profile-${i}`,
		min: [20, 20],
		max: [200, 200],
		points: Array.from({ length: 65 }, () => Array(65).fill(0))
	}));
	expect(liveMeshReason(state)).toMatch(/space/);
});
