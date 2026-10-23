import { expect, it } from 'vite-plus/test';
import { meshSegments, meshHeightColor } from './mesh-visualization.js';
it('connects adjacent measured coordinates without crossing row boundaries or altering heights', () => {
	const mesh = {
		name: 'fixture',
		min: [10, 20] as [number, number],
		max: [30, 60] as [number, number],
		points: [
			[-0.2, 0, 0.2],
			[0.1, 0.3, 0.5]
		]
	};
	const before = JSON.stringify(mesh);
	const edges = meshSegments(mesh);
	expect(edges).toHaveLength(7);
	expect(edges[0]).toEqual({ x1: 10, y1: 20, z1: -0.2, x2: 20, y2: 20, z2: 0, height: -0.1 });
	expect(edges[1]).toEqual({ x1: 10, y1: 20, z1: -0.2, x2: 10, y2: 60, z2: 0.1, height: -0.05 });
	expect(JSON.stringify(mesh)).toBe(before);
	expect(
		meshSegments({ ...mesh, points: Array.from({ length: 65 }, () => Array(65).fill(0)) })
	).toHaveLength(8320);
});
it('uses a neutral zero, distinct signs and clamped color endpoints for every legend range', () => {
	expect(meshHeightColor(0, 0.1)).toBe('rgb(239,235,225)');
	expect(meshHeightColor(-0.1, 0.1)).not.toBe(meshHeightColor(0.1, 0.1));
	expect(meshHeightColor(10, 0.1)).toBe(meshHeightColor(0.1, 0.1));
	expect(meshHeightColor(-10, 0.1)).toBe(meshHeightColor(-0.1, 0.1));
});
