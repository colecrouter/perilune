vi.mock('../../routes/configuration/configuration.remote.js', () => ({
	getConfigurationRecovery: () =>
		Object.assign(
			fetch('/recovery').then((r) => r.json()),
			{ refresh: async () => {} }
		),
	reviewPendingConfiguration: () =>
		Object.assign(
			fetch('/review').then((r) => r.json()),
			{ refresh: async () => {} }
		),
	applyConfiguration: async (body: unknown) =>
		(await fetch('/apply', { method: 'POST', body: JSON.stringify(body) })).json(),
	getConfigurationSnapshot: async () => ''
}));
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import PendingSettingsDialog from './PendingSettingsDialog.svelte';
import type { ConfigRecovery } from '#lib/domain/config-application.js';
const review = {
	path: 'printer.cfg',
	fingerprint: 'pending',
	sources: { root: 'printer.cfg', fingerprint: 'source' },
	manifest: { bltouch: { z_offset: '1.549' } }
};
function ready(
	id: string,
	mode: 'calibration' | 'discard',
	phase: 'ready' | 'unknown' | 'restarting' = 'ready'
): ConfigRecovery {
	return {
		enabled: true,
		discardEnabled: true,
		application: {
			id,
			path: 'printer.cfg',
			mode,
			phase,
			message: 'Result',
			diagnostic: null,
			createdAt: 1,
			updatedAt: 2,
			writeVerified: mode === 'calibration',
			revertOf: null
		}
	};
}
afterEach(() => vi.unstubAllGlobals());
test('loading skeleton reserves the same body height as the loaded settings', async () => {
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url === '/review') {
				await held;
				return Response.json(review);
			}
			return Response.json({ enabled: true, application: null });
		})
	);
	const screen = await render(PendingSettingsDialog, { open: true });
	await expect
		.element(screen.getByRole('status', { name: 'Loading pending settings' }))
		.toBeVisible();
	const height = document.querySelector('.pending-dialog-body')!.getBoundingClientRect().height;
	release();
	await expect.element(screen.getByText('[bltouch] z_offset')).toBeVisible();
	expect(document.querySelector('.pending-dialog-body')!.getBoundingClientRect().height).toBe(
		height
	);
	await expect
		.element(screen.getByRole('button', { name: 'Save settings & restart' }))
		.toBeDisabled();
});
test.each(['save', 'discard'] as const)(
	'closes %s only after its own operation is verified ready',
	async (mode) => {
		let recovery = ready('previous-operation', 'calibration');
		let submitted: string | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				if (url === '/review') return Response.json(review);
				if (url === '/apply') {
					submitted = JSON.parse(init!.body as string).id;
					return Response.json({ ok: true });
				}
				return Response.json(recovery);
			})
		);
		const onComplete = vi.fn();
		const screen = await render(PendingSettingsDialog, { open: true, mode, onComplete });
		await expect.element(screen.getByText('[bltouch] z_offset')).toBeVisible();
		await expect
			.element(screen.getByRole('heading', { name: 'Configuration startup verified' }))
			.not.toBeInTheDocument();
		await screen.getByRole('checkbox').click();
		await screen
			.getByRole('button', {
				name: mode === 'save' ? 'Save settings & restart' : 'Discard settings & restart'
			})
			.click();
		expect(submitted).toBeTypeOf('string');
		expect(onComplete).not.toHaveBeenCalled();
		recovery = ready(submitted!, mode === 'save' ? 'calibration' : 'discard', 'restarting');
		await expect
			.element(
				screen.getByRole('heading', {
					name: mode === 'save' ? 'Applying configuration' : 'Discarding pending settings'
				}),
				{ timeout: 5000 }
			)
			.toBeVisible();
		expect(onComplete).not.toHaveBeenCalled();
		recovery = ready(submitted!, mode === 'save' ? 'calibration' : 'discard');
		await expect.poll(() => onComplete.mock.calls.length, { timeout: 5000 }).toBe(1);
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
	},
	15000
);
test('unknown operation keeps the dialog and recovery controls open', async () => {
	let recovery: ConfigRecovery = { enabled: true, application: null };
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			if (url === '/review') return Response.json(review);
			if (url === '/apply') {
				recovery = ready(JSON.parse(init!.body as string).id, 'calibration', 'unknown');
				return Response.json({ ok: true });
			}
			return Response.json(recovery);
		})
	);
	const onComplete = vi.fn();
	const screen = await render(PendingSettingsDialog, { open: true, onComplete });
	await screen.getByRole('checkbox').click();
	await screen.getByRole('button', { name: 'Save settings & restart' }).click();
	await expect
		.element(screen.getByRole('heading', { name: 'Configuration needs attention' }), {
			timeout: 5000
		})
		.toBeVisible();
	expect(onComplete).not.toHaveBeenCalled();
	await expect.element(screen.getByRole('dialog')).toBeVisible();
});
