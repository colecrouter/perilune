import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import ZCalibrationResult from './ZCalibrationResult.svelte';
import type { LiveZSession, ZProbeCapability } from '#lib/domain/live-z.js';
import type { ConfigApplication } from '#lib/domain/config-application.js';
const session: LiveZSession = {
	id: 'run',
	ownerId: 'owner',
	ownerName: 'Owner',
	version: 2,
	stage: 'resolved',
	method: 'probe',
	z: null,
	candidate: 1.2,
	previousOffset: 1.25,
	paperZ: 0.05,
	setting: 'probe.z_offset',
	startedAt: 0,
	expiresAt: 0,
	message: null
};
const capability: ZProbeCapability = {
	method: 'probe',
	active: false,
	z: null,
	offset: [0, 0],
	pending: false,
	pendingKeys: [],
	pendingOffset: null,
	configuredOffset: 1.2
};
const application: ConfigApplication = {
	id: 'save',
	calibrationRun: 'run',
	path: 'printer.cfg',
	mode: 'calibration',
	phase: 'ready',
	writeVerified: true,
	revertOf: null,
	createdAt: 0,
	updatedAt: 0,
	message: 'Startup verified',
	diagnostic: null
};
test('retains the before/after result and distinguishes the paper coordinate from a verified saved offset', async () => {
	const screen = await render(ZCalibrationResult, {
		session,
		capability,
		role: 'owner',
		readRecovery: vi.fn().mockResolvedValue({ enabled: true, application })
	});
	await expect
		.element(screen.getByRole('heading', { name: 'Saved & startup verified' }))
		.toBeVisible();
	await expect.element(screen.getByText('0.050 mm', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Change -0.050 mm', { exact: true })).toBeVisible();
	await expect
		.element(screen.getByRole('link', { name: 'Review save or revert…' }))
		.toHaveAttribute('href', '/configuration#configuration-recovery');
	await screen.rerender({
		session: structuredClone(session),
		capability: structuredClone(capability)
	});
	await expect
		.element(screen.getByRole('heading', { name: 'Saved & startup verified' }))
		.toBeVisible();
});
test('does not infer saved status from cleared pending flags or an unrelated successful save', async () => {
	const screen = await render(ZCalibrationResult, {
		session,
		capability,
		role: 'owner',
		readRecovery: vi.fn().mockResolvedValue({
			enabled: true,
			application: { ...application, calibrationRun: 'another-run' }
		})
	});
	await expect.element(screen.getByText(/that alone does not prove/)).toBeVisible();
	await expect
		.element(screen.getByRole('heading', { name: 'Accepted result', exact: true }))
		.toBeVisible();
});
test('shows a matched verified revert without claiming a successful calibration save', async () => {
	const screen = await render(ZCalibrationResult, {
		session,
		capability,
		role: 'owner',
		readRecovery: vi
			.fn()
			.mockResolvedValue({ enabled: true, application: { ...application, mode: 'revert' } })
	});
	await expect
		.element(screen.getByRole('heading', { name: 'Previous configuration restored' }))
		.toBeVisible();
});
test('operators can see the measurement without requesting owner-only recovery', async () => {
	const readRecovery = vi.fn();
	const screen = await render(ZCalibrationResult, {
		session,
		capability,
		role: 'operator',
		readRecovery
	});
	await expect.element(screen.getByText(/An owner can review/)).toBeVisible();
	expect(readRecovery).not.toHaveBeenCalled();
});

test('shows an unknown save outcome with recovery rather than claiming success', async () => {
	const screen = await render(ZCalibrationResult, {
		session,
		capability,
		role: 'owner',
		readRecovery: vi.fn().mockResolvedValue({
			enabled: true,
			application: {
				...application,
				phase: 'unknown',
				writeVerified: false,
				message: 'Acknowledgement was lost; no replay.'
			}
		})
	});
	await expect.element(screen.getByRole('heading', { name: 'Save outcome unknown' })).toBeVisible();
	await expect.element(screen.getByText(/Acknowledgement was lost; no replay/)).toBeVisible();
	await expect
		.element(screen.getByRole('link', { name: 'Review configuration & recovery' }))
		.toBeVisible();
});
