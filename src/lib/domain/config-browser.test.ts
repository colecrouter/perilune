import { expect, test } from 'vite-plus/test';
import { configFileIndex, configRevision, configMacros } from './config-browser.js';
const files = [
	'printer.cfg',
	'printer-20261018_123456.cfg',
	'printer-20261017_123456.cfg',
	'macros/tool2.cfg',
	'macros/tool10.cfg',
	'orphan-20261018_123456.cfg'
].map((path) => ({ path, version: '1', updatedAt: 0 }));
test('groups actual Klipper-named revisions with an existing base and sorts folders naturally', () => {
	const index = configFileIndex(files);
	expect(index.revisions[0]?.current).toBe('printer.cfg');
	expect(index.revisions[0]?.files[0]?.path).toBe('printer-20261018_123456.cfg');
	expect(
		index.folders.find((folder) => folder.path === 'macros')?.files.map((file) => file.path)
	).toEqual(['macros/tool2.cfg', 'macros/tool10.cfg']);
	expect(configRevision('orphan-20261018_123456.cfg', files)).toBeNull();
	expect(configFileIndex(files, 'PRINTER').revisions[0]?.files).toHaveLength(2);
	expect(configFileIndex(files, 'absent')).toEqual({ folders: [], revisions: [] });
});
test('macro navigation uses definition lines and ignores comments and generated settings', () => {
	expect(
		configMacros(
			'# [gcode_macro COMMENT]\n[gcode_macro LOAD] # label\ngcode:\n  M105\n#*# [gcode_macro OLD]\n[gcode_macro UNLOAD]\n'
		)
	).toEqual([
		{ name: 'LOAD', line: 2 },
		{ name: 'UNLOAD', line: 6 }
	]);
});
