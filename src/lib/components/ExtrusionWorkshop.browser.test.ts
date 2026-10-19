import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import ExtrusionWorkshop from './ExtrusionWorkshop.svelte';
import { initialSnapshot, initialLiveSnapshot, applyCommand } from '#lib/domain/printer.js';
const actor = { id: 'owner', name: 'Owner', role: 'owner' };
const ready = () => {
	const state = initialSnapshot();
	state.job.state = 'cancelled';
	return state;
};
test('retains measurement drafts and acknowledgments through reconnects and disables physical actions', async () => {
	const onSubmit = vi.fn().mockResolvedValue(crypto.randomUUID());
	const snapshot = ready();
	const screen = await render(ExtrusionWorkshop, {
		snapshot,
		connected: true,
		userId: actor.id,
		role: actor.role,
		onSubmit
	});
	await screen.getByRole('spinbutton', { name: 'Current rotation distance (mm)' }).fill('7.5');
	await screen.getByRole('checkbox', { name: /Filament is loaded/ }).click();
	await screen.getByRole('checkbox', { name: /nozzle has clearance/ }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Extrude 50 mm · simulator' }))
		.toBeEnabled();
	await screen.rerender({
		snapshot: { ...snapshot, connection: 'disconnected' },
		connected: false
	});
	await expect
		.element(screen.getByRole('button', { name: 'Extrude 50 mm · simulator' }))
		.toBeDisabled();
	await expect
		.element(screen.getByRole('spinbutton', { name: 'Current rotation distance (mm)' }))
		.toHaveValue(7.5);
	await screen.rerender({ snapshot, connected: true });
	await screen.getByRole('button', { name: 'Extrude 50 mm · simulator' }).click();
	expect(onSubmit).toHaveBeenCalledWith(
		expect.objectContaining({
			type: 'extrusionBegin',
			rotationDistance: 7.5,
			before: 70,
			confirmed: true
		}),
		expect.any(String)
	);
});
test('manual calculator works offline and exports no printer action', async () => {
	const onSubmit = vi.fn();
	const screen = await render(ExtrusionWorkshop, {
		snapshot: initialLiveSnapshot(),
		connected: false,
		userId: actor.id,
		role: 'viewer',
		onSubmit
	});
	await screen.getByRole('spinbutton', { name: 'Current rotation distance (mm)' }).fill('7.5');
	await screen.getByRole('spinbutton', { name: 'Remaining after 50 mm (mm)' }).fill('22');
	await screen.getByRole('button', { name: 'Calculate proposal' }).click();
	await expect
		.element(screen.getByRole('heading', { name: '7.200 mm rotation distance' }))
		.toBeVisible();
	expect(onSubmit).not.toHaveBeenCalled();
	await screen.getByRole('spinbutton', { name: 'Remaining after 50 mm (mm)' }).fill('60');
	await expect
		.element(screen.getByRole('button', { name: 'Export proposal' }))
		.not.toBeInTheDocument();
	await screen.getByRole('button', { name: 'Calculate proposal' }).click();
	await expect
		.element(screen.getByRole('alert'))
		.toHaveTextContent(
			'Travel differs too much from 50 mm. Check the measurement, slipping, and nozzle blockage before trying again.'
		);
});
test('a second operator can observe a run but cannot record or finish it', async () => {
	let snapshot = applyCommand(
		ready(),
		{
			type: 'extrusionBegin',
			runId: crypto.randomUUID(),
			rotationDistance: 7.5,
			before: 70,
			confirmed: true
		},
		undefined,
		actor
	);
	snapshot.extrusion.session!.stage = 'measure';
	snapshot.extrusion.session!.completed = 50;
	const screen = await render(ExtrusionWorkshop, {
		snapshot,
		connected: true,
		userId: 'other',
		role: 'operator',
		onSubmit: vi.fn()
	});
	await expect.element(screen.getByRole('button', { name: 'Calculate proposal' })).toBeDisabled();
	await expect
		.element(screen.getByRole('button', { name: 'End operator’s workflow' }))
		.toBeDisabled();
});

test('new workflows require fresh physical checks, while competing calibration disables heating', async () => {
	const onSubmit = vi.fn().mockResolvedValue(crypto.randomUUID());
	const snapshot = ready();
	const screen = await render(ExtrusionWorkshop, {
		snapshot,
		connected: true,
		userId: actor.id,
		role: actor.role,
		onSubmit
	});
	await screen.getByRole('checkbox', { name: /Filament is loaded/ }).click();
	await screen.getByRole('checkbox', { name: /nozzle has clearance/ }).click();
	const running = applyCommand(
		snapshot,
		{ type: 'extrusionFeed', runId: crypto.randomUUID(), distance: 5, confirmed: true },
		undefined,
		actor
	);
	await screen.rerender({ snapshot: running });
	const finished = applyCommand(
		running,
		{ type: 'extrusionCancel', runId: running.extrusion.session!.id, coolNozzle: false },
		undefined,
		actor
	);
	await screen.rerender({ snapshot: finished });
	await expect
		.element(screen.getByRole('checkbox', { name: /Filament is loaded/ }))
		.not.toBeChecked();
	await expect
		.element(screen.getByRole('checkbox', { name: /nozzle has clearance/ }))
		.not.toBeChecked();
	await screen.rerender({
		snapshot: { ...finished, motion: { ...finished.motion, calibration: true } }
	});
	await screen.getByRole('spinbutton', { name: 'Target (°C)' }).fill('220');
	await expect
		.element(screen.getByRole('button', { name: 'Set target', exact: true }))
		.toBeDisabled();
});
test('live workflow starts physical measurement and retains drafts across telemetry updates', async () => {
	const snapshot = {
		...ready(),
		mode: 'moonraker' as const,
		liveControls: true,
		liveFilament: true,
		filament: { canExtrude: true, position: 100, active: 'extruder', maxDistance: 50, minTemp: 170 }
	};
	const onSubmit = vi.fn().mockResolvedValue(crypto.randomUUID());
	const screen = await render(ExtrusionWorkshop, {
		snapshot,
		connected: true,
		userId: actor.id,
		role: actor.role,
		onSubmit
	});
	await screen.getByRole('spinbutton', { name: 'Current rotation distance (mm)' }).fill('7.5');
	await screen.getByRole('checkbox', { name: /Filament is loaded/ }).click();
	await screen.getByRole('checkbox', { name: /nozzle has clearance/ }).click();
	await screen.getByRole('button', { name: 'Extrude 50 mm · live printer' }).click();
	expect(onSubmit).toHaveBeenCalledWith(
		expect.objectContaining({ type: 'extrusionBegin', confirmed: true }),
		expect.any(String)
	);
	await screen.rerender({
		snapshot: { ...snapshot, connection: 'disconnected' },
		connected: false
	});
	await expect
		.element(screen.getByRole('spinbutton', { name: 'Current rotation distance (mm)' }))
		.toHaveValue(7.5);
	await expect
		.element(screen.getByRole('button', { name: 'Extrude 50 mm · live printer' }))
		.toBeDisabled();
});

test('an ambiguous physical submission stays blocked until its recorded receipt arrives', async () => {
	const snapshot = {
		...ready(),
		mode: 'moonraker' as const,
		liveControls: true,
		liveFilament: true,
		filament: { canExtrude: true, position: 100, active: 'extruder', maxDistance: 50, minTemp: 170 }
	};
	const onSubmit = vi.fn().mockRejectedValue(new TypeError('connection lost'));
	const screen = await render(ExtrusionWorkshop, {
		snapshot,
		connected: true,
		userId: actor.id,
		role: actor.role,
		onSubmit
	});
	await screen.getByRole('checkbox', { name: /Filament is loaded/ }).click();
	await screen.getByRole('checkbox', { name: /nozzle has clearance/ }).click();
	await screen.getByText('Load or adjust filament', { exact: true }).click();
	await screen.getByRole('button', { name: 'Feed 5 mm', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Feed 5 mm', exact: true }))
		.toBeDisabled();
	await expect
		.element(screen.getByRole('link', { name: 'Check unconfirmed submission receipt' }))
		.toBeVisible();
	expect(onSubmit).toHaveBeenCalledTimes(1);
	const id = onSubmit.mock.calls[0][1];
	await screen.rerender({
		snapshot: {
			...snapshot,
			actions: [
				{ id, label: 'Feed', status: 'failed', createdAt: Date.now(), message: 'Not dispatched' }
			]
		}
	});
	await expect
		.element(screen.getByRole('button', { name: 'Feed 5 mm', exact: true }))
		.toBeEnabled();
});
