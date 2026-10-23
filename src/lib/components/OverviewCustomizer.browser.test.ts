import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import OverviewCustomizer from './OverviewCustomizer.svelte';
import { overviewPreset } from '#lib/domain/overview-layout.js';
test('stages changes, cancels without saving and preserves choices after a failed save', async () => {
	const onSave = vi.fn().mockRejectedValueOnce(Error('Offline')).mockResolvedValueOnce(undefined);
	const screen = await render(OverviewCustomizer, { value: overviewPreset('balanced'), onSave });
	await screen.getByRole('button', { name: 'Customize', exact: true }).click();
	await screen.getByRole('button', { name: 'Compact', exact: true }).click();
	await screen.getByRole('button', { name: 'Cancel', exact: true }).click();
	expect(onSave).not.toHaveBeenCalled();
	await screen.getByRole('button', { name: 'Customize', exact: true }).click();
	await expect.element(screen.getByRole('checkbox', { name: 'Camera', exact: true })).toBeChecked();
	await screen.getByRole('button', { name: 'Compact', exact: true }).click();
	await screen
		.getByRole('button', { name: 'Move Temperature controls & sensors up', exact: true })
		.click();
	await screen.getByRole('button', { name: 'Save layout', exact: true }).click();
	await expect
		.element(screen.getByRole('alert'))
		.toHaveTextContent('Offline Your choices are kept; try saving again.');
	await expect
		.element(screen.getByRole('checkbox', { name: 'Camera', exact: true }))
		.not.toBeChecked();
	await screen.getByRole('button', { name: 'Save layout', exact: true }).click();
	await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
	expect(onSave).toHaveBeenLastCalledWith({
		preset: 'compact',
		order: ['temperature', 'camera', 'history', 'connection'],
		hidden: ['camera', 'history']
	});
});
