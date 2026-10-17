import { expect, test } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import { initialSnapshot } from '#lib/domain/printer.js';
import EmergencyRecovery from './EmergencyRecovery.svelte';

test('hazard review stays available offline while restart and unlock remain separate gated actions', async () => {
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
	await expect.element(screen.getByRole('button', { name: 'Save hazard review' })).toBeEnabled();
	await expect
		.element(screen.getByRole('button', { name: 'Restart firmware', exact: true }))
		.not.toBeInTheDocument();
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
				recovery: { ...snapshot.safety.recovery!, reviewedAt: Date.now() }
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
