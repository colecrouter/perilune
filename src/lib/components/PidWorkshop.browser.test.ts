import { afterEach, expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import PidWorkshop from './PidWorkshop.svelte';
import { initialSnapshot } from '#lib/domain/printer.js';
afterEach(() => vi.unstubAllGlobals());
const ready = () => {
	const s = initialSnapshot();
	s.job.state = 'standby';
	s.heaters = { nozzle: { current: 25, target: 0 }, bed: { current: 25, target: 0 } };
	return s;
};
test('preserves target and attendance during reconnect and resets attendance when the target changes', async () => {
	const snapshot = ready();
	const screen = await render(PidWorkshop, { snapshot, role: 'owner' });
	const button = screen.getByRole('button', { name: 'Run simulator calibration' });
	await expect.element(button).toBeDisabled();
	await screen.getByRole('spinbutton').fill('210');
	await screen.getByRole('checkbox').click();
	await expect.element(button).toBeEnabled();
	await screen.rerender({
		snapshot: { ...snapshot, connection: 'disconnected' },
		connected: false,
		role: 'owner'
	});
	await expect.element(button).toBeDisabled();
	await expect.element(screen.getByRole('spinbutton')).toHaveValue(210);
	await expect.element(screen.getByRole('checkbox')).toBeChecked();
	await screen.rerender({ snapshot, connected: true, role: 'owner' });
	await expect.element(button).toBeEnabled();
	await screen.getByRole('spinbutton').fill('220');
	await expect.element(screen.getByRole('checkbox')).not.toBeChecked();
	await expect.element(button).toBeDisabled();
});
test('keeps calibration disabled for viewers and makes synthetic results explicit', async () => {
	const snapshot = ready();
	snapshot.pid!.run = {
		id: 'example',
		ownerId: 'owner',
		heater: 'nozzle',
		target: 200,
		startedAt: Date.now(),
		stage: 'staged',
		parameters: { kp: 20, ki: 1.2, kd: 80 },
		message: 'Simulator example only.'
	};
	const screen = await render(PidWorkshop, { snapshot, role: 'viewer' });
	await expect.element(screen.getByRole('checkbox')).toBeDisabled();
	await expect
		.element(screen.getByRole('button', { name: 'Run simulator calibration' }))
		.toBeDisabled();
	await expect.element(screen.getByRole('heading', { name: 'Example result' })).toBeVisible();
	await expect
		.element(screen.getByRole('link', { name: /Review pending settings/ }))
		.not.toBeInTheDocument();
});

const liveResult = () => {
	const snapshot = ready();
	snapshot.mode = 'moonraker';
	snapshot.pid!.run = {
		id: 'live-result',
		ownerId: 'owner',
		heater: 'nozzle',
		target: 200,
		startedAt: Date.now(),
		stage: 'staged',
		parameters: { kp: 20, ki: 1.2, kd: 80 },
		message: 'Staged and unsaved.'
	};
	return snapshot;
};
const review = {
	path: 'printer.cfg',
	fingerprint: 'pending',
	sources: { root: 'printer.cfg', fingerprint: 'sources' },
	manifest: { extruder: { pid_Kp: '20' }, probe: { z_offset: '1.5' } }
};
test('opens save review inline and closing it leaves staged gains untouched', async () => {
	const fetcher = vi.fn(async (url: string, _init?: RequestInit) =>
		Response.json(
			url.endsWith('?pending') ? review : { enabled: true, discardEnabled: true, application: null }
		)
	);
	vi.stubGlobal('fetch', fetcher);
	const screen = await render(PidWorkshop, { snapshot: liveResult(), role: 'owner' });
	await screen.getByRole('button', { name: 'Save…', exact: true }).click();
	const dialog = screen.getByRole('dialog');
	await expect
		.element(dialog.getByRole('heading', { name: 'Save pending settings?' }))
		.toBeVisible();
	await expect.element(dialog.getByText('[probe] z_offset')).toBeVisible();
	await expect
		.element(dialog.getByRole('button', { name: 'Save settings & restart' }))
		.toBeDisabled();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect
		.element(screen.getByRole('heading', { name: 'Review the proposed PID settings' }))
		.toBeVisible();
	expect(fetcher.mock.calls.every(([, init]) => !(init as RequestInit | undefined)?.method)).toBe(
		true
	);
});
test('discards through a separate confirmed inline action even when saving is disabled', async () => {
	const fetcher = vi.fn(async (url: string, init?: RequestInit) =>
		Response.json(
			init?.method === 'POST'
				? { ok: true }
				: url.endsWith('?pending')
					? review
					: { enabled: false, discardEnabled: true, application: null }
		)
	);
	vi.stubGlobal('fetch', fetcher);
	const screen = await render(PidWorkshop, { snapshot: liveResult(), role: 'owner' });
	await screen.getByRole('button', { name: 'Discard…', exact: true }).click();
	const dialog = screen.getByRole('dialog');
	await expect
		.element(dialog.getByRole('heading', { name: 'Discard pending settings?' }))
		.toBeVisible();
	await expect.element(dialog.getByText(/Your saved settings stay unchanged/)).toBeVisible();
	const discard = dialog.getByRole('button', { name: 'Discard settings & restart' });
	await expect.element(discard).toBeDisabled();
	await expect.element(dialog.getByRole('checkbox')).toBeEnabled();
	await dialog.getByRole('checkbox').click();
	await discard.click();
	await expect.element(discard).toBeDisabled();
	const submissions = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
	expect(submissions).toHaveLength(1);
	expect(JSON.parse(submissions[0]![1]!.body as string)).toMatchObject({
		action: 'discardPending',
		pending: review.fingerprint,
		confirmedRestart: true
	});
});
