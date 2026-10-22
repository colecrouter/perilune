import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { startCompletion } from '@codemirror/autocomplete';
import ConfigurationSource from './ConfigurationSource.svelte';
import { EditorSessions } from '../editor/sessions.js';
const original = '[printer]\nmax_velocity: 200\n';
const textbox = (screen: Awaited<ReturnType<typeof render>>) =>
	screen.getByRole('textbox', { name: 'Editable configuration source' });
const viewOf = (input: { element: () => Element }) =>
	EditorView.findFromDOM(input.element() as HTMLElement)!;
test('retains independent undo across files and guided edits without retaining old callbacks', async () => {
	const sessions = new EditorSessions(),
		old = vi.fn(),
		next = vi.fn();
	let screen = await render(ConfigurationSource, {
		path: 'a.cfg',
		value: original,
		onChange: old,
		sessions
	});
	let input = textbox(screen);
	await input.fill(original + '# A\n');
	await screen.unmount();
	old.mockClear();
	screen = await render(ConfigurationSource, {
		path: 'b.cfg',
		value: '[mcu]\nserial: fixture\n',
		onChange: vi.fn(),
		sessions
	});
	await textbox(screen).fill('[mcu]\nserial: edited\n');
	await screen.unmount();
	const edited = original + '# A\n';
	screen = await render(ConfigurationSource, {
		path: 'a.cfg',
		value: edited,
		onChange: next,
		sessions
	});
	input = textbox(screen);
	await expect
		.element(screen.getByRole('button', { name: 'Find definition at cursor' }))
		.toBeVisible();
	await expect.element(input).toBeVisible();
	const view = viewOf(input);
	expect(undo(view)).toBe(true);
	expect(next).toHaveBeenLastCalledWith(original);
	expect(old).not.toHaveBeenCalled();
	expect(redo(view)).toBe(true);
	await screen.unmount();
	screen = await render(ConfigurationSource, {
		path: 'a.cfg',
		value: edited.replace('200', '250'),
		onChange: next,
		sessions
	});
	input = textbox(screen);
	await expect
		.element(screen.getByRole('button', { name: 'Find definition at cursor' }))
		.toBeVisible();
	await expect.element(input).toBeVisible();
	expect(undo(viewOf(input))).toBe(true);
	expect(viewOf(input).state.doc.toString()).toBe(edited);
	sessions.clear('a.cfg');
	await screen.rerender({ value: original, historyVersion: 1 });
	expect(undo(viewOf(input))).toBe(false);
});
test('shows actionable problems, clears old diagnostics and navigates using the current cursor', async () => {
	const onNavigate = vi.fn();
	const value = '[gcode_macro RUN]\ngcode:\n  CUSTOM\n  G1 X{params.X\n';
	const screen = await render(ConfigurationSource, {
		path: 'printer.cfg',
		value,
		onChange: vi.fn(),
		paths: ['printer.cfg', 'macros.cfg'],
		workspace: [{ path: 'macros.cfg', text: '[gcode_macro CUSTOM]\ngcode:\n  G28\n' }],
		onNavigate
	});
	const input = textbox(screen);
	await expect
		.element(screen.getByRole('button', { name: 'Find definition at cursor' }))
		.toBeVisible();
	await expect.element(input).toBeVisible();
	await expect
		.element(screen.getByText('Close this template expression with }.', { exact: true }))
		.toBeVisible();
	const view = viewOf(input);
	view.dispatch({ selection: { anchor: value.indexOf('CUSTOM') + 2 } });
	await screen.getByRole('button', { name: 'Find definition at cursor' }).click();
	expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ path: 'macros.cfg', line: 1 }));
	await screen.rerender({ value: value.replace('params.X\n', 'params.X}\n') });
	await expect
		.element(screen.getByText('Problems in this file (0)', { exact: true }))
		.toBeVisible();
	await screen.getByText('Problems in this file (0)', { exact: true }).click();
	await expect
		.element(
			screen.getByText('No problems found by the supported checks. Klipper remains authoritative.')
		)
		.toBeVisible();
});
test('supports macro completion and closes suggestions when made read-only', async () => {
	const value = '[gcode_macro RUN]\ngcode:\n  CUS';
	const screen = await render(ConfigurationSource, {
		path: 'printer.cfg',
		value,
		onChange: vi.fn(),
		workspace: [{ path: 'macros.cfg', text: '[gcode_macro CUSTOM]\ngcode:\n  G28\n' }]
	});
	const input = textbox(screen);
	await expect
		.element(screen.getByRole('button', { name: 'Find definition at cursor' }))
		.toBeVisible();
	await expect.element(input).toBeVisible();
	const view = viewOf(input);
	view.dispatch({ selection: { anchor: view.state.doc.length } });
	view.focus();
	startCompletion(view);
	await expect.element(screen.getByRole('option', { name: /CUSTOM/ })).toBeVisible();
	await screen.getByRole('option', { name: /CUSTOM/ }).click();
	expect(view.state.doc.toString()).toContain('  CUSTOM');
	startCompletion(view);
	await screen.rerender({ disabled: true });
	expect(view.state.readOnly).toBe(true);
	await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument();
});
test('displays and navigates diagnostics for CRLF drafts', async () => {
	const value = '[gcode_macro TEST]\r\ngcode:\r\n  G1 X{params.X\r\n';
	const screen = await render(ConfigurationSource, {
		path: 'macros.cfg',
		value,
		onChange: vi.fn()
	});
	await expect
		.element(screen.getByText('Close this template expression with }.', { exact: true }))
		.toBeVisible();
	await screen
		.getByRole('button', { name: 'error · line 3 Close this template expression with }.' })
		.click();
	const view = viewOf(textbox(screen));
	expect(view.state.selection.main.head).toBe(value.replace(/\r\n/g, '\n').indexOf('{params'));
	await screen.rerender({ value: value.replace('params.X\r\n', 'params.X}\r\n') });
	await expect
		.element(screen.getByText('Problems in this file (0)', { exact: true }))
		.toBeVisible();
});
test('analyses a near-limit template without unbounded diagnostics', async () => {
	const value =
		'[gcode_macro LARGE]\ngcode:\n' + '  G1 X{params.X|default(0)|float}\n'.repeat(7000);

	const screen = await render(ConfigurationSource, { path: 'large.cfg', value, onChange: vi.fn() });
	await expect
		.element(screen.getByRole('button', { name: 'Find definition at cursor' }))
		.toBeVisible();
	const view = viewOf(textbox(screen));

	view.dispatch({
		changes: { from: view.state.doc.length, to: view.state.doc.length, insert: '  G28\n' }
	});

	expect(view.state.doc.length).toBe(value.length + 6);
});
