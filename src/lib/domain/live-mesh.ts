import { safetyReason } from './safety.js';
import type { PrinterSnapshot } from './printer.js';
import type { BedMesh } from './bed-mesh.js';
export interface LiveMeshPlan {
	min: [number, number];
	max: [number, number];
	offset: [number, number];
	columns: number;
	rows: number;
	samples: number;
}
const record = (v: unknown): Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const pair = (v: unknown): [number, number] | null => {
	if (typeof v !== 'string' && typeof v !== 'number') return null;
	const parts = String(v).split(',').map(Number);
	if (parts.length === 1) parts.push(parts[0]);
	return parts.length === 2 && parts.every(Number.isFinite) ? (parts as [number, number]) : null;
};
/** Only the reviewed rectangular, discrete-probe path is supported initially. */
export function liveMeshPlan(config: unknown): LiveMeshPlan | null {
	const c = record(config),
		mesh = record(c.bed_mesh),
		probe = record(c.bltouch ?? c.probe);
	if (
		!Object.keys(probe).length ||
		Object.keys(c).some((key) =>
			/^gcode_macro (G28|BED_MESH_CALIBRATE|BED_MESH_PROFILE|SAVE_CONFIG)$/i.test(key)
		) ||
		c.homing_override ||
		mesh.mesh_radius ||
		mesh.zero_reference_position ||
		Object.keys(mesh).some((k) => k.startsWith('faulty_region_'))
	)
		return null;
	const min = pair(mesh.mesh_min),
		max = pair(mesh.mesh_max),
		count = pair(mesh.probe_count ?? '3');
	const offset: [number, number] = [Number(probe.x_offset ?? 0), Number(probe.y_offset ?? 0)];
	const samples = Number(probe.samples ?? 1);
	if (
		!min ||
		!max ||
		!count ||
		!offset.every(Number.isFinite) ||
		!Number.isInteger(samples) ||
		samples < 1 ||
		samples > 20 ||
		!count.every((n) => Number.isInteger(n) && n >= 3 && n <= 65) ||
		!min.every((n, i) => Math.abs(n) <= 100000 && n < max[i]) ||
		!max.every((n) => Math.abs(n) <= 100000)
	)
		return null;
	return { min, max, offset, columns: count[0], rows: count[1], samples };
}
export function liveMeshReason(state: PrinterSnapshot, allowReservation = false): string | null {
	const safety = safetyReason(state.safety);
	if (safety) return safety;
	if (state.liveRecovery) return state.liveRecovery.message;
	if (state.configurationBusy) return 'Configuration recovery owns the printer.';
	if (!state.liveMesh.enabled) return 'Live bed mesh commands are disabled on this server.';
	if (state.connection !== 'connected' || state.klippy !== 'ready' || !state.telemetryReady)
		return 'Wait for fresh, ready printer telemetry.';
	if (state.storage !== 'healthy') return 'Action storage is unavailable.';
	if (
		!['standby', 'complete', 'cancelled'].includes(state.job.state) ||
		state.motion.busy !== false
	)
		return 'The printer must be idle with no running or paused job.';
	if (
		!allowReservation &&
		(state.motion.calibration ||
			(state.meshProbe.session &&
				['probing', 'review', 'uncertain', 'saving'].includes(state.meshProbe.session.stage)))
	)
		return 'Another calibration workflow owns the printer.';
	if (state.actions.some((a) => ['queued', 'sending'].includes(a.status)))
		return 'Another action is pending.';
	if (state.heaters.bed.target !== 0 || state.heaters.nozzle.target !== 0)
		return 'Turn heater targets off before this cold probing run.';
	if ([state.heaters.bed.current, state.heaters.nozzle.current].some((t) => t === null || t > 40))
		return 'Wait for both heaters to cool to 40°C or below for this cold probing run.';
	const plan = state.liveMesh.plan;
	if (!plan)
		return 'This printer needs a supported rectangular mesh and discrete probe configuration.';
	if (
		!allowReservation &&
		(state.bedMesh.omittedProfiles > 0 ||
			state.bedMesh.profiles.length >= 31 ||
			state.bedMesh.profiles.reduce((sum, p) => sum + p.points.length * p.points[0].length, 0) +
				3 * plan.rows * plan.columns >
				32768)
	)
		return 'The complete profile list and space for the result must be available before probing.';
	for (const [i, axis] of (['x', 'y'] as const).entries()) {
		const bounds = state.motion.limits[axis];
		if (
			!bounds ||
			plan.min[i] - plan.offset[i] < bounds.min ||
			plan.max[i] - plan.offset[i] > bounds.max
		)
			return 'The configured probe path exceeds nozzle travel limits.';
	}
	if (!state.motion.limits.z) return 'Z travel limits are unknown.';
	return null;
}
export function sameMesh(a: BedMesh | null, b: BedMesh | null): boolean {
	return Boolean(
		a &&
		b &&
		a.min.every((v, i) => Math.abs(v - b.min[i]) <= 1e-6) &&
		a.max.every((v, i) => Math.abs(v - b.max[i]) <= 1e-6) &&
		a.points.length === b.points.length &&
		a.points.every(
			(row, y) =>
				row.length === b.points[y].length &&
				row.every((v, x) => Math.abs(v - b.points[y][x]) <= 1e-6)
		)
	);
}
