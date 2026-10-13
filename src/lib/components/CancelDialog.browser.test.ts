import { expect, test, vi } from 'vite-plus/test';
import { page } from 'vite-plus/test/browser';
import { render } from 'vitest-browser-svelte';
import CancelDialog from './CancelDialog.svelte';

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
