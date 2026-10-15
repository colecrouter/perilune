import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import PrinterConsole from './PrinterConsole.svelte';
import { simulatorMacros, type ConsoleSnapshot, type ConsoleReceipt } from '#lib/domain/console.js';
const initial: ConsoleSnapshot & { pins: string[] } = {
	revision: 0,
	mode: 'simulator',
	connection: 'connected',
	reason: null,
	macros: simulatorMacros,
	responses: [],
	receipts: [],
	pins: []
};
const receipt: ConsoleReceipt = {
	id: crypto.randomUUID(),
	script: 'HELP',
	status: 'queued',
	createdAt: Date.now(),
	message: null,
	output: []
};
test('preserves input on reconnect and macro review, and sends only after explicit review', async () => {
	const onSubmit = vi.fn(async (input) => ({ ...receipt, ...input }));
	const screen = await render(PrinterConsole, {
		snapshot: initial,
		connected: true,
		onSubmit,
		onFind: vi.fn(),
		onPin: vi.fn()
	});
	await screen.getByRole('textbox', { name: 'Command', exact: true }).fill('HELP');
	await screen.rerender({ connected: false });
	await expect.element(screen.getByRole('button', { name: 'Review command…' })).toBeDisabled();
	await expect
		.element(screen.getByRole('textbox', { name: 'Command', exact: true }))
		.toHaveValue('HELP');
	await screen.rerender({ connected: true });
	await screen.getByRole('button', { name: 'Review PERILUNE_STATUS', exact: true }).click();
	expect(onSubmit).not.toHaveBeenCalled();
	await screen.getByRole('button', { name: 'Keep editing' }).click();
	await expect
		.element(screen.getByRole('textbox', { name: 'Command', exact: true }))
		.toHaveValue('HELP');
	await screen.getByRole('button', { name: 'Review command…' }).click();
	await screen.getByRole('button', { name: 'Run in simulator' }).click();
	expect(onSubmit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ script: 'HELP' }));
});
test('does not resend after uncertain submission and reconciles an observed receipt', async () => {
	const onSubmit = vi.fn().mockRejectedValue(new Error('lost acknowledgment'));
	const screen = await render(PrinterConsole, {
		snapshot: initial,
		connected: true,
		onSubmit,
		onFind: vi.fn().mockResolvedValue(null),
		onPin: vi.fn()
	});
	await screen.getByRole('textbox', { name: 'Command', exact: true }).fill('HELP');
	await screen.getByRole('button', { name: 'Review command…' }).click();
	await screen.getByRole('button', { name: 'Run in simulator' }).click();
	await expect.element(screen.getByRole('button', { name: 'Check receipt' })).toBeVisible();
	await screen.getByRole('button', { name: 'Check receipt' }).click();
	expect(onSubmit).toHaveBeenCalledOnce();
	await screen.rerender({
		snapshot: {
			...initial,
			revision: 1,
			receipts: [{ ...receipt, id: onSubmit.mock.calls[0]![0].id }]
		}
	});
	await expect
		.element(screen.getByRole('textbox', { name: 'Command', exact: true }))
		.toHaveValue('');
	expect(onSubmit).toHaveBeenCalledOnce();
});
test('live mode never exposes an enabled run button and treats response markup as text', async () => {
	const screen = await render(PrinterConsole, {
		snapshot: {
			...initial,
			mode: 'moonraker',
			reason: 'Live command execution awaits coordinated testing.',
			responses: [
				{ id: 'line', at: Date.now(), kind: 'error', text: '<img src=x onerror=alert(1)>' }
			]
		},
		connected: true,
		onSubmit: vi.fn(),
		onFind: vi.fn(),
		onPin: vi.fn()
	});
	await screen.getByRole('textbox', { name: 'Command', exact: true }).fill('G28');
	await expect.element(screen.getByRole('button', { name: 'Review command…' })).toBeDisabled();
	expect(screen.container.querySelector('img')).toBeNull();
});
