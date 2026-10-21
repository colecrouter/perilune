vi.mock('../../routes/configuration/configuration.remote.js', () => ({
	getConfigurationRecovery: () => {
		const result = fetch('/recovery-fixture').then((r) => r.json());
		return Object.assign(result, { refresh: async () => {} });
	},
	applyConfiguration: async (body: Record<string, unknown>) => {
		const response = await fetch('/recovery-fixture', {
			method: 'POST',
			body: JSON.stringify(body)
		});
		if (!response.ok) throw Error('Recovery request failed.');
		return response.json();
	},
	getConfigurationSnapshot: async () => ''
}));
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import ConfigurationRecovery from './ConfigurationRecovery.svelte';
import type { ConfigApplication } from '#lib/domain/config-application.js';
const application: ConfigApplication = {
	id: 'fixture',
	path: 'printer.cfg',
	mode: 'apply',
	phase: 'error',
	message: 'File saved, but Klipper reported an error.',
	diagnostic: "Option 'bad' is not valid in section 'printer'",
	createdAt: 1,
	updatedAt: 2,
	writeVerified: true,
	revertOf: null
};
afterEach(() => vi.unstubAllGlobals());
test('persistent recovery shows complete diagnostic and requires restart confirmation before revert', async () => {
	const fetcher = vi
		.fn()
		.mockImplementation(async () => Response.json({ enabled: true, application }));
	vi.stubGlobal('fetch', fetcher);
	const screen = await render(ConfigurationRecovery);
	await expect
		.element(screen.getByRole('heading', { name: 'Configuration needs attention' }))
		.toBeVisible();
	await expect
		.element(screen.getByLabelText('Klipper startup diagnostic'))
		.toHaveTextContent(application.diagnostic!);
	await expect
		.element(screen.getByRole('button', { name: 'Revert changes and restart' }))
		.toBeDisabled();
	await screen.getByRole('checkbox').click();
	await screen.getByRole('button', { name: 'Revert changes and restart' }).click();
	expect(
		fetcher.mock.calls.some(
			([, init]) => init?.method === 'POST' && JSON.parse(init.body).revertOf === application.id
		)
	).toBe(true);
});
test('unknown outcomes offer checking and exports without an unverified revert', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			Response.json({
				enabled: true,
				application: { ...application, phase: 'unknown', writeVerified: false }
			})
		)
	);
	const screen = await render(ConfigurationRecovery);
	await expect
		.element(screen.getByRole('button', { name: 'Check printer and saved settings' }))
		.toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Export previous file' })).toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Revert changes and restart' }))
		.not.toBeInTheDocument();
	await screen.unmount();
});

test('verified startup keeps optional recovery controls disclosed while retaining explicit restore', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			Response.json({
				enabled: true,
				application: { ...application, phase: 'ready', diagnostic: null }
			})
		)
	);
	const screen = await render(ConfigurationRecovery);
	await expect
		.element(screen.getByRole('heading', { name: 'Configuration startup verified' }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Check printer and saved settings' }))
		.not.toBeInTheDocument();
	await screen.getByText('Saved files & recovery', { exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Revert changes and restart' }))
		.toBeDisabled();
	await expect.element(screen.getByRole('button', { name: 'Export reviewed file' })).toBeVisible();
});
