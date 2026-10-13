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
	await expect.element(screen.getByRole('button', { name: 'Pending…' })).toBeDisabled();
	await screen.getByRole('spinbutton', { name: 'Nozzle target' }).fill('220');
	await expect.element(screen.getByRole('spinbutton', { name: 'Nozzle target' })).toHaveValue(220);
});
