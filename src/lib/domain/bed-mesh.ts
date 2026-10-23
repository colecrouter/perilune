/** Sanitized inspection data only. Matrices are ordered from minimum Y, minimum X. */
export interface BedMesh {
	name: string;
	min: [number, number];
	max: [number, number];
	points: number[][];
	parameters?: Record<string, string | number>;
}
export interface BedMeshState {
	status: 'unavailable' | 'empty' | 'ready' | 'invalid';
	active: BedMesh | null;
	profiles: BedMesh[];
	omittedProfiles: number;
}
export const emptyBedMesh = (): BedMeshState => ({
	status: 'unavailable',
	active: null,
	profiles: [],
	omittedProfiles: 0
});
const record = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const finite = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);
const pair = (value: unknown): value is [number, number] =>
	Array.isArray(value) &&
	value.length === 2 &&
	value.every((v) => finite(v) && Math.abs(v) <= 1000000);
function mesh(name: string, min: unknown, max: unknown, points: unknown): BedMesh | null {
	if (!pair(min) || !pair(max) || max[0] <= min[0] || max[1] <= min[1]) return null;
	if (!Array.isArray(points) || points.length < 2 || points.length > 65) return null;
	const width = Array.isArray(points[0]) ? points[0].length : 0;
	if (
		width < 2 ||
		width > 65 ||
		!points.every(
			(row) =>
				Array.isArray(row) &&
				row.length === width &&
				row.every((v) => finite(v) && Math.abs(v) <= 1000)
		)
	)
		return null;
	return {
		name: name.slice(0, 120),
		min: [...min],
		max: [...max],
		points: points.map((row) => [...row])
	};
}
export function meshParameters(value: unknown): Record<string, string | number> | undefined {
	const raw = record(value);
	const result: Record<string, string | number> = {};
	for (const key of ['x_count', 'y_count', 'mesh_x_pps', 'mesh_y_pps', 'tension', 'algo']) {
		const v = raw[key];
		if (key === 'algo') {
			if (typeof v === 'string' && ['lagrange', 'bicubic', 'direct'].includes(v)) result[key] = v;
		} else if (v !== undefined && Number.isFinite(Number(v))) result[key] = Number(v);
	}
	return Object.keys(result).length ? result : undefined;
}
export function normalizeBedMesh(value: unknown, supported: boolean): BedMeshState {
	if (!supported) return emptyBedMesh();
	const raw = record(value);
	const active = mesh(
		typeof raw.profile_name === 'string' ? raw.profile_name : '',
		raw.mesh_min,
		raw.mesh_max,
		raw.probed_matrix
	);
	const entries = Object.entries(record(raw.profiles));
	const profiles: BedMesh[] = [];
	let remaining = 32768 - (active?.points.flat().length ?? 0);
	for (const [name, value] of entries.slice(0, 32)) {
		const profile = record(value);
		const params = record(profile.mesh_params);
		const parsed =
			name.length <= 120
				? mesh(name, [params.min_x, params.min_y], [params.max_x, params.max_y], profile.points)
				: null;
		if (parsed && parsed.points.flat().length <= remaining) {
			remaining -= parsed.points.flat().length;
			const parameters = meshParameters(params);
			if (parameters) parsed.parameters = parameters;
			profiles.push(parsed);
		}
	}
	if (active) {
		const parameters = profiles.find((p) => p.name === active.name)?.parameters;
		if (parameters) active.parameters = { ...parameters };
	}
	const empty =
		Array.isArray(raw.probed_matrix) &&
		raw.probed_matrix.every((row) => Array.isArray(row) && row.length === 0);
	return {
		status: active ? 'ready' : empty ? 'empty' : 'invalid',
		active,
		profiles,
		omittedProfiles: entries.length - profiles.length
	};
}
export function meshStats(mesh: BedMesh) {
	const values = mesh.points.flat();
	const minimum = Math.min(...values);
	const maximum = Math.max(...values);
	return { minimum, maximum, range: maximum - minimum, count: values.length };
}
export function meshPoint(mesh: BedMesh, row: number, column: number) {
	return {
		x: mesh.min[0] + ((mesh.max[0] - mesh.min[0]) * column) / (mesh.points[0].length - 1),
		y: mesh.min[1] + ((mesh.max[1] - mesh.min[1]) * row) / (mesh.points.length - 1),
		z: mesh.points[row][column]
	};
}
export function compatibleMeshes(a: BedMesh, b: BedMesh): boolean {
	return (
		a.points.length === b.points.length &&
		a.points[0].length === b.points[0].length &&
		a.min.every((v, i) => Math.abs(v - b.min[i]) < 0.000001) &&
		a.max.every((v, i) => Math.abs(v - b.max[i]) < 0.000001)
	);
}
export function meshDifference(a: BedMesh, b: BedMesh): BedMesh | null {
	return compatibleMeshes(a, b)
		? { ...a, points: a.points.map((row, y) => row.map((value, x) => value - b.points[y][x])) }
		: null;
}
export function simulatedBedMesh(): BedMeshState {
	const points = Array.from({ length: 5 }, (_, y) =>
		Array.from({ length: 5 }, (_, x) =>
			Number((0.018 * (x - 2) + 0.013 * (y - 2) + 0.012 * ((x - 2) ** 2 + (y - 2) ** 2)).toFixed(3))
		)
	);
	const active: BedMesh = { name: 'warm-bed', min: [20, 20], max: [200, 200], points };
	return {
		status: 'ready',
		active,
		profiles: [
			{ ...active, points: points.map((row) => [...row]) },
			{
				...active,
				name: 'cold-bed',
				points: points.map((row) => row.map((v) => Number((v * 1.4 - 0.025).toFixed(3))))
			}
		],
		omittedProfiles: 0
	};
}
