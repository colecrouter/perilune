import { expect, test } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vite-plus/test/browser';
import BedMeshInspector from './BedMeshInspector.svelte';
import { simulatedBedMesh, emptyBedMesh } from '#lib/domain/bed-mesh.js';

test('selection and comparison survive reconnect telemetry; inspecting a profile emits no commands', async () => {
	const meshState = simulatedBedMesh();
	const screen = await render(BedMeshInspector, { meshState, simulator: true });
	await screen.getByRole('combobox', { name: 'Inspect mesh' }).selectOptions('profile:cold-bed');
	await screen.getByRole('combobox', { name: 'Compare with' }).selectOptions('active');
	await expect.element(screen.getByText('Difference range', { exact: true })).toBeVisible();
	await screen.getByRole('spinbutton', { name: 'Row (Y)' }).fill('3');
	await screen.rerender({ fresh: false, meshState: { ...meshState } });
	await expect.element(screen.getByRole('spinbutton', { name: 'Row (Y)' })).toHaveValue(3);
	await expect
		.element(screen.getByRole('combobox', { name: 'Inspect mesh' }))
		.toHaveValue('profile:cold-bed');
	await expect.element(screen.getByText(/Retained mesh data is stale/)).toBeVisible();
	await screen.getByRole('button', { name: /X 20.0, Y 110.0:/ }).click();
	await userEvent.keyboard('{ArrowUp}');
	await expect.element(screen.getByRole('spinbutton', { name: 'Row (Y)' })).toHaveValue(4);
	await screen.getByText('All sample values', { exact: true }).click();
	await expect.element(screen.getByRole('table')).toBeVisible();
});
test('missing and incompatible profiles have explicit fallback messages', async () => {
	const meshState = simulatedBedMesh();
	meshState.profiles[1].min = [21, 20];
	const screen = await render(BedMeshInspector, { meshState });
	await screen.getByRole('combobox', { name: 'Compare with' }).selectOptions('profile:cold-bed');
	await expect
		.element(screen.getByText(/point-by-point comparison would be misleading/))
		.toBeVisible();
	await screen.rerender({ meshState: emptyBedMesh() });
	await expect
		.element(screen.getByRole('heading', { name: 'Bed mesh is not available' }))
		.toBeVisible();
});
