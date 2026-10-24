vi.mock('../../routes/configuration/configuration.remote.js', () => ({
	getConfigurationRecovery: () =>
		Object.assign(Promise.resolve({ enabled: false, application: null }), {
			refresh: async () => {}
		}),
	reviewPendingConfiguration: () =>
		Object.assign(Promise.resolve(null), { refresh: async () => {} }),
	applyConfiguration: vi.fn(),
	getConfigurationSnapshot: vi.fn()
}));
import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import LiveZCalibration from './LiveZCalibration.svelte';
import { initialSnapshot, type PrinterSnapshot } from '#lib/domain/printer.js';
const run = crypto.randomUUID();
function state(): PrinterSnapshot {
	return {
		...initialSnapshot(),
		mode: 'moonraker',
		liveControls: true,
		liveZEnabled: true,
		job: { ...initialSnapshot().job, state: 'cancelled' },
		heaters: { bed: { current: 25, target: 0 }, nozzle: { current: 25, target: 0 } },
		zProbe: {
			method: 'probe',
			active: true,
			z: 5,
			offset: [-24, -13],
			pending: false,
			pendingKeys: [],
			pendingOffset: null
		},
		liveZ: {
			session: {
				id: run,
				ownerId: 'owner',
				ownerName: 'Owner',
				version: 0,
				stage: 'active',
				method: 'probe',
				z: 5,
				candidate: null,
				startedAt: Date.now(),
				expiresAt: Date.now() + 600000,
				message: null
			}
		}
	};
}
test('paper confirmation belongs to the observed height and resets after adjustment', async () => {
	const snapshot = state(),
		onSubmit = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });
	const screen = await render(LiveZCalibration, {
		snapshot,
		userId: 'owner',
		role: 'owner',
		connected: true,
		onSubmit
	});
	await screen.getByRole('checkbox', { name: /I checked the paper drag/ }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Accept height · stage result' }))
		.toBeEnabled();
	await screen.rerender({
		snapshot: {
			...snapshot,
			zProbe: { ...snapshot.zProbe!, z: 5.01 },
			liveZ: { session: { ...snapshot.liveZ!.session!, version: 1, z: 5.01 } }
		}
	});
	await expect
		.element(screen.getByRole('checkbox', { name: /I checked the paper drag/ }))
		.not.toBeChecked();
	await expect
		.element(screen.getByRole('button', { name: 'Accept height · stage result' }))
		.toBeDisabled();
});
test('ambiguous submission preserves its ID and blocks fresh motion until receipt reconciliation', async () => {
	const snapshot = state(),
		onSubmit = vi.fn().mockRejectedValue(new TypeError('connection lost'));
	const screen = await render(LiveZCalibration, {
		snapshot,
		userId: 'owner',
		role: 'owner',
		connected: true,
		onSubmit
	});
	await screen.getByRole('button', { name: 'Z +', exact: true }).click();
	await expect.element(screen.getByRole('button', { name: 'Z +', exact: true })).toBeDisabled();
	await expect
		.element(screen.getByRole('link', { name: 'Check unconfirmed submission receipt' }))
		.toBeVisible();
	const id = onSubmit.mock.calls[0][1];
	await screen.rerender({
		snapshot: {
			...snapshot,
			actions: [
				{ id, label: 'Adjustment', status: 'completed', createdAt: Date.now(), message: null }
			],
			zProbe: { ...snapshot.zProbe!, z: 5.01 },
			liveZ: { session: { ...snapshot.liveZ!.session!, version: 1, z: 5.01 } }
		}
	});
	await expect.element(screen.getByRole('button', { name: 'Z +', exact: true })).toBeEnabled();
	expect(onSubmit).toHaveBeenCalledTimes(1);
});
test('abort is available with a changed heater target and resolved results expose fresh preparation', async () => {
	const snapshot = state(),
		onSubmit = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });
	snapshot.heaters.nozzle.target = 200;
	const screen = await render(LiveZCalibration, {
		snapshot,
		userId: 'owner',
		role: 'owner',
		connected: true,
		onSubmit
	});
	await screen.getByRole('button', { name: 'Abort paper test…', exact: true }).click();
	await screen.getByRole('button', { name: 'Abort paper test', exact: true }).click();
	expect(onSubmit).toHaveBeenCalledWith(
		expect.objectContaining({ type: 'zProbeAbort', run, version: 0 }),
		expect.any(String)
	);
	await screen.rerender({
		snapshot: {
			...snapshot,
			heaters: { ...snapshot.heaters, nozzle: { current: 25, target: 0 } },
			zProbe: { ...snapshot.zProbe!, active: false },
			liveZ: { session: { ...snapshot.liveZ!.session!, stage: 'resolved' } }
		}
	});
	await expect.element(screen.getByRole('button', { name: 'Begin paper test' })).toBeVisible();
});

