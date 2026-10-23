import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import BedMeshProbe from './BedMeshProbe.svelte';
import { initialSnapshot, applyCommand } from '#lib/domain/printer.js';
const actor = { id: 'owner', name: 'Owner', role: 'owner' };
const ready = () => {
	const state = initialSnapshot();
	state.job.state = 'cancelled';
	state.heaters.bed.target = 0;
	state.heaters.nozzle.target = 0;
	return state;
};
test('automatic preparation checks update without clearing manual acknowledgments', async () => {
	const onSubmit = vi.fn().mockResolvedValue(crypto.randomUUID());
	const snapshot = initialSnapshot();
	const screen = await render(BedMeshProbe, {
		snapshot,
		connected: true,
		userId: actor.id,
		role: actor.role,
		onSubmit
	});
	await screen.getByRole('button', { name: 'New calibration…', exact: true }).click();
	await screen.getByRole('checkbox', { name: /bed and probe cleanliness/ }).click();
	await screen.getByRole('checkbox', { name: /physical clearance/ }).click();
	await screen.getByRole('checkbox', { name: /synthetic simulator/ }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Begin simulator probing' }))
		.toBeDisabled();
	await screen.rerender({ snapshot: ready() });
	await expect
		.element(screen.getByRole('checkbox', { name: /bed and probe cleanliness/ }))
		.toBeChecked();
	await expect
		.element(screen.getByRole('checkbox', { name: 'Heater targets off', exact: true }))
		.toBeChecked();
	await expect.element(screen.getByRole('button', { name: 'Home all axes' })).toBeDisabled();
	await screen.getByRole('button', { name: 'Begin simulator probing' }).click();
	expect(onSubmit).toHaveBeenCalledWith(
		expect.objectContaining({ type: 'meshProbeBegin', confirmed: true })
	);
});
test('cancel dialogs retain the reviewed run identity through incoming replacement runs', async () => {
	const first = applyCommand(
		ready(),
		{ type: 'meshProbeBegin', probeId: crypto.randomUUID(), confirmed: true },
		undefined,
		actor
	);
	const onSubmit = vi.fn().mockResolvedValue(crypto.randomUUID());
	const screen = await render(BedMeshProbe, {
		snapshot: first,
		connected: true,
		userId: actor.id,
		role: actor.role,
		onSubmit
	});
	await screen.getByRole('button', { name: 'Cancel and discard…', exact: true }).click();
	const cancelled = applyCommand(
		first,
		{ type: 'meshProbeCancel', probeId: first.meshProbe.session!.id, confirmed: true },
		undefined,
		actor
	);
	const next = applyCommand(
		cancelled,
		{ type: 'meshProbeBegin', probeId: crypto.randomUUID(), confirmed: true },
		undefined,
		actor
	);
	await screen.rerender({ snapshot: next });
	await screen.getByRole('button', { name: 'Cancel and discard', exact: true }).click();
	expect(onSubmit).toHaveBeenCalledWith({
		type: 'meshProbeCancel',
		probeId: first.meshProbe.session!.id,
		confirmed: true,
		force: false
	});
});
test('live preparation explains physical homing and requires manual acknowledgments', async () => {
	const snapshot = ready();
	snapshot.mode = 'moonraker';
	snapshot.heaters.bed.current = 23;
	snapshot.heaters.nozzle.current = 23;
	snapshot.motion.homed = [];
	snapshot.liveMesh = {
		enabled: true,
		pendingConfig: false,
		plan: { min: [30, 30], max: [200, 200], offset: [0, 0], columns: 5, rows: 5, samples: 2 }
	};
	const onSubmit = vi.fn().mockResolvedValue(crypto.randomUUID());
	const screen = await render(BedMeshProbe, {
		snapshot,
		connected: true,
		userId: actor.id,
		role: actor.role,
		onSubmit
	});
	await screen.getByRole('button', { name: 'New calibration…', exact: true }).click();
	await expect.element(screen.getByRole('button', { name: 'Home and probe bed' })).toBeDisabled();
	await screen.getByRole('checkbox', { name: /bed and probe cleanliness/ }).click();
	await screen.getByRole('checkbox', { name: /physical clearance/ }).click();
	await screen.getByRole('checkbox', { name: /printer will move and probe/ }).click();
	await expect
		.element(screen.getByRole('checkbox', { name: /automatic homing/ }))
		.not.toBeChecked();
	await screen.getByRole('button', { name: 'Home and probe bed' }).click();
	expect(onSubmit).toHaveBeenCalledWith(
		expect.objectContaining({ type: 'meshProbeBegin', confirmed: true })
	);
});
test('live probing does not offer queued cancellation as a physical stop', async () => {
	const snapshot = ready();
	snapshot.mode = 'moonraker';
	snapshot.heaters.bed.current = 23;
	snapshot.heaters.nozzle.current = 23;
	snapshot.liveMesh = {
		enabled: true,
		pendingConfig: false,
		plan: { min: [30, 30], max: [200, 200], offset: [0, 0], columns: 5, rows: 5, samples: 2 }
	};
	snapshot.meshProbe.session = {
		id: crypto.randomUUID(),
		ownerId: actor.id,
		ownerName: actor.name,
		stage: 'probing',
		live: true,
		plan: snapshot.liveMesh.plan!,
		completedSamples: 2,
		startedAt: Date.now(),
		expiresAt: Date.now() + 600000,
		result: null,
		message: null
	};
	const screen = await render(BedMeshProbe, {
		snapshot,
		connected: true,
		userId: actor.id,
		role: actor.role,
		onSubmit: vi.fn()
	});
	await expect
		.element(screen.getByRole('button', { name: 'Restore previous mesh…' }))
		.toBeDisabled();
	await expect.element(screen.getByText(/Normal queued commands cannot interrupt/)).toBeVisible();
});
test('live review waits for motion to settle before enabling finish controls', async () => {
	const snapshot = ready();
	snapshot.mode = 'moonraker';
	snapshot.heaters.bed.current = 23;
	snapshot.heaters.nozzle.current = 23;
	snapshot.motion.busy = true;
	snapshot.liveMesh = {
		enabled: true,
		pendingConfig: true,
		plan: { min: [20, 20], max: [200, 200], offset: [0, 0], columns: 5, rows: 5, samples: 1 }
	};
	snapshot.meshProbe.session = {
		id: crypto.randomUUID(),
		ownerId: actor.id,
		ownerName: actor.name,
		stage: 'review',
		live: true,
		plan: snapshot.liveMesh.plan!,
		completedSamples: 25,
		startedAt: Date.now(),
		expiresAt: Date.now() + 600000,
		result: snapshot.bedMesh.active,
		message: null
	};
	const screen = await render(BedMeshProbe, {
		snapshot,
		connected: true,
		userId: actor.id,
		role: actor.role,
		onSubmit: vi.fn()
	});
	await expect.element(screen.getByRole('button', { name: 'Save profile…' })).toBeDisabled();
	await expect
		.element(screen.getByText(/Waiting for the printer to finish movement/))
		.toBeVisible();
	await screen.rerender({ snapshot: { ...snapshot, motion: { ...snapshot.motion, busy: false } } });
	await expect.element(screen.getByRole('button', { name: 'Save profile…' })).toBeEnabled();
	await screen.rerender({
		snapshot: { ...snapshot, telemetryReady: false, motion: { ...snapshot.motion, busy: false } }
	});
	await expect.element(screen.getByRole('button', { name: 'Save profile…' })).toBeDisabled();
});

test('destination selection captures the selected saved mesh and reopening resets intent and acknowledgments', async () => {
	const snapshot = ready();
	const onSubmit = vi.fn().mockResolvedValue('receipt');
	const screen = await render(BedMeshProbe, {
		snapshot,
		connected: true,
		userId: actor.id,
		role: actor.role,
		onSubmit
	});
	await screen.getByRole('button', { name: 'New calibration…', exact: true }).click();
	await screen.getByRole('combobox', { name: 'Calibration replaces' }).selectOptions('cold-bed');
	await screen.getByRole('checkbox', { name: /bed and probe cleanliness/ }).click();
	await screen.getByRole('checkbox', { name: /physical clearance/ }).click();
	await screen.getByRole('checkbox', { name: /synthetic simulator/ }).click();
	await screen.getByRole('button', { name: 'Begin simulator probing' }).click();
	expect(onSubmit).toHaveBeenCalledWith(
		expect.objectContaining({
			target: 'cold-bed',
			expectedTarget: JSON.stringify(snapshot.bedMesh.profiles.find((p) => p.name === 'cold-bed'))
		})
	);
	await screen.getByRole('button', { name: 'New calibration…', exact: true }).click();
	await expect
		.element(screen.getByRole('combobox', { name: 'Calibration replaces' }))
		.toHaveValue('default');
	await expect
		.element(screen.getByRole('checkbox', { name: /bed and probe cleanliness/ }))
		.not.toBeChecked();
});
