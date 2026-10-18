import { expect, test } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import JobInterventions from './JobInterventions.svelte';

test('distinguishes an uninspected file, a known zero, and explicit manual changes', async () => {
	const screen = await render(JobInterventions, {});
	await expect.element(screen.getByText('Not inspected.', { exact: false })).toBeVisible();
	await screen.rerender({ inspection: { filamentChanges: 0, pauses: 0, locations: [] } });
	await expect
		.element(screen.getByText('No recognizable manual-change or pause commands found.'))
		.toBeVisible();
	await screen.rerender({
		inspection: { filamentChanges: 10, pauses: 1, locations: [{ line: 24, command: 'M600' }] }
	});
	await expect
		.element(
			screen.getByText('10 manual filament changes and 1 other pause requested by this file.')
		)
		.toBeVisible();
	await screen.getByText('Show command locations').click();
	await expect.element(screen.getByText('Line 24:', { exact: false })).toBeVisible();
	await expect
		.element(
			screen.getByText('This inspection does not check whether a file is safe to print.', {
				exact: false
			})
		)
		.toBeVisible();
});
