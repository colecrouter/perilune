import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import SavedMeshes from './SavedMeshes.svelte';
import { initialSnapshot } from '#lib/domain/printer.js';
test('inspection and replacement do not submit commands; load is explicitly confirmed', async () => {
	const snapshot = initialSnapshot();
	snapshot.job.state = 'complete';
	const onSubmit = vi.fn().mockResolvedValue('receipt'),
		onInspect = vi.fn(),
		onReplace = vi.fn();
	const screen = await render(SavedMeshes, {
		snapshot,
		connected: true,
		role: 'owner',
		onSubmit,
		onInspect,
		onReplace
	});
	await screen.getByRole('button', { name: 'Inspect', exact: true }).first().click();
	expect(onInspect).toHaveBeenCalledWith('warm-bed');
	expect(onSubmit).not.toHaveBeenCalled();
	await screen.getByRole('button', { name: 'Replace…', exact: true }).first().click();
	expect(onReplace).toHaveBeenCalledWith('warm-bed');
	expect(onSubmit).not.toHaveBeenCalled();
	await screen.getByRole('button', { name: 'Use…', exact: true }).first().click();
	expect(onSubmit).not.toHaveBeenCalled();
	await screen.getByRole('button', { name: 'Use mesh', exact: true }).click();
	expect(onSubmit).toHaveBeenCalledWith(
		expect.objectContaining({
			type: 'meshProbeProfile',
			operation: 'load',
			name: 'warm-bed',
			expected: JSON.stringify(snapshot.bedMesh.profiles[0]),
			confirmed: true
		})
	);
});
test('deletion protects the active mesh and requires startup-reference review', async () => {
	const snapshot = initialSnapshot();
	snapshot.job.state = 'complete';
	const onSubmit = vi.fn().mockResolvedValue('receipt');
	const screen = await render(SavedMeshes, {
		snapshot,
		connected: true,
		role: 'owner',
		onSubmit,
		onInspect: () => {},
		onReplace: () => {}
	});
	await expect
		.element(screen.getByRole('button', { name: 'Delete…', exact: true }).first())
		.toBeDisabled();
	await screen.getByRole('button', { name: 'Delete…', exact: true }).nth(1).click();
	await expect
		.element(screen.getByRole('button', { name: 'Delete and restart', exact: true }))
		.toBeDisabled();
	await screen.getByRole('checkbox', { name: /I checked my print-start/ }).click();
	await screen.getByRole('button', { name: 'Delete and restart', exact: true }).click();
	expect(onSubmit).toHaveBeenCalledWith(
		expect.objectContaining({ operation: 'delete', name: 'cold-bed' })
	);
});
