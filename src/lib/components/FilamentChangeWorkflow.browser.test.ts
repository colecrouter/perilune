import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import FilamentChangeWorkflow from './FilamentChangeWorkflow.svelte';
import { initialSnapshot } from '#lib/domain/printer.js';
import {
	defaultFilamentChangeSettings,
	type FilamentChangeCommand
} from '#lib/domain/filament-change.js';
function fixture() {
	const snapshot = initialSnapshot();
	snapshot.mode = 'moonraker';
	snapshot.connection = 'connected';
	snapshot.telemetryReady = true;
	snapshot.klippy = 'ready';
	snapshot.liveControls = true;
	snapshot.liveFilament = true;
	snapshot.storage = 'healthy';
	snapshot.job = { ...snapshot.job, state: 'paused', filename: 'synthetic.gcode', runId: 'run' };
	return {
		snapshot,
		settingsRevision: 1,
		settings: {
			...defaultFilamentChangeSettings,
			revision: 1,
			mode: 'slicer' as const,
			reviewed: true,
			fingerprint: 'a'.repeat(64)
		},
		setupReason: null,
		userId: 'owner',
		role: 'owner',
		connected: true
	};
}
test('setup prerequisite links directly to review and does not imply account permission', async () => {
	const f = fixture();
	f.settings.mode = 'slicer';
	const screen = await render(FilamentChangeWorkflow, {
		...f,
		settings: { ...f.settings, mode: 'disabled' },
		setupReason: 'Review filament-change setup below before starting.'
	});
	await expect
		.element(screen.getByRole('link', { name: 'Review setup' }))
		.toHaveAttribute('href', '#filament-setup');
	await expect
		.element(screen.getByRole('button', { name: 'Begin filament change' }))
		.not.toBeInTheDocument();
});
test('attendance carries only into the acknowledged session and survives successful manual steps', async () => {
	const f = fixture();
	const submit = vi.fn(async (_request: { id: string; command: FilamentChangeCommand }) => {});
	const screen = await render(FilamentChangeWorkflow, { ...f, onSubmit: submit });
	const confirmation = screen.getByRole('checkbox');
	await confirmation.click();
	await screen.getByRole('button', { name: 'Begin filament change' }).click();
	const request = submit.mock.calls[0][0];
	expect(request.command.type).toBe('filamentChangeBegin');
	const session = {
		id: request.id,
		ownerId: 'owner',
		filename: 'synthetic.gcode',
		runId: 'run',
		generation: 1,
		settingsRevision: 1,
		fingerprint: f.settings.fingerprint,
		step: 1,
		stage: 'paused' as const,
		startedAt: Date.now(),
		expiresAt: Date.now() + 60000,
		message: 'Paused',
		slicerManaged: true,
		assisted: { parked: true }
	};
	const snapshot = {
		...f.snapshot,
		filamentChange: session,
		actions: [
			{
				id: request.id,
				label: 'Begin',
				status: 'completed' as const,
				createdAt: Date.now(),
				message: null
			}
		]
	};
	await screen.rerender({ snapshot });
	await expect.element(confirmation).toBeChecked();
	await screen.getByText('Manual extrusion (optional)', { exact: true }).click();
	await screen.getByRole('button', { name: 'Feed 10 mm', exact: true }).click();
	expect(submit.mock.calls[1][0].command).toMatchObject({
		type: 'filamentChangeFeed',
		distance: 10,
		operation: 'load'
	});
	await screen.rerender({
		snapshot: { ...snapshot, filamentChange: { ...session, stage: 'waiting' } }
	});
	await expect
		.element(screen.getByRole('button', { name: 'Feed 10 mm', exact: true }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Feed 10 mm', exact: true }))
		.toBeDisabled();
	await screen.rerender({ snapshot: { ...snapshot, filamentChange: { ...session, step: 2 } } });
	await expect.element(confirmation).toBeChecked();
	await screen.getByRole('button', { name: 'Resume print', exact: true }).click();
	expect(submit.mock.calls[2][0].command).toMatchObject({
		type: 'filamentChangeResume',
		expectedStep: 2
	});
	await screen.rerender({ connected: false });
	await expect.element(confirmation).not.toBeChecked();
	await expect
		.element(screen.getByRole('button', { name: 'Resume print', exact: true }))
		.toBeDisabled();
});
test('does not carry attendance into another operator session or expose legacy physical actions', async () => {
	const f = fixture();
	const submit = vi.fn(async (_request: { id: string; command: FilamentChangeCommand }) => {});
	const screen = await render(FilamentChangeWorkflow, { ...f, onSubmit: submit });
	await screen.getByRole('checkbox').click();
	await screen.getByRole('button', { name: 'Begin filament change' }).click();
	const session = {
		id: crypto.randomUUID(),
		ownerId: 'someone-else',
		filename: 'synthetic.gcode',
		runId: 'run',
		generation: 1,
		settingsRevision: 1,
		fingerprint: f.settings.fingerprint,
		step: 1,
		stage: 'paused' as const,
		startedAt: Date.now(),
		expiresAt: Date.now() + 60000,
		message: 'Paused'
	};
	await screen.rerender({ snapshot: { ...f.snapshot, filamentChange: session } });
	await expect.element(screen.getByRole('checkbox')).not.toBeChecked();
	await expect
		.element(screen.getByRole('button', { name: 'Resume print', exact: true }))
		.not.toBeInTheDocument();
	await expect.element(screen.getByRole('button', { name: 'End guidance' })).toBeVisible();
});

test('a lost submission response blocks another request until its receipt is observed', async () => {
	const f = fixture();
	const submit = vi.fn(async (_request: { id: string; command: FilamentChangeCommand }) => {
		throw Error('Response lost');
	});
	const screen = await render(FilamentChangeWorkflow, { ...f, onSubmit: submit });
	await screen.getByRole('checkbox').click();
	await screen.getByRole('button', { name: 'Begin filament change' }).click();
	await expect.element(screen.getByRole('alert')).toHaveTextContent('Response lost');
	await expect
		.element(screen.getByRole('button', { name: 'Begin filament change' }))
		.toBeDisabled();
	expect(submit).toHaveBeenCalledTimes(1);
});

test('a disconnect cancels the pending attendance handoff and an account switch requires fresh consent', async () => {
	const f = fixture();
	const submit = vi.fn(async (_request: { id: string; command: FilamentChangeCommand }) => {});
	const screen = await render(FilamentChangeWorkflow, { ...f, onSubmit: submit });
	await screen.getByRole('checkbox').click();
	await screen.getByRole('button', { name: 'Begin filament change' }).click();
	const request = submit.mock.calls[0][0];
	await screen.rerender({ connected: false });
	const session = {
		id: request.id,
		ownerId: 'owner',
		filename: 'synthetic.gcode',
		runId: 'run',
		generation: 1,
		settingsRevision: 1,
		fingerprint: f.settings.fingerprint,
		step: 1,
		stage: 'paused' as const,
		startedAt: Date.now(),
		expiresAt: Date.now() + 60000,
		message: 'Paused',
		slicerManaged: true,
		assisted: { parked: false }
	};
	await screen.rerender({
		connected: true,
		snapshot: {
			...f.snapshot,
			filamentChange: session,
			actions: [
				{
					id: request.id,
					label: 'Begin',
					status: 'completed',
					createdAt: Date.now(),
					message: null
				}
			]
		}
	});
	await expect.element(screen.getByRole('checkbox')).not.toBeChecked();
	await screen.getByRole('checkbox').click();
	await expect.element(screen.getByRole('checkbox')).toBeChecked();
	await screen.rerender({ userId: 'different-owner' });
	await expect.element(screen.getByRole('checkbox')).not.toBeChecked();
});
test('an accepted request that fails later shows its concrete rejection reason', async () => {
	const f = fixture();
	const submit = vi.fn(async (_request: { id: string; command: FilamentChangeCommand }) => {});
	const screen = await render(FilamentChangeWorkflow, { ...f, onSubmit: submit });
	await screen.getByRole('checkbox').click();
	await screen.getByRole('button', { name: 'Begin filament change' }).click();
	const request = submit.mock.calls[0][0];
	await screen.rerender({
		snapshot: {
			...f.snapshot,
			actions: [
				{
					id: request.id,
					label: 'Begin',
					status: 'failed',
					createdAt: Date.now(),
					message: 'The print pause state changed. Review it before starting.'
				}
			]
		}
	});
	await expect
		.element(screen.getByRole('alert'))
		.toHaveTextContent('The print pause state changed. Review it before starting.');
});

test('recovery cannot complete an earlier Begin attendance handoff', async () => {
	const f = fixture();
	const submit = vi.fn(async (_request: { id: string; command: FilamentChangeCommand }) => {});
	const screen = await render(FilamentChangeWorkflow, { ...f, onSubmit: submit });
	await screen.getByRole('checkbox').click();
	await screen.getByRole('button', { name: 'Begin filament change' }).click();
	const begin = submit.mock.calls[0][0];
	const session = {
		id: begin.id,
		ownerId: 'owner',
		filename: 'synthetic.gcode',
		runId: 'run',
		generation: 1,
		settingsRevision: 1,
		fingerprint: f.settings.fingerprint,
		step: 1,
		stage: 'review' as const,
		startedAt: Date.now(),
		expiresAt: Date.now() + 60000,
		message: 'Inspect recovery',
		slicerManaged: true,
		assisted: { parked: false }
	};
	await screen.rerender({
		snapshot: {
			...f.snapshot,
			filamentChange: session,
			actions: [
				{
					id: begin.id,
					label: 'Begin',
					status: 'unknown',
					createdAt: Date.now(),
					message: 'Inspect recovery'
				}
			]
		}
	});
	await screen.getByRole('checkbox').click();
	await screen.getByRole('button', { name: 'Review & take over' }).click();
	const recover = submit.mock.calls[1][0];
	await screen.rerender({
		snapshot: {
			...f.snapshot,
			filamentChange: { ...session, stage: 'paused', step: 2 },
			actions: [
				{
					id: recover.id,
					label: 'Recover',
					status: 'completed',
					createdAt: Date.now(),
					message: null
				}
			]
		}
	});
	await expect.element(screen.getByRole('checkbox')).not.toBeChecked();
	await expect
		.element(screen.getByRole('button', { name: 'Resume print', exact: true }))
		.toBeDisabled();
});