test('unchanged telemetry preserves paper confirmation while new observations invalidate it', async () => {
	let snapshot = state();
	const screen = await render(LiveZCalibration, {
		snapshot,
		userId: 'owner',
		role: 'owner',
		connected: true,
		onSubmit: vi.fn().mockResolvedValue({ id: crypto.randomUUID() })
	});
	const checkbox = screen.getByRole('checkbox', { name: /I checked the paper drag/ });
	const accept = screen.getByRole('button', { name: 'Accept height · stage result' });
	await checkbox.click();
	for (let i = 0; i < 3; i++) {
		snapshot = structuredClone(snapshot);
		snapshot.revision++;
		snapshot.updatedAt = Date.now();
		await screen.rerender({ snapshot });
		await expect.element(checkbox).toBeChecked();
		await expect.element(accept).toBeEnabled();
	}
	snapshot = structuredClone(snapshot);
	snapshot.zProbe!.z = 5.01;
	await screen.rerender({ snapshot });
	await expect.element(checkbox).not.toBeChecked();
	await checkbox.click();
	snapshot = structuredClone(snapshot);
	snapshot.liveZ!.session!.version++;
	await screen.rerender({ snapshot });
	await expect.element(checkbox).not.toBeChecked();
	await checkbox.click();
	snapshot = structuredClone(snapshot);
	snapshot.liveZ!.session!.id = crypto.randomUUID();
	await screen.rerender({ snapshot });
	await expect.element(checkbox).not.toBeChecked();
});

test('coarse approach is explicit, bounded, and returns to fine tuning without losing fine step selection', async () => {
	const snapshot = state(),
		onSubmit = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });
	const screen = await render(LiveZCalibration, {
		snapshot,
		userId: 'owner',
		role: 'owner',
		connected: true,
		onSubmit
	});
	await screen.getByRole('button', { name: 'Z −', exact: true }).click();
	expect(onSubmit).toHaveBeenLastCalledWith(
		expect.objectContaining({ delta: -0.01 }),
		expect.any(String)
	);
	await screen.getByRole('radio', { name: 'Coarse approach', exact: true }).click();
	await screen.getByRole('radio', { name: '1', exact: true }).click();
	await screen.getByRole('button', { name: 'Z −', exact: true }).click();
	expect(onSubmit).toHaveBeenLastCalledWith(
		expect.objectContaining({ delta: -1, expectedZ: 5, version: 0 }),
		expect.any(String)
	);
	await screen.rerender({
		snapshot: {
			...snapshot,
			zProbe: { ...snapshot.zProbe!, z: snapshot.motion.limits.z!.min + 0.25 }
		}
	});
	await expect.element(screen.getByRole('button', { name: 'Z −', exact: true })).toBeDisabled();
	await expect.element(screen.getByRole('button', { name: 'Z +', exact: true })).toBeEnabled();
	await screen.getByRole('radio', { name: 'Fine tuning', exact: true }).click();
	await expect.element(screen.getByRole('radio', { name: '0.01', exact: true })).toBeChecked();
	await expect.element(screen.getByRole('button', { name: 'Z −', exact: true })).toBeEnabled();
	await screen.getByRole('radio', { name: 'Coarse approach', exact: true }).click();
	await screen.rerender({
		snapshot: {
			...snapshot,
			liveZ: { session: { ...snapshot.liveZ!.session!, id: crypto.randomUUID() } }
		}
	});
	await expect
		.element(screen.getByRole('radio', { name: 'Fine tuning', exact: true }))
		.toBeChecked();
});

