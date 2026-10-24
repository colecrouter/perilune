import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import ActionNotices from './ActionNotices.svelte';
import { initialSnapshot } from '#lib/domain/printer.js';

test('uses server-selected alerts rather than historical failed receipts', async () => {
	const snapshot = initialSnapshot();
	snapshot.actions = [
		{
			id: crypto.randomUUID(),
			label: 'Restore mesh',
			status: 'failed',
			message: 'Historical failure',
			createdAt: Date.now()
		}
	];
	snapshot.failureNotices = [];
	const dismissNotices = vi.fn(async () => {});
	const screen = await render(ActionNotices, { snapshot, dismissNotices });
	await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
	await screen.rerender({
		snapshot: { ...snapshot, failureNotices: [{ ...snapshot.actions[0]!, path: '/actions' }] }
	});
	await expect.element(screen.getByRole('alert')).toBeVisible();
	await screen.getByRole('button', { name: 'Dismiss failure notice' }).click();
	expect(dismissNotices).toHaveBeenCalledWith([snapshot.actions[0]!.id]);
	// Receipt remains visible until the server confirms its acknowledgement.
	await expect.element(screen.getByRole('alert')).toBeVisible();
	await screen.rerender({ snapshot });
	await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
});

test('failed acknowledgement keeps the alert and offers a retry', async () => {
	const snapshot = initialSnapshot();
	snapshot.failureNotices = [
		{
			id: crypto.randomUUID(),
			label: 'Restore mesh',
			status: 'failed',
			message: 'Failure',
			createdAt: Date.now(),
			path: '/actions'
		}
	];
	const screen = await render(ActionNotices, {
		snapshot,
		dismissNotices: async () => {
			throw Error('Offline');
		}
	});
	await screen.getByRole('button', { name: 'Dismiss failure notice' }).click();
	await expect
		.element(screen.getByText('Could not acknowledge this notice. Try again.'))
		.toBeVisible();
	await expect.element(screen.getByRole('alert')).toBeVisible();
});
