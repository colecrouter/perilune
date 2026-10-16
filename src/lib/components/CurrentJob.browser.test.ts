import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import { initialSnapshot } from '#lib/domain/printer.js';
import CurrentJob from './CurrentJob.svelte';

test('paused jobs explain manual changes and disable controls during reconnect', async () => {
	const snapshot = structuredClone(initialSnapshot());
	snapshot.job.state = 'paused';
	const onStop = vi.fn();
	const screen = await render(CurrentJob, { snapshot, onStop });
	await expect.element(screen.getByRole('button', { name: 'Resume print' })).toBeEnabled();
	await expect.element(screen.getByText(/A filament change may need a purge/)).toBeVisible();
	await screen.getByRole('button', { name: 'Stop print' }).click();
	expect(onStop).toHaveBeenCalledOnce();
	await screen.rerender({ available: false });
	await expect.element(screen.getByRole('button', { name: 'Resume print' })).toBeDisabled();
	await expect
		.element(screen.getByRole('button', { name: 'Stop print' }))
		.toHaveAttribute('aria-disabled', 'true');
	expect(onStop).toHaveBeenCalledOnce();
	await expect.element(screen.getByRole('progressbar')).toBeVisible();
});

test('finished jobs replace active progress with a review link, never an automatic retry', async () => {
	const snapshot = structuredClone(initialSnapshot());
	snapshot.job.state = 'complete';
	snapshot.job.progress = 100;
	snapshot.job.filename = 'bracket & base.gcode';
	const screen = await render(CurrentJob, { snapshot, onStop: vi.fn() });
	await expect.element(screen.getByRole('heading', { name: 'Print complete' })).toBeVisible();
	await expect.element(screen.getByRole('progressbar')).not.toBeInTheDocument();
	await expect.element(screen.getByRole('button', { name: 'Pause print' })).not.toBeInTheDocument();
	await expect
		.element(screen.getByRole('link', { name: 'Review & print again' }))
		.toHaveAttribute('href', '/jobs?q=bracket%20%26%20base.gcode');
	await screen.rerender({ snapshot: { ...snapshot, job: { ...snapshot.job, state: 'standby' } } });
	await expect.element(screen.getByRole('link', { name: 'Choose a file' })).toBeVisible();
});
