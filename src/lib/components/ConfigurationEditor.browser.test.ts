import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import ConfigurationEditor from './ConfigurationEditor.svelte';
import { configParts, type ConfigDocument } from '#lib/domain/configuration.js';
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
		.element(screen.getByRole('textbox', { name: 'Editable configuration source' }))
		.toHaveValue('[printer]\nmax_velocity: 180 # keep\n');
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
		.element(screen.getByRole('textbox', { name: 'Editable configuration source' }))
		.toHaveValue('[gcode_macro EXAMPLE]\ngcode:\n    G28\n');
	await screen.rerender({
		document: { ...doc, version: 'newer', text: doc.text.replace('200', '250') }
	});
	await expect
		.element(screen.getByRole('textbox', { name: 'Editable configuration source' }))
		.toHaveValue('[printer]\nmax_velocity: 180 # mine\n');
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
		.element(screen.getByRole('textbox', { name: 'Editable configuration source' }))
		.toHaveValue('[printer]\nmax_velocity: 200\nmax_accel: 2000\n');
});
