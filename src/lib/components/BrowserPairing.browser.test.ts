vi.mock('../../routes/pairing.remote.js', () => ({
	pairBrowser: vi.fn(async ({ operation, ...body }) => {
		const response = await fetch('/pairing-fixture/' + operation, {
			method: 'POST',
			body: JSON.stringify(body)
		});
		const result = await response.json();
		if (!response.ok) {
			const { error } = await import('@sveltejs/kit');
			error(response.status, result.message, { retryAfter: result.retryAfter });
		}
		return result;
	})
}));
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

test('rate limits explain the cooldown and recover without reload or moving the form', async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(Response.json({ message: 'Slow down', retryAfter: 1 }, { status: 429 }))
		.mockResolvedValueOnce(
			Response.json({ request: { name: 'Recovered browser', expires: Date.now() + 300000 } })
		);
	vi.stubGlobal('fetch', fetcher);
	const screen = await render(BrowserPairing, { approve: true, signedIn: true });
	const code = screen.getByRole('textbox', { name: 'Pairing code' });
	await code.fill('ABCDE-FGHIJ');
	const before = code.element().getBoundingClientRect().top;
	const check = screen.getByRole('button', { name: 'Check code' });
	await check.click();
	await expect
		.element(screen.getByRole('status'))
		.toHaveTextContent('Too many pairing attempts. Try again in 1s.');
	await expect.element(check).toBeDisabled();
	expect(code.element().getBoundingClientRect().top).toBe(before);
	await expect.element(check).toBeEnabled();
	await check.click();
	await expect.element(screen.getByRole('heading', { name: 'Recovered browser' })).toBeVisible();
	expect(code.element().getBoundingClientRect().top).toBe(before);
});
