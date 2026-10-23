import { expect, test } from 'vite-plus/test';
import { initialSnapshot, applyCommand } from './printer.js';
import {
	advanceMeshProbe,
	meshProbeActive,
	restartMeshProbe,
	MESH_PROBE_IDLE_MS
} from './mesh-probe.js';
const owner = { id: 'owner', name: 'Owner', role: 'owner' };
const ready = () => {
	const state = initialSnapshot();
	state.job.state = 'cancelled';
	state.heaters.bed.target = 0;
	state.heaters.nozzle.target = 0;
	return state;
};
const begin = () =>
	applyCommand(
		ready(),
		{ type: 'meshProbeBegin', probeId: crypto.randomUUID(), confirmed: true },
		undefined,
		owner
	);
const completed = () => {
	const state = begin();
	for (let i = 0; i < 25; i++) state.meshProbe = advanceMeshProbe(state.meshProbe);
	return state;
};
test('progress produces a candidate without changing active mesh or printer position', () => {
	const state = begin();
	const baseline = state.bedMesh.active;
	const position = state.motion.position;
	for (let i = 0; i < 24; i++) state.meshProbe = advanceMeshProbe(state.meshProbe);
	expect(state.meshProbe.session?.stage).toBe('probing');
	expect(state.meshProbe.session?.result).toBeNull();
	state.meshProbe = advanceMeshProbe(state.meshProbe);
	expect(state.meshProbe.session?.stage).toBe('review');
	expect(state.meshProbe.session?.result?.points.flat()).toHaveLength(25);
	expect(state.bedMesh.active).toEqual(baseline);
	expect(state.motion.position).toEqual(position);
	expect(() => applyCommand(state, { type: 'home', axes: 'all' })).toThrow('owns');
});
test('begin revalidates readiness, clearance acknowledgment, roles and reviewed area', () => {
	for (const modify of [
		(s: ReturnType<typeof ready>) => (s.job.state = 'printing'),
		(s: ReturnType<typeof ready>) => (s.heaters.bed.target = 60),
		(s: ReturnType<typeof ready>) => (s.motion.homed = []),
		(s: ReturnType<typeof ready>) => (s.motion.limits.x = { min: 0, max: 100 })
	]) {
		const state = ready();
		modify(state);
		expect(() =>
			applyCommand(
				state,
				{ type: 'meshProbeBegin', probeId: crypto.randomUUID(), confirmed: true },
				undefined,
				owner
			)
		).toThrow();
	}
	expect(() =>
		applyCommand(
			ready(),
			{ type: 'meshProbeBegin', probeId: crypto.randomUUID(), confirmed: false },
			undefined,
			owner
		)
	).toThrow('clearance');
	expect(() =>
		applyCommand(
			ready(),
			{ type: 'meshProbeBegin', probeId: crypto.randomUUID(), confirmed: true },
			undefined,
			{ ...owner, role: 'viewer' }
		)
	).toThrow('operator');
});
test('review can save a new profile without activating or overwriting; temporary apply is explicit', () => {
	const state = completed();
	const id = state.meshProbe.session!.id;
	const saved = applyCommand(
		state,
		{ type: 'meshProbeFinish', probeId: id, outcome: 'save', name: 'reviewed-bed' },
		undefined,
		owner
	);
	expect(saved.meshProbe.savedProfiles[0].name).toBe('reviewed-bed');
	expect(saved.bedMesh.active).toEqual(state.bedMesh.active);
	expect(saved.motion.calibration).toBe(false);
	expect(() =>
		applyCommand(
			state,
			{ type: 'meshProbeFinish', probeId: id, outcome: 'save', name: 'warm-bed' },
			undefined,
			owner
		)
	).toThrow('exists');
	const applied = applyCommand(
		state,
		{ type: 'meshProbeFinish', probeId: id, outcome: 'apply' },
		undefined,
		owner
	);
	expect(applied.bedMesh.active?.name).toBe('temporary-probe');
	expect(restartMeshProbe(applied.meshProbe).session?.stage).toBe('interrupted');
	expect(() =>
		applyCommand(
			state,
			{ type: 'meshProbeFinish', probeId: crypto.randomUUID(), outcome: 'apply' },
			undefined,
			owner
		)
	).toThrow('changed');
});
test('ownership, forced owner cancellation, expiry and restart discard unsaved runs', () => {
	const state = completed();
	const id = state.meshProbe.session!.id;
	expect(() =>
		applyCommand(state, { type: 'meshProbeFinish', probeId: id, outcome: 'apply' }, undefined, {
			...owner,
			id: 'other'
		})
	).toThrow('belongs');
	expect(() =>
		applyCommand(
			state,
			{ type: 'meshProbeCancel', probeId: id, confirmed: true, force: true },
			undefined,
			{ id: 'other', name: 'Other', role: 'operator' }
		)
	).toThrow('belongs');
	const cancelled = applyCommand(
		state,
		{ type: 'meshProbeCancel', probeId: id, confirmed: true, force: true },
		undefined,
		{ ...owner, id: 'other' }
	);
	expect(meshProbeActive(cancelled.meshProbe)).toBe(false);
	expect(cancelled.bedMesh).toEqual(state.bedMesh);
	expect(
		advanceMeshProbe(state.meshProbe, state.meshProbe.session!.startedAt + MESH_PROBE_IDLE_MS + 1)
			.session?.stage
	).toBe('interrupted');
	expect(restartMeshProbe(state.meshProbe).session?.result).toBeNull();
});
test('acceptance replaces the target and saves only explicit unique named copies', () => {
	const state = completed();
	state.meshProbe.session!.usual = true;
	state.meshProbe.session!.target = 'warm-bed';
	const command = {
		type: 'meshProbeFinish' as const,
		probeId: state.meshProbe.session!.id,
		outcome: 'save' as const,
		name: 'spare'
	};
	const next = applyCommand(state, command, undefined, owner);
	expect(next.bedMesh.active?.name).toBe('warm-bed');
	expect(next.bedMesh.profiles.find((p) => p.name === 'warm-bed')?.points).toEqual(
		state.meshProbe.session!.result!.points
	);
	expect(next.bedMesh.profiles.find((p) => p.name === 'spare')?.points).toEqual(
		state.meshProbe.session!.result!.points
	);
	expect(() => applyCommand(state, { ...command, name: 'cold-bed' }, undefined, owner)).toThrow(
		/already exists/
	);
	expect(() => applyCommand(state, { ...command, name: 'warm-bed' }, undefined, owner)).toThrow(
		/already exists/
	);
});
