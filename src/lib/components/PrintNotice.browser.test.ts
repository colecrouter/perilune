import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import {
	printActionJournal,
	createPrintActionJournal
} from '#lib/client/print-action-journal.svelte.js';
import { submitTrackedPrintAction } from '#lib/client/submit-print-action.js';
import PrintNotice from './PrintNotice.svelte';
import { initialSnapshot, type ActionRecord } from '#lib/domain/printer.js';
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
	window.localStorage.clear();
	printActionJournal.activate('owner');
	printActionJournal.refresh();
});
const printing = () => {
	const snapshot = initialSnapshot();
	snapshot.job = {
		...snapshot.job,
		filename: 'part.gcode',
		runId: 'run-a',
		state: 'printing',
		progress: 42,
		remainingMinutes: 18
	};
	return snapshot;
};
test('shared status retains progress through reconnect, respects roles, and clears on completion', async () => {
	const snapshot = printing();
	const screen = await render(PrintNotice, {
		snapshot,
		userId: 'owner',
		role: 'owner',
		submitStop: vi.fn()
	});
	await expect
		.element(screen.getByRole('progressbar', { name: 'Print progress' }))
		.toHaveAttribute('value', '42');
	await expect.element(screen.getByText('About 18 min remaining', { exact: true })).toBeVisible();
	await screen.rerender({ available: false });
	await expect.element(screen.getByRole('progressbar')).toHaveAttribute('value', '42');
	await expect
		.element(screen.getByRole('button', { name: 'Pause print', exact: true }))
		.toBeDisabled();
	await screen.rerender({ available: true, role: 'viewer' });
	await expect
		.element(screen.getByRole('button', { name: 'Pause print', exact: true }))
		.not.toBeInTheDocument();
	await expect
		.element(screen.getByRole('button', { name: 'Stop print', exact: true }))
		.not.toBeInTheDocument();
	await screen.rerender({ snapshot: { ...snapshot, job: { ...snapshot.job, state: 'complete' } } });
	await expect
		.element(screen.getByRole('region', { name: 'Print status' }))
		.not.toBeInTheDocument();
});
test('stop review freezes job identity and keeps heater choices through updates', async () => {
	const snapshot = printing();
	const submitStop = vi.fn().mockResolvedValue({ id: 'receipt' });
	const screen = await render(PrintNotice, {
		snapshot,
		userId: 'owner',
		role: 'owner',
		submitStop
	});
	await screen.getByRole('button', { name: 'Stop print', exact: true }).click();
	await screen.getByRole('checkbox', { name: 'Cool down bed', exact: true }).click();
	await screen.rerender({
		snapshot: {
			...snapshot,
			heaters: { ...snapshot.heaters, bed: { current: 60, target: 80 } },
			job: { ...snapshot.job, progress: 43 }
		}
	});
	await expect
		.element(screen.getByRole('checkbox', { name: 'Cool down bed', exact: true }))
		.not.toBeChecked();
	await screen.rerender({ snapshot: { ...snapshot, job: { ...snapshot.job, runId: 'run-b' } } });
	await expect
		.element(screen.getByRole('dialog').getByRole('button', { name: 'Stop print', exact: true }))
		.toBeDisabled();
	await expect.element(screen.getByText(/The displayed print changed or ended/)).toBeVisible();
	expect(submitStop).not.toHaveBeenCalled();
	await screen.getByRole('button', { name: 'Keep printing', exact: true }).click();
	await screen.getByRole('button', { name: 'Stop print', exact: true }).click();
	await screen.getByRole('dialog').getByRole('button', { name: 'Stop print', exact: true }).click();
	expect(submitStop).toHaveBeenCalledWith(
		expect.objectContaining({
			command: expect.objectContaining({
				type: 'cancel',
				expectedJob: { filename: 'part.gcode', runId: 'run-b' },
				coolBed: false
			})
		})
	);
});
test('lost stop acknowledgement links its stable receipt without automatic resend', async () => {
	const snapshot = printing();
	const submitStop = vi.fn().mockRejectedValue(Error('Connection interrupted'));
	const screen = await render(PrintNotice, {
		snapshot,
		userId: 'owner',
		role: 'owner',
		submitStop
	});
	await screen.getByRole('button', { name: 'Stop print', exact: true }).click();
	await screen.getByRole('dialog').getByRole('button', { name: 'Stop print', exact: true }).click();
	await expect
		.element(screen.getByRole('dialog').getByRole('button', { name: 'Stop print', exact: true }))
		.toBeDisabled();
	const id = submitStop.mock.calls[0][0].id;
	await screen.getByRole('button', { name: 'Keep printing', exact: true }).click();
	await expect
		.element(screen.getByRole('link', { name: 'Review print submission →' }))
		.toHaveAttribute('href', '/actions/' + id);
	const receipt: ActionRecord = {
		id,
		label: 'Stop print',
		status: 'unknown',
		createdAt: Date.now(),
		message: 'Check printer'
	};
	await screen.rerender({ snapshot: { ...snapshot, actions: [receipt] } });
	await expect
		.element(screen.getByRole('button', { name: 'Pause print', exact: true }))
		.toBeDisabled();
	expect(submitStop).toHaveBeenCalledOnce();
	await screen.rerender({ snapshot: { ...snapshot, actions: [{ ...receipt, status: 'failed' }] } });
	await expect
		.element(screen.getByRole('button', { name: 'Pause print', exact: true }))
		.toBeEnabled();
	expect(submitStop).toHaveBeenCalledOnce();
});
test('filament guidance replaces resume and emergency recovery hides ordinary controls', async () => {
	const snapshot = printing();
	snapshot.job.state = 'paused';
	snapshot.filamentChange = {
		id: 'change',
		ownerId: 'owner',
		filename: snapshot.job.filename,
		runId: 'run-a',
		generation: 1,
		settingsRevision: 1,
		fingerprint: 'fixture',
		step: 0,
		stage: 'review',
		startedAt: 0,
		expiresAt: 1,
		message: 'private details'
	};
	const screen = await render(PrintNotice, {
		snapshot,
		userId: 'owner',
		role: 'operator',
		submitStop: vi.fn()
	});
	await expect
		.element(screen.getByRole('link', { name: 'Continue filament change' }))
		.toHaveAttribute('href', '/filament');
	await expect
		.element(screen.getByRole('button', { name: 'Resume print' }))
		.not.toBeInTheDocument();
	await expect
		.element(screen.getByText('private details', { exact: true }))
		.not.toBeInTheDocument();
	await screen.rerender({
		snapshot: { ...snapshot, liveRecovery: { id: 'recovery', message: 'Review uncertain action' } }
	});
	await expect
		.element(screen.getByRole('button', { name: 'Stop print', exact: true }))
		.not.toBeInTheDocument();
	await expect.element(screen.getByRole('progressbar')).toBeVisible();
});

