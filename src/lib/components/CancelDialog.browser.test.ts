import { expect, test, vi } from 'vite-plus/test';
import { page } from 'vite-plus/test/browser';
import { render } from 'vitest-browser-svelte';
import CancelDialog from './CancelDialog.svelte';

test('cooldown choices survive off targets and concurrent heating', async () => {
	const onConfirm = vi.fn().mockResolvedValue(undefined);
	const screen = await render(CancelDialog, {
		props: { open: true, bedTarget: 60, nozzleTarget: 210, onConfirm }
	});
	const nozzle = screen.getByRole('checkbox', { name: 'Cool down nozzle' });
	const bed = screen.getByRole('checkbox', { name: 'Cool down bed' });
	await nozzle.click();
	await screen.rerender({ bedTarget: 0, nozzleTarget: 0 });
	await expect.element(nozzle).toBeDisabled();
	await expect.element(nozzle).not.toBeChecked();
	await expect.element(bed).toBeChecked();
	await screen.rerender({ bedTarget: 60, nozzleTarget: 230 });
	await expect.element(nozzle).toBeEnabled();
	await expect.element(nozzle).not.toBeChecked();
	await screen.getByRole('button', { name: 'Stop print', exact: true }).click();
	expect(onConfirm).toHaveBeenCalledWith(true, false);
});

test('unavailable telemetry does not present retained zero targets as fulfilled', async () => {
	const screen = await render(CancelDialog, {
		props: { open: true, available: false, bedTarget: 0, nozzleTarget: 0, onConfirm: vi.fn() }
	});
	await expect
		.element(screen.getByRole('button', { name: 'Stop print', exact: true }))
		.toBeDisabled();
	await expect
		.element(screen.getByText('Target already off; the nozzle may still be cooling.'))
		.not.toBeInTheDocument();
	await screen.rerender({ available: true });
	await expect
		.element(screen.getByText('Target already off; the nozzle may still be cooling.'))
		.toBeVisible();
	await expect.element(screen.getByRole('checkbox', { name: 'Cool down nozzle' })).toBeDisabled();
});

test('stop dialog independently retains bed heat and cools nozzle', async () => {
	const onConfirm = vi.fn().mockResolvedValue(undefined);
	await render(CancelDialog, { open: true, bedTarget: 60, nozzleTarget: 210, onConfirm });
	await page.getByRole('checkbox', { name: 'Cool down bed' }).click();
	await page.getByRole('button', { name: 'Stop print', exact: true }).click();
	expect(onConfirm).toHaveBeenCalledWith(false, true);
});

test('failed submission keeps choices and explains the failure', async () => {
	await render(CancelDialog, {
		open: true,
		bedTarget: 60,
		nozzleTarget: 210,
		onConfirm: vi.fn().mockRejectedValue(new Error('Connection lost'))
	});
	await page.getByRole('checkbox', { name: 'Cool down nozzle' }).click();
	await page.getByRole('button', { name: 'Stop print', exact: true }).click();
	await expect.element(page.getByRole('alert')).toHaveTextContent('Connection lost');
	await expect.element(page.getByRole('checkbox', { name: 'Cool down nozzle' })).not.toBeChecked();
});
