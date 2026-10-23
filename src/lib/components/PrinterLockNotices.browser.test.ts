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

test('mesh progress follows reported samples, survives stale telemetry and becomes review without a bar', async () => {
	const snapshot = initialSnapshot();
	snapshot.meshProbe.session = {
		id: 'mesh',
		ownerId: 'owner',
		ownerName: 'Owner',
		stage: 'probing',
		result: null,
		completedSamples: 7,
		startedAt: 0,
		expiresAt: 1,
		message: null
	};
	const screen = await render(PrinterLockNotices, { snapshot, role: 'viewer' });
	await expect
		.element(screen.getByRole('progressbar', { name: 'Bed-mesh samples' }))
		.toHaveAttribute('value', '7');
	await expect
		.element(screen.getByText('Mapping the bed · 7 of 25 samples reported', { exact: true }))
		.toBeVisible();
	await screen.rerender({ snapshot: { ...snapshot, telemetryReady: false } });
	await expect.element(screen.getByText(/Showing the last reported workflow state/)).toBeVisible();
	await expect.element(screen.getByRole('progressbar')).toHaveAttribute('value', '7');
	await screen.rerender({
		snapshot: {
			...snapshot,
			meshProbe: {
				...snapshot.meshProbe,
				session: { ...snapshot.meshProbe.session!, stage: 'review' }
			}
		}
	});
	await expect.element(screen.getByRole('progressbar')).not.toBeInTheDocument();
	await expect.element(screen.getByText(/Review the result and choose/)).toBeVisible();
});

test('live workflows without measured progress do not invent percentages', async () => {
	const snapshot = initialSnapshot();
	snapshot.mode = 'moonraker';
	snapshot.pid = {
		enabled: true,
		run: {
			id: 'pid',
			ownerId: 'owner',
			heater: 'bed',
			target: 60,
			startedAt: 0,
			stage: 'running',
			parameters: null,
			message: null
		}
	};
	const screen = await render(PrinterLockNotices, { snapshot, role: 'owner' });
	await expect.element(screen.getByText(/Tuning bed at 60°C/)).toBeVisible();
	await expect.element(screen.getByRole('progressbar')).not.toBeInTheDocument();
	await screen.rerender({
		snapshot: {
			...snapshot,
			pid: { enabled: true, run: null },
			extrusion: {
				session: {
					id: 'extrusion',
					ownerId: 'owner',
					ownerName: 'Owner',
					stage: 'extruding',
					distance: 50,
					completed: 20,
					rotationDistance: 1,
					before: 100,
					proposal: null,
					expiresAt: 1,
					message: null
				}
			}
		}
	});
	await expect.element(screen.getByText(/Waiting for the printer’s acknowledgement/)).toBeVisible();
	await expect.element(screen.getByRole('progressbar')).not.toBeInTheDocument();
});
