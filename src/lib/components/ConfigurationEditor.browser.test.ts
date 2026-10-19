import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import { EditorView } from '@codemirror/view';
import ConfigurationEditor from './ConfigurationEditor.svelte';
import { configParts, type ConfigDocument } from '#lib/domain/configuration.js';
// Unit tests isolate optional reference loading; production smoke exercises the real artifact.
beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('reference offline'))));
afterEach(() => vi.unstubAllGlobals());
const tail =
	'\n#*# <---------------------- SAVE_CONFIG ---------------------->\n#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.\n#*#\n#*# [probe]\n#*# z_offset = 1.2\n';
const file = (
	path = 'printer.cfg',
	text = '[printer]\nmax_velocity: 200 # keep\n' + tail
): ConfigDocument => ({
	path,
	text,
	version: 'original',
	updatedAt: 1,
	source: 'simulator',
	backups: []
});
const callbacks = (doc: ConfigDocument) => ({
	onRead: vi.fn().mockResolvedValue(doc),
	onSave: vi.fn().mockResolvedValue({ path: doc.path, version: 'saved', updatedAt: 2 }),
	onBackup: vi.fn().mockResolvedValue(doc.text)
});
test('guided edits preserve raw comments and generated suffix, and save only after diff confirmation', async () => {
	const doc = file();
	const calls = callbacks(doc);
	calls.onRead.mockResolvedValue({
		...doc,
		text: doc.text.replace('200 #', '180 #'),
		version: 'saved'
	});
	const screen = await render(ConfigurationEditor, { document: doc, files: [doc], ...calls });
	await screen.getByRole('spinbutton', { name: 'Maximum velocity', exact: true }).fill('180');
	await screen.getByRole('button', { name: 'Raw source', exact: true }).click();
	await expect
		.poll(() =>
			EditorView.findFromDOM(
				screen
					.getByRole('textbox', { name: 'Editable configuration source' })
					.element() as HTMLElement
			)?.state.doc.toString()
		)
		.toBe('[printer]\nmax_velocity: 180 # keep\n');
	await screen.getByRole('button', { name: 'Review changes…' }).click();
	await expect.element(screen.getByRole('button', { name: 'Save simulator file' })).toBeDisabled();
	await screen.getByRole('checkbox', { name: 'I reviewed the source changes.' }).click();
	await screen.getByRole('button', { name: 'Save simulator file' }).click();
	expect(calls.onSave).toHaveBeenCalledWith(
		expect.objectContaining({
			expectedVersion: 'original',
			text: doc.text.replace('200 #', '180 #')
		})
	);
	expect(configParts(calls.onSave.mock.calls[0]![0].text).generated).toBe(tail);
	await expect.element(screen.getByRole('button', { name: 'Review changes…' })).toBeDisabled();
});
test('incoming revisions and file switches keep drafts, and a checked newer version blocks overwrite', async () => {
	const doc = file();
	const calls = callbacks(doc);
	const screen = await render(ConfigurationEditor, {
		document: doc,
		files: [doc, file('macros.cfg', '[gcode_macro EXAMPLE]\ngcode:\n    G28\n')],
		...calls
	});
	await screen.getByRole('button', { name: 'Raw source', exact: true }).click();
	await screen
		.getByRole('textbox', { name: 'Editable configuration source' })
		.fill('[printer]\nmax_velocity: 180 # mine\n');
	await screen.rerender({
		document: file('macros.cfg', '[gcode_macro EXAMPLE]\ngcode:\n    G28\n')
	});
	await expect
		.poll(() =>
			EditorView.findFromDOM(
				screen
					.getByRole('textbox', { name: 'Editable configuration source' })
					.element() as HTMLElement
			)?.state.doc.toString()
		)
		.toBe('[gcode_macro EXAMPLE]\ngcode:\n    G28\n');
	await screen.rerender({
		document: { ...doc, version: 'newer', text: doc.text.replace('200', '250') }
	});
	await expect
		.poll(() =>
			EditorView.findFromDOM(
				screen
					.getByRole('textbox', { name: 'Editable configuration source' })
					.element() as HTMLElement
			)?.state.doc.toString()
		)
		.toBe('[printer]\nmax_velocity: 180 # mine\n');
	await expect
		.element(screen.getByRole('heading', { name: 'A newer saved file exists' }))
		.toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Review changes…' })).toBeDisabled();
	expect(calls.onSave).not.toHaveBeenCalled();
});
test('live drafts can be reviewed but never call save', async () => {
	const doc = {
		...file('printer.cfg', '[printer]\nmax_velocity: 200\n'),
		source: 'moonraker' as const
	};
	const calls = callbacks(doc);
	const screen = await render(ConfigurationEditor, { document: doc, files: [doc], ...calls });
	await screen.getByRole('button', { name: 'Raw source', exact: true }).click();
	await screen
		.getByRole('textbox', { name: 'Editable configuration source' })
		.fill('[printer]\nmax_velocity: 180\n');
	await screen.getByRole('button', { name: 'Review changes…' }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Export reviewed draft' }))
		.toBeDisabled();
	expect(calls.onSave).not.toHaveBeenCalled();
});

test('rejected guided input visibly reverts before another field can be reviewed', async () => {
	const doc = file('printer.cfg', '[printer]\nmax_velocity: 200\nmax_accel: 2500\n');
	const calls = callbacks(doc);
	const screen = await render(ConfigurationEditor, { document: doc, files: [doc], ...calls });
	await screen.getByRole('spinbutton', { name: 'Maximum velocity', exact: true }).fill('90000');
	await screen.getByRole('spinbutton', { name: 'Maximum acceleration', exact: true }).fill('2000');
	await expect
		.element(screen.getByRole('spinbutton', { name: 'Maximum velocity', exact: true }))
		.toHaveValue(200);
	await screen.getByRole('button', { name: 'Raw source', exact: true }).click();
	await expect
		.poll(() =>
			EditorView.findFromDOM(
				screen
					.getByRole('textbox', { name: 'Editable configuration source' })
					.element() as HTMLElement
			)?.state.doc.toString()
		)
		.toBe('[printer]\nmax_velocity: 200\nmax_accel: 2000\n');
});

test('CodeMirror edits preserve BOM, CRLF, comments and the protected suffix through reviewed save', async () => {
	const text = '\uFEFF[printer]\r\nmax_velocity: 200 # keep\r\n' + tail.replace(/\n/g, '\r\n');
	const doc = file('printer.cfg', text);
	const calls = callbacks(doc);
	const screen = await render(ConfigurationEditor, { document: doc, files: [doc], ...calls });
	await screen.getByRole('button', { name: 'Raw source', exact: true }).click();
	await screen
		.getByRole('textbox', { name: 'Editable configuration source' })
		.fill(text.replace(/\r\n/g, '\n').split('\n#*#')[0]!.replace('200 #', '180 #'));
	await screen.getByRole('button', { name: 'Review changes…' }).click();
	await screen.getByRole('checkbox', { name: 'I reviewed the source changes.' }).click();
	await screen.getByRole('button', { name: 'Save simulator file' }).click();
	expect(calls.onSave).toHaveBeenCalledWith(
		expect.objectContaining({ text: text.replace('200 #', '180 #') })
	);
});
test('calibration staging preserves other edits and uses the existing reviewed save', async () => {
	const doc = file(
		'printer.cfg',
		'[extruder]\nrotation_distance: 7.5 # keep\ngear_ratio: 50:10\n[printer]\nmax_velocity: 200\n' +
			tail
	);
	const calls = callbacks(doc);
	const screen = await render(ConfigurationEditor, {
		document: doc,
		files: [doc],
		...calls,
		calibrationProposal: {
			id: 'proposal',
			ownerId: 'owner',
			source: 'simulator',
			createdAt: Date.now(),
			measurement: {
				rotationDistance: 7.5,
				before: 70,
				after: 22,
				actual: 48,
				proposed: 7.2,
				repeat: false
			}
		}
	});
	await screen.getByRole('spinbutton', { name: 'Maximum velocity', exact: true }).fill('180');
	await screen.getByRole('checkbox', { name: /repeated the measurement/ }).click();
	await screen.getByRole('button', { name: 'Add to this draft' }).click();
	await expect
		.element(screen.getByRole('spinbutton', { name: 'Extruder rotation distance', exact: true }))
		.toHaveValue(7.2);
	await expect
		.element(screen.getByRole('spinbutton', { name: 'Maximum velocity', exact: true }))
		.toHaveValue(180);
	expect(calls.onSave).not.toHaveBeenCalled();
	await screen.getByRole('button', { name: 'Review changes…' }).click();
	await screen.getByRole('checkbox', { name: 'I reviewed the source changes.' }).click();
	await screen.getByRole('button', { name: 'Save simulator file' }).click();
	expect(calls.onSave).toHaveBeenCalledWith(
		expect.objectContaining({
			expectedVersion: 'original',
			text: doc.text.replace('7.5', '7.200').replace('200\n', '180\n')
		})
	);
});

test('unsupported files open as source and explicit editor choices stay with each file', async () => {
	const printer = file();
	const macro = file('macros.cfg', '[gcode_macro LOAD]\ngcode:\n  M105\n');
	const other = file('machine.cfg');
	const screen = await render(ConfigurationEditor, {
		document: printer,
		files: [printer, macro, other],
		...callbacks(printer)
	});
	await screen.getByRole('button', { name: 'Raw source', exact: true }).click();
	await screen.rerender({ document: macro });
	await expect
		.element(screen.getByRole('button', { name: 'Raw source', exact: true }))
		.toHaveAttribute('aria-pressed', 'true');
	await expect
		.element(screen.getByRole('button', { name: 'Explained settings', exact: true }))
		.toBeDisabled();
	await screen.getByRole('button', { name: 'Edit LOAD · line 1', exact: true }).click();
	await expect
		.element(screen.getByRole('textbox', { name: 'Editable configuration source', exact: true }))
		.toBeVisible();
	await screen.rerender({ document: other });
	await expect
		.element(screen.getByRole('button', { name: 'Explained settings', exact: true }))
		.toHaveAttribute('aria-pressed', 'true');
	await screen.rerender({ document: printer });
	await expect
		.element(screen.getByRole('button', { name: 'Raw source', exact: true }))
		.toHaveAttribute('aria-pressed', 'true');
});

test('saved Klipper revisions open read-only and file search keeps the current editor', async () => {
	const printer = file();
	const revision = {
		...file('printer-20261018_123456.cfg'),
		backups: [{ id: 'older', createdAt: 1, actor: 'Fixture' }]
	};
	const other = file('macros/tool.cfg');
	const calls = callbacks(revision);
	const screen = await render(ConfigurationEditor, {
		document: revision,
		files: [printer, revision, other],
		...calls
	});
	await expect.element(screen.getByText(/Read-only saved revision of/)).toBeVisible();
	await screen.getByRole('combobox', { name: 'Backup', exact: true }).selectOptions('older');
	await expect
		.element(screen.getByRole('button', { name: 'Load backup into draft…', exact: true }))
		.toBeDisabled();
	expect(calls.onBackup).not.toHaveBeenCalled();
	await expect
		.element(screen.getByRole('textbox', { name: 'Editable configuration source', exact: true }))
		.toHaveAttribute('contenteditable', 'false');
	await expect
		.element(screen.getByRole('searchbox', { name: 'Find a file' }))
		.not.toBeInTheDocument();
	await screen.getByRole('button', { name: /Browse files/ }).click();
	await screen.getByRole('searchbox', { name: 'Find a file' }).fill('no matching file');
	await expect.element(screen.getByText('No matching files.', { exact: true })).toBeVisible();
	await expect
		.element(screen.getByRole('heading', { name: revision.path, exact: true }))
		.toBeVisible();
	expect(calls.onSave).not.toHaveBeenCalled();
});

test('a draft newly recognized as a saved revision cannot retain an open save review', async () => {
	const revision = file('printer-20261018_123456.cfg');
	const calls = callbacks(revision);
	const screen = await render(ConfigurationEditor, {
		document: revision,
		files: [revision],
		...calls
	});
	await screen.getByRole('spinbutton', { name: 'Maximum velocity', exact: true }).fill('180');
	await screen.getByRole('button', { name: 'Review changes…', exact: true }).click();
	await expect.element(screen.getByRole('dialog')).toBeVisible();
	await screen.rerender({ files: [revision, file()] });
	await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
	await expect
		.element(screen.getByRole('button', { name: 'Review changes…', exact: true }))
		.toBeDisabled();
	await expect
		.element(screen.getByRole('button', { name: 'Export draft', exact: true }))
		.toBeEnabled();
	expect(calls.onSave).not.toHaveBeenCalled();
});

test('filtering explained settings preserves edits and reviews the complete draft', async () => {
	const doc = file(
		'printer.cfg',
		'[printer]\nmax_velocity: 200\n[extruder]\nrotation_distance: 22\n'
	);
	const calls = callbacks(doc);
	const screen = await render(ConfigurationEditor, { document: doc, files: [doc], ...calls });
	await screen.getByRole('spinbutton', { name: 'Maximum velocity', exact: true }).fill('180');
	await screen
		.getByRole('searchbox', { name: 'Find a setting', exact: true })
		.fill('rotation_distance');
	await expect
		.element(screen.getByRole('spinbutton', { name: 'Maximum velocity', exact: true }))
		.not.toBeInTheDocument();
	await expect
		.element(screen.getByRole('spinbutton', { name: 'Extruder rotation distance', exact: true }))
		.toHaveValue(22);
	await screen.getByRole('button', { name: 'Review changes…' }).click();
	await expect
		.element(screen.getByLabelText('Proposed source'))
		.toHaveTextContent('max_velocity: 180');
	expect(calls.onSave).not.toHaveBeenCalled();
});
