import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import { initialSnapshot } from '#lib/domain/printer.js';
import { printActionJournal } from '#lib/client/print-action-journal.svelte.js';
import PrintRecovery from './PrintRecovery.svelte';
const state = vi.hoisted(() => ({ data: { user: { id: 'owner', role: 'owner' } } }));
vi.mock('$app/state', () => ({ page: state }));
vi.mock('../../routes/printer.remote.js', () => ({
	recoverLiveAction: vi.fn(async () => {}),
	reconcilePrintAction: vi.fn(async ({ id }) => ({
		id,
		label: 'Resume print',
		status: 'failed',
		createdAt: Date.now(),
		message: 'Not accepted'
	}))
}));
beforeEach(() => {
	localStorage.clear();
	printActionJournal.activate('owner');
	printActionJournal.refresh();
});
test('resolved printer recovery still exposes browser submission correction before returning to jobs', async () => {
	const snapshot = initialSnapshot();
	snapshot.connection = 'connected';
	snapshot.klippy = 'ready';
	snapshot.telemetryReady = true;
	snapshot.motion.busy = false;
	snapshot.liveRecovery = { id: crypto.randomUUID(), message: 'Unknown outcome' };
	const id = crypto.randomUUID();
	printActionJournal.begin('owner', id, 'Resume print');
	const screen = await render(PrintRecovery, { snapshot });
	await expect
		.element(screen.getByRole('button', { name: 'Printer checked · unlock controls' }))
		.toBeVisible();
	await screen.rerender({ snapshot: { ...snapshot, liveRecovery: null } });
	await expect
		.element(screen.getByRole('heading', { name: 'Resolve the pending print submission' }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('link', { name: 'Return to jobs' }))
		.not.toBeInTheDocument();
	await screen.getByRole('button', { name: 'Check submission outcome' }).click();
	await expect
		.element(screen.getByRole('heading', { name: 'Print recovery is resolved' }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('link', { name: 'Return to jobs' }))
		.toHaveAttribute('href', '/jobs');
});
test('safety-only uncertainty offers heater correction and never reports recovery complete', async () => {
	const snapshot = initialSnapshot();
	snapshot.safety = {
		enabled: true,
		halted: false,
		actions: [
			{
				id: crypto.randomUUID(),
				label: 'Turn off heaters',
				kind: 'cooldown',
				acknowledged: false,
				observed: false,
				reviewedAt: null,
				status: 'unknown',
				createdAt: Date.now(),
				message: null
			}
		]
	};
	const screen = await render(PrintRecovery, { snapshot });
	await expect
		.element(screen.getByRole('link', { name: 'Turn off heaters', exact: true }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('link', { name: 'Confirm printer is safe', exact: true }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('heading', { name: 'Print recovery is resolved' }))
		.not.toBeInTheDocument();
});

test('pending safety operation keeps completion hidden', async () => {
	const snapshot = initialSnapshot();
	snapshot.safety = {
		enabled: true,
		halted: false,
		actions: [
			{
				id: crypto.randomUUID(),
				kind: 'cooldown',
				acknowledged: false,
				observed: false,
				reviewedAt: null,
				label: 'Turn off heaters',
				status: 'queued',
				createdAt: Date.now(),
				message: null
			}
		]
	};
	const screen = await render(PrintRecovery, { snapshot });
	await expect
		.element(screen.getByRole('heading', { name: 'Print recovery is resolved' }))
		.not.toBeInTheDocument();
	await expect
		.element(screen.getByRole('status'))
		.toHaveTextContent('A printer action is still running. Its result will appear here.');
});
