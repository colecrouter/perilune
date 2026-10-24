import { expect, test } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import ActionNotices from './ActionNotices.svelte';
import { actionNotices } from '#lib/client/action-notices.svelte.js';
import { initialSnapshot } from '#lib/domain/printer.js';

test('a failure after acceptance is visible globally and dismissal survives navigation but not a new failure', async () => {
	const snapshot = initialSnapshot();
	const action = {
		id: 'first',
		label: 'Set nozzle',
		status: 'sending' as const,
		message: null,
		createdAt: Date.now()
	};
	snapshot.actions = [action];
	const screen = await render(ActionNotices, { snapshot, userId: 'operator' });
	await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
	const failed = {
		...snapshot,
		actions: [{ ...action, status: 'failed' as const, message: 'Printer rejected target.' }]
	};
	await screen.rerender({ snapshot: failed });
	await expect.element(screen.getByText('Printer rejected target.', { exact: true })).toBeVisible();
	await screen.getByRole('button', { name: 'Dismiss failure notice' }).click();
	await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
	await screen.unmount();
	const next = await render(ActionNotices, { snapshot: failed, userId: 'operator' });
	await expect.element(next.getByRole('alert')).not.toBeInTheDocument();
	await next.rerender({
		snapshot: { ...failed, actions: [{ ...failed.actions[0]!, id: 'next' }] }
	});
	await expect.element(next.getByRole('alert')).toBeVisible();
	actionNotices.dismissed = [];
});

test('dismissal survives a fresh document state and stays scoped to its account', async () => {
	const snapshot = initialSnapshot();
	snapshot.actions = [
		{
			id: crypto.randomUUID(),
			label: 'Restore mesh',
			status: 'failed',
			message: 'Old failure',
			createdAt: Date.now()
		}
	];
	const userId = crypto.randomUUID();
	const first = await render(ActionNotices, { snapshot, userId });
	await first.getByRole('button', { name: 'Dismiss failure notice' }).click();
	await expect.element(first.getByRole('alert')).not.toBeInTheDocument();
	await first.unmount();
	// A full navigation starts a new module instance, losing its in-memory state.
	actionNotices.user = null;
	actionNotices.dismissed = [];
	const next = await render(ActionNotices, { snapshot, userId });
	await expect.element(next.getByRole('alert')).not.toBeInTheDocument();
	await next.rerender({ userId: crypto.randomUUID() });
	await expect.element(next.getByRole('alert')).toBeVisible();
	await next.rerender({ userId });
	await expect.element(next.getByRole('alert')).not.toBeInTheDocument();
	sessionStorage.removeItem(`perilune:failure-dismissals:${userId}`);
	actionNotices.user = null;
	actionNotices.dismissed = [];
});
