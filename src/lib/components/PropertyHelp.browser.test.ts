import { expect, test, vi } from 'vite-plus/test';
import { userEvent } from 'vite-plus/test/browser';
import { render } from 'vitest-browser-svelte';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import ConfigurationSource from './ConfigurationSource.svelte';
import { helpFixture } from '../editor/property-help.fixture.js';
test('catalogue arrival preserves undo; keyboard help highlights keys, escapes safely and renders prose as text', async () => {
	const text = '[printer]\nmax_velocity: 200\n';
	const onChange = vi.fn();
	const screen = await render(ConfigurationSource, { value: text, path: 'printer.cfg', onChange });
	const input = screen.getByRole('textbox', { name: 'Editable configuration source' });
	await input.fill(text + '# draft\n');
	const view = EditorView.findFromDOM(input.element() as HTMLElement)!;
	await screen.rerender({ value: text + '# draft\n', reference: helpFixture });
	expect(undo(view)).toBe(true);
	expect(view.state.doc.toString()).toBe(text);
	view.dispatch({ selection: { anchor: text.indexOf('max_velocity') + 'max_velocity'.length } });
	view.focus();
	await userEvent.keyboard(
		navigator.platform.includes('Mac')
			? '{Meta>}{Shift>}{Space}{/Shift}{/Meta}'
			: '{Control>}{Shift>}{Space}{/Shift}{/Control}'
	);
	await expect
		.element(screen.getByRole('dialog', { name: 'max_velocity documentation' }))
		.toBeVisible();
	await expect
		.element(screen.getByText('Maximum speed <b>in mm/s</b>.', { exact: true }))
		.toBeVisible();
	expect(view.dom.querySelector('.cm-property-hover')?.textContent).toBe('max_velocity');
	expect(view.dom.querySelector('.cm-property-help b')).toBeNull();
	await expect
		.element(screen.getByRole('link', { name: 'Klipper documentation ↗' }))
		.toHaveAttribute('href', 'https://www.klipper3d.org/Config_Reference.html#printer');
	expect(document.activeElement?.getAttribute('role')).toBe('dialog');
	await userEvent.keyboard('{Tab}');
	expect(document.activeElement?.textContent).toBe('Klipper documentation ↗');
	await userEvent.keyboard('{Escape}');
	await expect
		.element(screen.getByRole('dialog', { name: 'max_velocity documentation' }))
		.not.toBeInTheDocument();
	expect(view.dom.querySelector('.cm-property-hover')).toBeNull();
	expect(view.state.doc.toString()).toBe(text);
});
test('mouse hover displays help and document edits dismiss it', async () => {
	const screen = await render(ConfigurationSource, {
		value: '[printer]\nmax_velocity: 200\n',
		path: 'printer.cfg',
		reference: helpFixture,
		onChange: vi.fn()
	});
	const input = screen.getByRole('textbox', { name: 'Editable configuration source' });
	await input.fill('[printer]\nmax_velocity: 201\n');
	const view = EditorView.findFromDOM(input.element() as HTMLElement)!;
	await userEvent.hover(screen.getByText('max_velocity:', { exact: true }));
	await expect.element(screen.getByRole('tooltip')).toBeVisible();
	view.dispatch({ changes: { from: view.state.doc.length, insert: '# edit\n' } });
	await expect.element(screen.getByRole('tooltip')).not.toBeInTheDocument();
});
