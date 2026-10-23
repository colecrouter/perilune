import { meshPoint, type BedMesh } from './bed-mesh.js';
/** One shared, symmetric scale for the map, reported samples, lines and legend. */
export function meshHeightColor(value: number, scale: number) {
	const weight = Math.min(1, Math.abs(value) / Math.max(scale, 0.001)) * 0.7;
	const accent = value < 0 ? [52, 114, 121] : [137, 117, 172];
	return `rgb(${accent.map((v, i) => Math.round([239, 235, 225][i]! * (1 - weight) + v * weight)).join(',')})`;
}
/** Adjacent reported samples only; no inferred firmware compensation or smoothing. */
export function meshSegments(mesh: BedMesh) {
	const segments = [];
	for (let row = 0; row < mesh.points.length; row++) {
		for (let column = 0; column < mesh.points[0]!.length; column++) {
			const a = meshPoint(mesh, row, column);
			for (const [r, c] of [
				[row, column + 1],
				[row + 1, column]
			]) {
				if (r! >= mesh.points.length || c! >= mesh.points[0]!.length) continue;
				const b = meshPoint(mesh, r!, c!);
				segments.push({
					x1: a.x,
					y1: a.y,
					z1: a.z,
					x2: b.x,
					y2: b.y,
					z2: b.z,
					height: (a.z + b.z) / 2
				});
			}
		}
	}
	return segments;
}
