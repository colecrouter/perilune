import { expect, test, vi } from 'vite-plus/test';
import { userEvent } from 'vite-plus/test/browser';
import { render } from 'vitest-browser-svelte';
import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { language } from '@codemirror/language';
import ConfigurationSource from './ConfigurationSource.svelte';

test('lazy editor supports history, search, safe read-only updates and destroys on unmount', async () => {
	const onChange = vi.fn();
	const source = '[printer]\nmax_velocity: 200\n';
	const screen = await render(ConfigurationSource, {
		value: source,
		path: 'printer.cfg',
		onChange
	});
	const input = screen.getByRole('textbox', { name: 'Editable configuration source' });
	await input.fill(source + '# mine\n');
	const view = EditorView.findFromDOM(input.element() as HTMLElement)!;
	expect(view.state.doc.toString()).toBe(source + '# mine\n');
	expect(onChange).toHaveBeenLastCalledWith(source + '# mine\n');
	expect(undo(view)).toBe(true);
	expect(onChange).toHaveBeenLastCalledWith(source);
	expect(redo(view)).toBe(true);
	await screen.rerender({ value: source + '# mine\n' });
	expect(view.state.doc.toString()).toBe(source + '# mine\n');
	await input.click();
	await userEvent.keyboard(
		navigator.platform.includes('Mac') ? '{Meta>}f{/Meta}' : '{Control>}f{/Control}'
	);
	await expect.element(screen.getByRole('textbox', { name: 'Find', exact: true })).toBeVisible();
	await userEvent.keyboard('{Escape}');
	await input.click();
	await userEvent.keyboard('{Escape}{Tab}');
	expect(document.activeElement).not.toBe(view.contentDOM);
	await screen.rerender({ disabled: true });
	expect(view.state.readOnly).toBe(true);
	expect(view.contentDOM.getAttribute('contenteditable')).toBe('false');
	onChange.mockClear();
	await screen.rerender({ value: source + '# refreshed\n', disabled: false });
	expect(view.state.doc.toString()).toBe(source + '# refreshed\n');
	expect(onChange).not.toHaveBeenCalled();
	expect(undo(view)).toBe(false);
	expect(view.state.doc.toString()).toBe(source + '# refreshed\n');
	await screen.unmount();
	expect(view.dom.isConnected).toBe(false);
});
for (const [path, expected] of [
	['notes.yaml', 'yaml'],
	['settings.json', 'json']
] as const) {
	test(`uses native ${expected} syntax for ${path}`, async () => {
		const screen = await render(ConfigurationSource, { value: '{}', path, onChange: vi.fn() });
		await screen.getByRole('textbox', { name: 'Editable configuration source' }).fill('{}');
		const view = EditorView.findFromDOM(
			screen
				.getByRole('textbox', { name: 'Editable configuration source' })
				.element() as HTMLElement
		)!;
		expect(view.state.facet(language)?.name).toBe(expected);
	});
}