test('adjustment buttons remain fixed through pending, telemetry, coarse mode and errors', async () => {
	const snapshot = state();
	let release!: () => void;
	const onSubmit = vi.fn(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			})
	);
	const screen = await render(LiveZCalibration, {
		snapshot,
		userId: 'owner',
		role: 'owner',
		connected: true,
		onSubmit
	});
	const area = document.querySelector<HTMLElement>('#z-adjustment')!;
	const movement = area.querySelector<HTMLElement>('.movement')!;
	const top = movement.getBoundingClientRect().top;
	const assertStable = () => expect(movement.getBoundingClientRect().top).toBe(top);
	await screen.getByRole('button', { name: 'Z +', exact: true }).click();
	await expect.element(screen.getByRole('button', { name: 'Z +', exact: true })).toBeDisabled();
	assertStable();
	release();
	await screen.rerender({
		snapshot: {
			...snapshot,
			motion: { ...snapshot.motion, busy: true },
			liveZ: {
				session: {
					...snapshot.liveZ!.session!,
					message:
						'A long routine acknowledgement message that must never move the adjustment controls.'
				}
			}
		}
	});
	assertStable();
	await screen.rerender({
		snapshot: {
			...snapshot,
			zProbe: { ...snapshot.zProbe!, z: 4.99 },
			liveZ: { session: { ...snapshot.liveZ!.session!, version: 1, message: 'Acknowledged.' } }
		}
	});
	assertStable();
	await screen.getByRole('radio', { name: 'Coarse approach', exact: true }).click();
	assertStable();
	const retainedText = area.textContent;
	await screen.rerender({ connected: false });
	assertStable();
	expect(area.textContent).toBe(retainedText);
	expect(area.querySelector('.coordinate')!.getBoundingClientRect().top).toBeGreaterThan(
		movement.getBoundingClientRect().bottom
	);
	await expect.element(screen.getByText('Acknowledged.', { exact: true })).not.toBeInTheDocument();
});

test('preparation offers guarded homing then focuses the observed newly started adjustment view', async () => {
	const active = state();
	const snapshot = {
		...active,
		liveZ: { session: null },
		zProbe: { ...active.zProbe!, active: false },
		motion: { ...active.motion, homed: [] }
	};
	const onSubmit = vi.fn().mockResolvedValue({});
	const screen = await render(LiveZCalibration, {
		snapshot,
		userId: 'owner',
		role: 'owner',
		connected: true,
		onSubmit
	});
	await expect
		.element(screen.getByRole('button', { name: 'Home All', exact: true }))
		.toBeDisabled();
	await screen.getByRole('checkbox', { name: /The bed is clear/ }).click();
	await screen.getByRole('button', { name: 'Home All', exact: true }).click();
	expect(onSubmit).toHaveBeenCalledWith({ type: 'home', axes: 'all' }, expect.any(String));
	await screen.rerender({ snapshot: { ...snapshot, motion: active.motion } });
	await screen.getByRole('checkbox', { name: /The nozzle and bed are clean/ }).click();
	await screen.getByRole('checkbox', { name: /I have paper ready/ }).click();
	await screen.getByRole('button', { name: 'Begin paper test', exact: true }).click();
	const command = onSubmit.mock.calls.at(-1)![0];
	expect(command.type).toBe('zProbeBegin');
	expect(document.querySelector('#z-adjustment')).toBeNull();
	await screen.rerender({
		snapshot: { ...active, liveZ: { session: { ...active.liveZ!.session!, id: command.run } } }
	});
	await expect.poll(() => document.activeElement?.id).toBe('z-adjustment');
});