test('cold journal restoration retains a missing receipt and scopes it to the account', () => {
	const id = crypto.randomUUID();
	const first = createPrintActionJournal(() => window.localStorage);
	first.activate('account-a');
	first.begin('account-a', id, 'Pause print');
	const inFlight = createPrintActionJournal(() => window.localStorage);
	inFlight.activate('account-a');
	expect(inFlight.entries[0].status).toBe('queued');
	first.unknown('account-a', id);
	const restored = createPrintActionJournal(() => window.localStorage);
	restored.activate('account-b');
	expect(restored.entries).toEqual([]);
	restored.activate('account-a');
	expect(restored.entries[0].id).toBe(id);
	restored.observe('account-a', []);
	expect(restored.entries[0].id).toBe(id);
	restored.observe('account-a', [
		{ id, label: 'Pause print', status: 'unknown', createdAt: 0, message: null, reviewedAt: 1 }
	]);
	expect(restored.entries).toEqual([]);
});
test('explicit receipt reconciliation can close a never-accepted stop without resending', async () => {
	const snapshot = printing(),
		submitStop = vi.fn().mockRejectedValue(Error('Lost response'));
	let id = '';
	const reconcile = vi.fn().mockImplementation(async (receiptId: string) => ({
		id: receiptId,
		label: 'Print submission',
		status: 'failed',
		createdAt: Date.now(),
		message: 'ID closed'
	}));
	const screen = await render(PrintNotice, {
		snapshot,
		userId: 'owner',
		role: 'owner',
		submitStop,
		reconcile
	});
	await screen.getByRole('button', { name: 'Stop print', exact: true }).click();
	await screen.getByRole('dialog').getByRole('button', { name: 'Stop print', exact: true }).click();
	id = submitStop.mock.calls[0][0].id;
	await screen.getByRole('button', { name: 'Keep printing', exact: true }).click();
	await screen.getByRole('button', { name: 'Check receipt', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Pause print', exact: true }))
		.toBeEnabled();
	expect(reconcile).toHaveBeenCalledWith(id, 'owner');
	expect(submitStop).toHaveBeenCalledOnce();
});

test('an in-flight stop retains its original account across account changes', async () => {
	let fail!: (error: Error) => void;
	const submitStop = vi.fn().mockImplementation(
		() =>
			new Promise((_resolve, reject) => {
				fail = reject;
			})
	);
	const snapshot = printing();
	const screen = await render(PrintNotice, {
		snapshot,
		userId: 'owner',
		role: 'owner',
		submitStop
	});
	await screen.getByRole('button', { name: 'Stop print', exact: true }).click();
	await screen.getByRole('dialog').getByRole('button', { name: 'Stop print', exact: true }).click();
	const id = submitStop.mock.calls[0][0].id;
	await screen.rerender({ userId: 'other', role: 'viewer' });
	fail(Error('Lost response'));
	await expect
		.element(screen.getByRole('dialog').getByText('Lost response', { exact: true }))
		.toBeVisible();
	expect(printActionJournal.account).toBe('other');
	expect(printActionJournal.entries).toEqual([]);
	const restored = createPrintActionJournal(() => window.localStorage);
	restored.activate('owner');
	expect(restored.entries[0].id).toBe(id);
	expect(restored.entries[0].status).toBe('unknown');
});

test('unavailable persistent storage blocks submission before any request is sent', () => {
	const journal = createPrintActionJournal(() => window.localStorage);
	journal.activate('storage-test');
	vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
		throw new DOMException('Quota exceeded', 'QuotaExceededError');
	});
	expect(() => journal.begin('storage-test', crypto.randomUUID(), 'Pause print')).toThrow(
		/cannot retain/
	);
	expect(journal.ready).toBe(false);
});

