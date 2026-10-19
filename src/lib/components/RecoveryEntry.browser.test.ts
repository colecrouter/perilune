import { afterEach, expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import RecoveryEntry from './RecoveryEntry.svelte';
afterEach(() => {
	history.replaceState(null, '', '/');
	vi.unstubAllGlobals();
});
test('explains recovery without SMTP rather than presenting a dead email form', async () => {
	const screen = await render(RecoveryEntry, { mode: 'forgot', enabled: false });
	await expect
		.element(screen.getByText('Email recovery is not configured', { exact: false }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Send reset link' }))
		.not.toBeInTheDocument();
});
test('a delayed response for an earlier token cannot clear a newer email link', async () => {
	const first = 'a'.repeat(43),
		second = 'b'.repeat(43);
	history.replaceState(null, '', '/forgot-password#' + first);
	let finish!: (response: Response) => void;
	const fetch = vi.fn(() => new Promise<Response>((r) => (finish = r)));
	vi.stubGlobal('fetch', fetch);
	const screen = await render(RecoveryEntry, { mode: 'forgot', enabled: true });
	await screen.getByLabelText('New password', { exact: true }).fill('replacement-password');
	await screen.getByLabelText('Confirm new password', { exact: true }).fill('replacement-password');
	await screen.getByRole('button', { name: 'Update password' }).click();
	location.hash = second;
	await expect.element(screen.getByLabelText('New password', { exact: true })).toHaveValue('');
	finish(Response.json({ message: 'Password updated.' }));
	await expect.element(screen.getByRole('button', { name: 'Update password' })).toBeEnabled();
	await expect.element(screen.getByLabelText('New password', { exact: true })).toBeVisible();
});
