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
	await screen.getByRole('button', { name: 'Probe bed…', exact: true }).click();
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
