import { afterEach, expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import SlicerKeySecret from './SlicerKeySecret.svelte';
afterEach(() => vi.restoreAllMocks());

test('copy confirms beside the key and preserves button width', async () => {
	const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
	const screen = await render(SlicerKeySecret, { value: 'synthetic-key', onDismiss: vi.fn() });
	const copy = screen.getByRole('button', { name: 'Copy key', exact: true });
	const width = copy.element().getBoundingClientRect().width;
	await copy.click();
	await expect.element(screen.getByRole('status')).toHaveTextContent('Key copied to clipboard.');
	expect(write).toHaveBeenCalledWith('synthetic-key');
	expect(
		screen.getByRole('button', { name: 'Copied', exact: true }).element().getBoundingClientRect()
			.width
	).toBe(width);
});

test('clipboard failure offers manual copying and reveal remains usable', async () => {
	vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Denied'));
	const dismiss = vi.fn();
	const screen = await render(SlicerKeySecret, { value: 'synthetic-key', onDismiss: dismiss });
	await screen.getByRole('button', { name: 'Copy key', exact: true }).click();
	await expect
		.element(screen.getByRole('status'))
		.toHaveTextContent('Could not copy. Reveal the key and select it to copy manually.');
	await screen.getByRole('button', { name: 'Reveal key' }).click();
	await expect
		.element(screen.getByRole('textbox', { name: 'New slicer key' }))
		.toHaveValue('synthetic-key');
	await screen.getByRole('button', { name: 'Dismiss key' }).click();
	expect(dismiss).toHaveBeenCalledOnce();
});
