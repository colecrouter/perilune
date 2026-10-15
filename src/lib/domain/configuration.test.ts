import { expect, it } from 'vite-plus/test';
import {
	checkConfigChange,
	checkConfigText,
	configDiff,
	configFields,
	configParts,
	rawConfigEdit,
	updateConfigField,
	validConfigPath
} from './configuration.js';
const tail =
	'\n#*# <---------------------- SAVE_CONFIG ---------------------->\n#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.\n#*#\n#*# [probe]\n#*# z_offset = 1.2\n';
it('preserves comments, delimiters, CRLF, BOM, macros, includes and generated suffix when replacing a scalar', () => {
	const source = (
		'\uFEFF# Notes\n[include macros.cfg]\n[extruder]\nrotation_distance = 7.5  # measured\n[gcode_macro TEST]\ngcode:\n    {% set n = 1 %}\n    G1 X{n}\n' +
		tail
	).replace(/\n/g, '\r\n');
	const edited = updateConfigField(source, 'extruder.rotation_distance', '7.2');
	expect(edited).toBe(source.replace('7.5  # measured', '7.2  # measured'));
	expect(configParts(edited).generated).toBe(configParts(source).generated);
	expect(configParts(source).warning).toBeNull();
	checkConfigChange(source, edited);
});
it('protects the complete generated tail and diagnoses text after it without silently repairing', () => {
	const source = '[printer]\nmax_velocity: 200\n' + tail;
	expect(() => checkConfigChange(source, source.replace('z_offset = 1.2', 'z_offset = 0'))).toThrow(
		'unchanged'
	);
	expect(() => checkConfigChange(source, source.replace(tail, ''))).toThrow('unchanged');
	expect(() => checkConfigChange('plain\n', 'plain\n' + tail)).toThrow('unchanged');
	expect(configParts(source + '# trailing note\n').warning).toContain('ordinary text');
	expect(configParts(source + '[include extra.cfg]\n').generated).toBe(
		tail + '[include extra.cfg]\n'
	);
});
it('leaves duplicates, expressions, and multiline fields to raw source', () => {
	for (const source of [
		'[printer]\nmax_velocity: 100\nmax_velocity: 200\n',
		'[printer]\nmax_velocity: 100\n[printer]\nmax_accel: 20\n',
		'[printer]\nmax_velocity: 100\n    200\n',
		'[printer]\nmax_velocity: 100\n# note\n\n    200\n',
		'[printer]\nmax_velocity: {velocity}\n'
	])
		expect(configFields(source).every((f) => !f.editable)).toBe(true);
	expect(() =>
		updateConfigField(
			'[printer]\nmax_velocity: 100\nmax_velocity: 200\n',
			'printer.max_velocity',
			'300'
		)
	).toThrow('ambiguous');
	expect(() =>
		updateConfigField('[printer]\nmax_velocity: 100\n', 'printer.max_velocity', '-1')
	).toThrow('between');
});
it('applies minimal textarea changes without normalizing untouched CRLF or mixed endings', () => {
	for (const source of ['a\r\nb\r\nc\r\n', 'a\nb\nc\n', 'a\r\nb\nc\r\n', '\uFEFFa\r\nb']) {
		expect(rawConfigEdit(source, source.replace(/\r\n/g, '\n'))).toBe(source);
		expect(rawConfigEdit(source, source.replace(/\r\n/g, '\n').replace('b', 'bee'))).toBe(
			source.replace('b', 'bee')
		);
	}
	expect(rawConfigEdit('a\r\nb\r\n', 'a\nnew\nb\n')).toBe('a\r\nnew\r\nb\r\n');
});
it('bounds paths, encoding and diff work while supporting opaque YAML source', () => {
	for (const path of ['printer.cfg', 'nested/macros.cfg', 'notes.yaml', 'machine.conf'])
		expect(validConfigPath(path)).toBe(true);
	for (const path of [
		'../printer.cfg',
		'a/../b.cfg',
		'/printer.cfg',
		'a//b.cfg',
		'a\\b.cfg',
		'%2e%2e/printer.cfg',
		'a/.secret.cfg',
		'printer.cfg?x'
	])
		expect(validConfigPath(path)).toBe(false);
	expect(() => checkConfigText('a\0b')).toThrow();
	expect(() => checkConfigText('x'.repeat(256 * 1024 + 1))).toThrow();
	expect(() => checkConfigText('\ud800')).toThrow();
	expect(configFields('foo:\n  value: 12\n')).toEqual([]);
	expect(configDiff('a\nb\nc', 'a\nx\nc')).toMatchObject({
		line: 2,
		removed: ['b'],
		added: ['x'],
		truncated: false
	});
	expect(configDiff('x\n'.repeat(1000), 'y\n'.repeat(1000))).toMatchObject({ truncated: true });
});
