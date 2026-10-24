import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import HeaterControl from './HeaterControl.svelte';

test('live temperature updates preserve an unsent target draft', async () => {
	const onSet = vi.fn().mockResolvedValue(undefined);
	const screen = await render(HeaterControl, {
		props: { heater: 'bed', current: 60, target: 60, pending: false, onSet }
	});
	const input = screen.getByRole('spinbutton', { name: 'Bed target' });
	await input.fill('85');
	await screen.rerender({ current: 61, target: 65, pending: false });
	await expect.element(input).toHaveValue(85);
	await screen.getByRole('button', { name: 'Set', exact: true }).click();
	expect(onSet).toHaveBeenCalledWith(85);
});

test('pending actions disable submission without locking the draft', async () => {
	const screen = await render(HeaterControl, {
		props: { heater: 'nozzle', current: 210, target: 210, pending: true, onSet: vi.fn() }
	});
	await expect.element(screen.getByRole('button', { name: 'Set' })).toBeDisabled();
	await screen.getByRole('spinbutton', { name: 'Nozzle target' }).fill('220');
	await expect.element(screen.getByRole('spinbutton', { name: 'Nozzle target' })).toHaveValue(220);
});

test('cooldown sends zero and unavailable telemetry disables controls without clearing drafts', async () => {
	const onSet = vi.fn().mockResolvedValue(undefined);
	const screen = await render(HeaterControl, {
		props: {
			heater: 'bed',
			current: 80,
			target: 90,
			pending: false,
			onSet
		}
	});
	await screen.getByRole('button', { name: 'Cool down bed', exact: true }).click();
	expect(onSet).toHaveBeenCalledWith(0);
	await screen.getByRole('spinbutton', { name: 'Bed target' }).fill('85');
	await screen.rerender({ available: false });
	await expect.element(screen.getByText('Unknown', { exact: true })).toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Set', exact: true })).toBeDisabled();
	await expect.element(screen.getByRole('spinbutton', { name: 'Bed target' })).toHaveValue(85);
});

test('queue admission and a failed outcome retain the submitted target draft', async () => {
	const onSet = vi.fn().mockResolvedValue(undefined);
	const screen = await render(HeaterControl, {
		props: { heater: 'bed', current: 60, target: 60, pending: false, onSet }
	});
	const input = screen.getByRole('spinbutton', { name: 'Bed target' });
	await input.fill('85');
	await screen.getByRole('button', { name: 'Set', exact: true }).click();
	await screen.rerender({ target: 60, pending: true });
	await expect.element(input).toHaveValue(85);
	await screen.rerender({ pending: false });
	await expect.element(input).toHaveValue(85);
	await screen.rerender({ target: 85 });
	await screen.rerender({ target: 0 });
	await expect.element(input).toHaveValue(0);
});

test('an admitted cooldown keeps zero until telemetry acknowledges it', async () => {
	const screen = await render(HeaterControl, {
		props: {
			heater: 'bed',
			current: 80,
			target: 90,
			pending: false,
			onSet: vi.fn().mockResolvedValue(undefined)
		}
	});
	await screen.getByRole('button', { name: 'Cool down bed', exact: true }).click();
	const input = screen.getByRole('spinbutton', { name: 'Bed target' });
	await screen.rerender({ pending: true });
	await expect.element(input).toHaveValue(0);
	await screen.rerender({ pending: false });
	await expect.element(input).toHaveValue(0);
	await screen.rerender({ target: 0 });
	await screen.rerender({ target: 60 });
	await expect.element(input).toHaveValue(60);
});

test('matching targets and already-off heaters disable no-op actions without claiming cooling is complete', async () => {
	const onSet = vi.fn();
	const component = await render(HeaterControl, {
		props: { heater: 'nozzle', current: 190, target: 0, pending: false, onSet }
	});
	await expect.element(component.getByRole('button', { name: 'Set', exact: true })).toBeDisabled();
	await expect
		.element(component.getByRole('button', { name: 'Cool down nozzle', exact: true }))
		.toBeDisabled();
	await expect.element(component.getByText('Cooling', { exact: true })).toBeVisible();
	await component.getByRole('spinbutton', { name: 'Nozzle target' }).fill('210');
	await expect.element(component.getByRole('button', { name: 'Set', exact: true })).toBeEnabled();
	await component.rerender({ target: 210 });
	await expect.element(component.getByRole('button', { name: 'Set', exact: true })).toBeDisabled();
	await expect
		.element(component.getByRole('spinbutton', { name: 'Nozzle target' }))
		.toHaveValue(210);
	expect(onSet).not.toHaveBeenCalled();
});
