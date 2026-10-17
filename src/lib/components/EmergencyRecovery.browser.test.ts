import { expect, test } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import { initialSnapshot } from '#lib/domain/printer.js';
import EmergencyRecovery from './EmergencyRecovery.svelte';

test('inspection is part of restart submission, with offline and readiness gating', async () => {
	const snapshot = initialSnapshot();
	snapshot.connection = 'disconnected';
	snapshot.klippy = 'shutdown';
	snapshot.telemetryReady = false;
	snapshot.safety = {
		enabled: true,
		halted: true,
		actions: [],
		recovery: { token: crypto.randomUUID(), reviewedAt: null, restartId: null }
	};
	const screen = await render(EmergencyRecovery, { snapshot });
	await expect
		.element(screen.getByRole('button', { name: 'Save hazard review' }))
		.not.toBeInTheDocument();
	await expect
		.element(screen.getByRole('button', { name: 'Restart firmware', exact: true }))
		.toBeDisabled();
	await expect
		.element(screen.getByRole('button', { name: 'Verify readiness & unlock' }))
		.toBeDisabled();
	await screen.rerender({
		snapshot: {
			...snapshot,
			safety: {
				...snapshot.safety,
				recovery: { ...snapshot.safety.recovery!, reviewedAt: Date.now() }
			}
		}
	});
	await expect
		.element(screen.getByRole('button', { name: 'Restart firmware', exact: true }))
		.toBeDisabled();
	await screen.rerender({
		snapshot: {
			...snapshot,
			connection: 'connected',
			safety: {
				...snapshot.safety,
				recovery: { ...snapshot.safety.recovery!, reviewedAt: null }
			}
		}
	});
	await expect
		.element(screen.getByRole('button', { name: 'Restart firmware', exact: true }))
		.toBeEnabled();
	await expect
		.element(screen.getByRole('button', { name: 'Verify readiness & unlock' }))
		.toBeDisabled();
});

test('externally restarted firmware requires inspection before read-only verification', async () => {
	const snapshot = initialSnapshot();
	snapshot.connection = 'connected';
	snapshot.klippy = 'ready';
	snapshot.telemetryReady = true;
	snapshot.safety = {
		enabled: true,
		halted: true,
		actions: [],
		recovery: { token: crypto.randomUUID(), reviewedAt: null, restartId: null }
	};
	const screen = await render(EmergencyRecovery, { snapshot });
	const inspection = screen.getByRole('checkbox', {
		name: 'I have inspected the printer and resolved the hazard before unlocking controls',
		exact: true
	});
	await expect.element(inspection).toBeRequired();
	await expect.element(inspection).not.toBeChecked();
	await expect
		.element(screen.getByRole('button', { name: 'Restart firmware', exact: true }))
		.toBeDisabled();
	await expect
		.element(screen.getByRole('button', { name: 'Verify readiness & unlock' }))
		.toBeEnabled();
	await inspection.click();
	await expect.element(inspection).toBeChecked();
});