test('receipt reconciliation remains available after the print ends', async () => {
	const id = crypto.randomUUID();
	printActionJournal.begin('owner', id, 'Stop print');
	printActionJournal.unknown('owner', id);
	const snapshot = printing();
	snapshot.job.state = 'complete';
	const reconcile = vi.fn().mockResolvedValue({
		id,
		label: 'Print submission',
		status: 'failed',
		createdAt: 1,
		message: 'Closed'
	});
	const screen = await render(PrintNotice, {
		snapshot,
		userId: 'owner',
		role: 'owner',
		submitStop: vi.fn(),
		reconcile
	});
	await expect
		.element(screen.getByRole('button', { name: 'Check receipt', exact: true }))
		.toBeVisible();
	await screen.getByRole('button', { name: 'Check receipt', exact: true }).click();
	await expect
		.element(screen.getByRole('region', { name: 'Print status' }))
		.not.toBeInTheDocument();
});
test('start submission retains its exact ID and prevents a new-ID retry after a lost response', async () => {
	const id = crypto.randomUUID(),
		send = vi.fn().mockRejectedValue(Error('Lost response'));
	await expect(
		submitTrackedPrintAction(
			'owner',
			{ id, command: { type: 'start', fileId: crypto.randomUUID() } },
			send
		)
	).rejects.toThrow(/Lost response/);
	const restored = createPrintActionJournal(() => window.localStorage);
	restored.activate('owner');
	expect(restored.entries[0].id).toBe(id);
	expect(restored.entries[0].label).toBe('Start print');
	await expect(
		submitTrackedPrintAction(
			'owner',
			{ id: crypto.randomUUID(), command: { type: 'start', fileId: crypto.randomUUID() } },
			send
		)
	).rejects.toThrow(/pending print action/);
	expect(send).toHaveBeenCalledOnce();
});
