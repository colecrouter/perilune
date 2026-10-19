import { expect, test } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import PrinterLockNotices from './PrinterLockNotices.svelte';
import { initialSnapshot } from '#lib/domain/printer.js';
test('shows persistent workflow recovery and updates without a dismiss or unsafe clear action', async () => {
	const snapshot = initialSnapshot();
	snapshot.meshProbe.session = {
		id: 'mesh',
		ownerId: 'owner',
		ownerName: 'Owner',
		stage: 'uncertain',
		result: null,
		completedSamples: 0,
		startedAt: 0,
		expiresAt: 1,
		message: null
	};
	const screen = await render(PrinterLockNotices, { snapshot, role: 'owner' });
	await expect
		.element(screen.getByText('Bed-mesh recovery needs attention', { exact: true }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('link', { name: 'Review bed mesh →' }))
		.toHaveAttribute('href', '/calibration/mesh');
	await expect.element(screen.getByRole('button')).not.toBeInTheDocument();
	await screen.rerender({
		snapshot: {
			...snapshot,
			meshProbe: {
				...snapshot.meshProbe,
				session: { ...snapshot.meshProbe.session!, stage: 'probing' }
			}
		}
	});
	await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
	await expect
		.element(screen.getByText('Bed-mesh calibration in progress', { exact: true }))
		.toBeVisible();
	await screen.rerender({ snapshot: initialSnapshot() });
	await expect
		.element(screen.getByRole('region', { name: 'Printer workflow status' }))
		.not.toBeInTheDocument();
});
test('leaves existing emergency/recovery notices in charge and directs configuration issues to owners', async () => {
	const snapshot = initialSnapshot();
	snapshot.configurationBusy = true;
	const screen = await render(PrinterLockNotices, { snapshot, role: 'operator' });
	await expect.element(screen.getByRole('status')).toBeVisible();
	await expect.element(screen.getByRole('link')).not.toBeInTheDocument();
	await screen.rerender({ snapshot, role: 'owner' });
	await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
	await screen.rerender({
		snapshot: { ...snapshot, liveRecovery: { id: 'action', message: 'Check' } },
		role: 'operator'
	});
	await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
});

test('does not send viewers to operator-only activity recovery', async () => {
	const snapshot = initialSnapshot();
	snapshot.storage = 'degraded';
	const screen = await render(PrinterLockNotices, { snapshot, role: 'viewer' });
	await expect.element(screen.getByRole('link')).not.toBeInTheDocument();
	await expect
		.element(screen.getByText('Ask an operator or owner to review this issue.', { exact: true }))
		.toBeVisible();
	await screen.rerender({ snapshot, role: 'operator' });
	await expect
		.element(screen.getByRole('link', { name: 'Review activity →' }))
		.toHaveAttribute('href', '/activity');
});
