vi.mock('../../routes/access.remote.js', () => ({ accountEntry: vi.fn() }));
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import AccountEntry from './AccountEntry.svelte';
import { goto } from '$app/navigation';

vi.mock('#lib/client/auth.js', () => ({ authClient: {} }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
afterEach(() => {
	history.replaceState(null, '', '/');
	vi.clearAllMocks();
});

test('keeps owner setup focused on creating the account', async () => {
	const screen = await render(AccountEntry, { mode: 'setup' });
	await expect.element(screen.getByRole('button', { name: 'Create account' })).toBeVisible();
	await expect.element(screen.getByRole('textbox', { name: 'Setup token' })).toBeVisible();
	await expect
		.element(screen.getByRole('link', { name: 'Sign in with another browser' }))
		.not.toBeInTheDocument();
});

test('shows account creation confirmation and keeps server recovery behind help', async () => {
	history.replaceState(null, '', '/login?created=1');
	const screen = await render(AccountEntry, { mode: 'login' });
	await expect
		.element(screen.getByRole('alert'))
		.toHaveTextContent('Account created. Sign in to continue.');
	await expect
		.element(screen.getByText('Hosting this installation?', { exact: false }))
		.not.toBeVisible();
	await screen.getByText('Need help signing in?', { exact: true }).click();
	await expect
		.element(screen.getByText('Hosting this installation?', { exact: false }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('link', { name: 'Sign in with another browser' }))
		.toBeVisible();
});

for (const [url, destination] of [
	['/login', '/'],
	['/login?next=pair', '/pair']
] as const) {
	test(`returns a signed-in visitor from ${url} to ${destination}`, async () => {
		history.replaceState(null, '', url);
		await render(AccountEntry, { mode: 'login', signedIn: true });
		expect(goto).toHaveBeenCalledWith(destination, { replaceState: true });
	});
}
test('keeps fragment recovery available even when a session is already signed in', async () => {
	history.replaceState(null, '', '/login?next=pair#reset=fixture-recovery-token');
	const screen = await render(AccountEntry, { mode: 'login', signedIn: true });
	await expect.element(screen.getByRole('heading', { name: 'Recover your account' })).toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Update password' })).toBeVisible();
	expect(goto).not.toHaveBeenCalled();
	expect(location.hash).toBe('');
});
