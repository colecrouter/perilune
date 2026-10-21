import { afterEach, expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import BrowserPairing from './BrowserPairing.svelte';
vi.mock('../../routes/account/integrations.remote.js', () => ({
	getIntegrations: vi.fn(async () => ({ keys: [], browsers: [], host: 'http://localhost' }))
}));
afterEach(() => vi.unstubAllGlobals());

test('inspection displays requesting browser but never grants access without approval', async () => {
	const fetcher = vi.fn(async (_url: string) =>
		Response.json({ request: { name: 'Living room slicer', expires: Date.now() + 300000 } })
	);
	vi.stubGlobal('fetch', fetcher);
	const screen = await render(BrowserPairing, { approve: true, signedIn: true });
	expect(fetcher).not.toHaveBeenCalled();
	await screen.getByRole('textbox', { name: 'Pairing code' }).fill('ABCDE-FGHIJ');
	await screen.getByRole('button', { name: 'Check code' }).click();
	await expect.element(screen.getByRole('heading', { name: 'Living room slicer' })).toBeVisible();
	expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/approve'))).toHaveLength(0);
	await screen.getByRole('button', { name: 'Deny', exact: true }).click();
	await expect.element(screen.getByRole('status')).toHaveTextContent('Pairing denied.');
	const approval = fetcher.mock.calls.filter(([url]) => url.endsWith('/approve'));
	expect(approval).toHaveLength(1);
	expect(
		JSON.parse((approval[0] as unknown as [string, RequestInit])[1].body as string)
	).toMatchObject({ approve: false, code: 'ABCDEFGHIJ' });
});
