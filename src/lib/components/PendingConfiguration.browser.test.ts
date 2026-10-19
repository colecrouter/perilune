import { afterEach, expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import PendingConfiguration from './PendingConfiguration.svelte';
const review = {
	path: 'printer.cfg',
	fingerprint: 'pending-fingerprint',
	sources: { root: 'printer.cfg', fingerprint: 'source-fingerprint' },
	manifest: {
		extruder: { pid_Kp: '20', pid_Ki: '1.2', pid_Kd: '80' },
		bltouch: { z_offset: '1.5' }
	}
};
afterEach(() => vi.unstubAllGlobals());
test('opens every pending setting automatically and requires a separate confirmation to save once', async () => {
	const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
		Response.json(init?.method === 'POST' ? { ok: true } : review)
	);
	vi.stubGlobal('fetch', fetcher);
	const screen = await render(PendingConfiguration, { autoInspect: true });
	await expect.element(screen.getByText('[extruder] pid_Kp')).toBeVisible();
	await expect.element(screen.getByText('[bltouch] z_offset')).toBeVisible();
	expect(fetcher.mock.calls).toHaveLength(1);
	expect(fetcher.mock.calls[0]![1]?.method).toBeUndefined();
	const save = screen.getByRole('button', { name: 'Save settings & restart' });
	await expect.element(save).toBeDisabled();
	await screen.getByRole('checkbox').click();
	await save.click();
	await expect.element(save).toBeDisabled();
	const submitted = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
	expect(submitted).toHaveLength(1);
	expect(JSON.parse(submitted[0]![1]!.body as string)).toMatchObject({
		action: 'savePending',
		pending: review.fingerprint,
		sources: review.sources,
		confirmedRestart: true
	});
});
test('shows disabled saving explicitly and never offers a hidden or automatic save', async () => {
	const fetcher = vi.fn(async () =>
		Response.json(
			{ message: 'Saving printer settings is disabled on this server.' },
			{ status: 400 }
		)
	);
	vi.stubGlobal('fetch', fetcher);
	const screen = await render(PendingConfiguration, { autoInspect: true, saveEnabled: false });
	await expect
		.element(screen.getByRole('alert'))
		.toHaveTextContent('Saving printer settings is disabled on this server.');
	await expect.element(screen.getByRole('button', { name: 'Try reviewing again' })).toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Save settings & restart' }))
		.not.toBeInTheDocument();
	expect(fetcher.mock.calls).toHaveLength(1);
});
test('cannot save a loaded review while configuration recovery disallows writes', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json(review))
	);
	const screen = await render(PendingConfiguration, { autoInspect: true, saveEnabled: false });
	await expect.element(screen.getByRole('checkbox')).toBeDisabled();
	await expect
		.element(screen.getByRole('button', { name: 'Save settings & restart' }))
		.toBeDisabled();
	await expect.element(screen.getByText(/Saving is currently unavailable/)).toBeVisible();
});
