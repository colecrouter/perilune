import { expect, test } from 'vite-plus/test';
import {
	normalizeBedMesh,
	meshStats,
	meshPoint,
	meshDifference,
	simulatedBedMesh
} from './bed-mesh.js';
const status = () => ({
	profile_name: 'fixture',
	mesh_min: [10, 20],
	mesh_max: [110, 220],
	probed_matrix: [
		[-0.1, 0.2],
		[0.3, 0.4]
	],
	profiles: {
		fixture: {
			points: [
				[-0.1, 0.2],
				[0.3, 0.4]
			],
			mesh_params: { min_x: 10, min_y: 20, max_x: 110, max_y: 220 }
		}
	}
});
test('normalizes active and saved grids without reversing their coordinates', () => {
	const result = normalizeBedMesh(status(), true);
	expect(result.status).toBe('ready');
	expect(result.profiles[0].points).toEqual(result.active?.points);
	expect(meshPoint(result.active!, 0, 0)).toEqual({ x: 10, y: 20, z: -0.1 });
	expect(meshPoint(result.active!, 1, 1)).toEqual({ x: 110, y: 220, z: 0.4 });
	expect(meshStats(result.active!)).toEqual({ minimum: -0.1, maximum: 0.4, range: 0.5, count: 4 });
});
test('distinguishes unsupported, cleared, invalid and flat meshes', () => {
	expect(normalizeBedMesh(status(), false).status).toBe('unavailable');
	expect(
		normalizeBedMesh({ probed_matrix: [[]], profiles: status().profiles }, true)
	).toMatchObject({ status: 'empty', active: null, profiles: [{ name: 'fixture' }] });
	for (const points of [
		[
			[0, NaN],
			[0, 0]
		],
		[[0], [0, 0]],
		[
			[0, Infinity],
			[0, 0]
		],
		[
			[0, 1001],
			[0, 0]
		],
		Array.from({ length: 66 }, () => [0, 0])
	]) {
		expect(normalizeBedMesh({ ...status(), probed_matrix: points }, true).status).toBe('invalid');
	}
	const flat = normalizeBedMesh(
		{
			...status(),
			probed_matrix: [
				[0, 0],
				[0, 0]
			]
		},
		true
	);
	expect(flat.status).toBe('ready');
	expect(meshStats(flat.active!).range).toBe(0);
	expect(normalizeBedMesh({ ...status(), mesh_max: [10, 220] }, true).status).toBe('invalid');
});
test('bounds profiles and aggregate sample payload, reporting omissions', () => {
	const profile = {
		points: Array.from({ length: 65 }, () => Array(65).fill(0)),
		mesh_params: { min_x: 0, min_y: 0, max_x: 200, max_y: 200 }
	};
	const result = normalizeBedMesh(
		{
			...status(),
			profiles: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, profile]))
		},
		true
	);
	expect(result.profiles.length).toBe(7);
	expect(result.omittedProfiles).toBe(33);
});
test('comparison refuses incompatible coordinates and keeps source meshes unchanged', () => {
	const fixture = simulatedBedMesh();
	const a = fixture.active!;
	const b = fixture.profiles[1];
	const difference = meshDifference(a, b)!;
	expect(difference.points[0][0]).toBeCloseTo(a.points[0][0] - b.points[0][0]);
	expect(meshDifference(a, { ...b, min: [21, 20] })).toBeNull();
	expect(meshDifference(a, { ...b, points: b.points.slice(1) })).toBeNull();
	expect(a.points[0][0]).toBe(0.034);
});
