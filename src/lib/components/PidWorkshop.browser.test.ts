import { expect, test } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import PidWorkshop from './PidWorkshop.svelte';
import { initialSnapshot } from '#lib/domain/printer.js';
const ready = () => {
	const s = initialSnapshot();
	s.job.state = 'standby';
	s.heaters = { nozzle: { current: 25, target: 0 }, bed: { current: 25, target: 0 } };
	return s;
};
test('preserves target and attendance during reconnect and resets attendance when the target changes', async () => {
	const snapshot = ready();
	const screen = await render(PidWorkshop, { snapshot, role: 'owner' });
	const button = screen.getByRole('button', { name: 'Run simulator calibration' });
	await expect.element(button).toBeDisabled();
	await screen.getByRole('spinbutton').fill('210');
	await screen.getByRole('checkbox').click();
	await expect.element(button).toBeEnabled();
	await screen.rerender({
		snapshot: { ...snapshot, connection: 'disconnected' },
		connected: false,
		role: 'owner'
	});
	await expect.element(button).toBeDisabled();
	await expect.element(screen.getByRole('spinbutton')).toHaveValue(210);
	await expect.element(screen.getByRole('checkbox')).toBeChecked();
	await screen.rerender({ snapshot, connected: true, role: 'owner' });
	await expect.element(button).toBeEnabled();
	await screen.getByRole('spinbutton').fill('220');
	await expect.element(screen.getByRole('checkbox')).not.toBeChecked();
	await expect.element(button).toBeDisabled();
});
test('keeps calibration disabled for viewers and makes synthetic results explicit', async () => {
	const snapshot = ready();
	snapshot.pid!.run = {
		id: 'example',
		ownerId: 'owner',
		heater: 'nozzle',
		target: 200,
		startedAt: Date.now(),
		stage: 'staged',
		parameters: { kp: 20, ki: 1.2, kd: 80 },
		message: 'Simulator example only.'
	};
	const screen = await render(PidWorkshop, { snapshot, role: 'viewer' });
	await expect.element(screen.getByRole('checkbox')).toBeDisabled();
	await expect
		.element(screen.getByRole('button', { name: 'Run simulator calibration' }))
		.toBeDisabled();
	await expect.element(screen.getByRole('heading', { name: 'Example result' })).toBeVisible();
	await expect
		.element(screen.getByRole('link', { name: /Review pending settings/ }))
		.not.toBeInTheDocument();
});

test('staged live gains lead directly to the focused review without saving', async () => {
	const snapshot = ready();
	snapshot.mode = 'moonraker';
	snapshot.pid!.run = {
		id: 'live-result',
		ownerId: 'owner',
		heater: 'nozzle',
		target: 200,
		startedAt: Date.now(),
		stage: 'staged',
		parameters: { kp: 20, ki: 1.2, kd: 80 },
		message: 'Staged and unsaved.'
	};
	const screen = await render(PidWorkshop, { snapshot, role: 'owner' });
	await expect
		.element(screen.getByRole('link', { name: 'Review pending settings →' }))
		.toHaveAttribute('href', '/configuration/pending');
	await expect.element(screen.getByText(/Nothing is saved until you confirm/)).toBeVisible();
});
