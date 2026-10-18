import { expect, test, vi } from 'vite-plus/test';
import { userEvent } from 'vite-plus/test/browser';
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
test('preserves input on reconnect and sends commands or macros only on explicit submission', async () => {
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
	await expect.element(screen.getByRole('button', { name: 'Send command' })).toBeDisabled();
	await expect
		.element(screen.getByRole('textbox', { name: 'Command', exact: true }))
		.toHaveValue('HELP');
	await screen.rerender({ connected: true });
	await screen.getByRole('button', { name: 'Run PERILUNE_STATUS', exact: true }).click();
	expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ script: 'PERILUNE_STATUS' })
	);
	await expect
		.element(screen.getByRole('textbox', { name: 'Command', exact: true }))
		.toHaveValue('HELP');
	await screen.getByRole('button', { name: 'Send command' }).click();
	expect(onSubmit).toHaveBeenCalledTimes(2);
	expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ script: 'HELP' }));
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
	await screen.getByRole('button', { name: 'Send command' }).click();
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
	await expect.element(screen.getByRole('button', { name: 'Send command' })).toBeDisabled();
	expect(screen.container.querySelector('img')).toBeNull();
});

test('arrow history restores drafts, preserves multiline editing and freezes across updates', async () => {
	const screen = await render(PrinterConsole, {
		snapshot: {
			...initial,
			receipts: [
				{ ...receipt, script: 'M105', createdAt: 1 },
				{ ...receipt, id: 'second', script: 'HELP', createdAt: 2 }
			]
		},
		connected: true,
		onSubmit: vi.fn(),
		onFind: vi.fn(),
		onPin: vi.fn()
	});
	const input = screen.getByRole('textbox', { name: 'Command', exact: true });
	await input.fill('unfinished');
	await userEvent.keyboard('{ArrowUp}');
	await expect.element(input).toHaveValue('HELP');
	await screen.rerender({
		snapshot: { ...initial, receipts: [{ ...receipt, script: 'M114', createdAt: 3 }] }
	});
	await userEvent.keyboard('{ArrowUp}');
	await expect.element(input).toHaveValue('M105');
	await userEvent.keyboard('{ArrowDown}{ArrowDown}');
	await expect.element(input).toHaveValue('unfinished');
	await input.fill('first\nsecond');
	await userEvent.keyboard('{End}{ArrowUp}');
	await expect.element(input).toHaveValue('first\nsecond');
});
test('response groups expand to original samples and can be disabled', async () => {
	const screen = await render(PrinterConsole, {
		snapshot: {
			...initial,
			responses: [
				{ id: 'a', at: 1, kind: 'response', text: 'B:25 /0 T0:26 /0' },
				{ id: 'b', at: 2, kind: 'response', text: 'B:26 /0 T0:27 /0' }
			]
		},
		connected: true,
		onSubmit: vi.fn(),
		onFind: vi.fn(),
		onPin: vi.fn()
	});
	await screen.getByText('Temperature updates · 2 messages').click();
	await expect.element(screen.getByText('B:25 /0 T0:26 /0', { exact: true })).toBeVisible();
	await screen.getByRole('checkbox', { name: 'Group repeated responses' }).click();
	await expect
		.element(screen.getByText('Temperature updates · 2 messages'))
		.not.toBeInTheDocument();
	await expect.element(screen.getByText('B:25 /0 T0:26 /0', { exact: true })).toBeVisible();
});

test('an unrelated macro receipt preserves history traversal and its unfinished draft', async () => {
	const screen = await render(PrinterConsole, {
		snapshot: { ...initial, receipts: [receipt] },
		connected: true,
		onSubmit: vi.fn(async (input) => ({ ...receipt, ...input })),
		onFind: vi.fn(),
		onPin: vi.fn()
	});
	const input = screen.getByRole('textbox', { name: 'Command', exact: true });
	await input.fill('unfinished');
	await userEvent.keyboard('{ArrowUp}');
	await expect.element(input).toHaveValue('HELP');
	await screen.getByRole('button', { name: 'Run PERILUNE_STATUS', exact: true }).click();
	await input.click();
	await userEvent.keyboard('{ArrowDown}');
	await expect.element(input).toHaveValue('unfinished');
});

test('expanding a response group pauses following and revision-only updates preserve its scroll position', async () => {
	const responses = Array.from({ length: 100 }, (_, i) => ({
		id: `line-${i}`,
		at: i,
		kind: 'response' as const,
		text: `B:${i} /0 T0:26 /0`
	}));
	const screen = await render(PrinterConsole, {
		snapshot: { ...initial, responses },
		connected: true,
		onSubmit: vi.fn(),
		onFind: vi.fn(),
		onPin: vi.fn()
	});
	await screen.getByText('Temperature updates · 100 messages').click();
	await expect.element(screen.getByRole('checkbox', { name: 'Follow latest' })).not.toBeChecked();
	const log = screen.container.querySelector('.log') as HTMLElement;
	log.scrollTop = 150;
	log.dispatchEvent(new Event('scroll'));
	await screen.rerender({ snapshot: { ...initial, revision: 2, responses } });
	expect(log.scrollTop).toBe(150);
	await screen.getByRole('button', { name: 'Collapse messages' }).click();
	expect(screen.container.querySelector('details.response-group')?.hasAttribute('open')).toBe(
		false
	);
});
