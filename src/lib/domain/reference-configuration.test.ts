import { expect, it } from 'vite-plus/test';
import {
	addReferenceOption,
	referenceInventory,
	referencePresence
} from './reference-configuration.js';
import { configParts } from './configuration.js';
import type { ReferenceOption } from './klipper-reference.js';
const option: ReferenceOption = {
	id: 'test',
	section: 'printer',
	key: 'max_z_velocity',
	heading: 'Cartesian Kinematics',
	anchor: 'cartesian-kinematics',
	context: 'cartesian',
	exampleValue: '',
	commented: false,
	description: 'The default uses max_velocity.',
	line: 1
};
const tail =
	'\n#*# <---------------------- SAVE_CONFIG ---------------------->\n#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.\n#*#\n#*# [printer]\n#*# max_z_velocity = 10\n';
it('inserts an explicit option in its unique existing section without normalizing source', () => {
	const source =
		'\uFEFF# notes\r\n[printer]\r\nkinematics: cartesian\r\nmax_velocity: 200 # keep\r\n\r\n[extruder]\r\nrotation_distance: 7.5\r\n';
	const next = addReferenceOption(source, 'printer', option, '12', 'cartesian', false);
	expect(next).toBe(source.replace('[extruder]', 'max_z_velocity: 12\r\n[extruder]'));
	expect(referencePresence(next, 'printer', option.key)).toBe('configured');
});
it('counts unknown, blank, indented and multiline source options rather than only curated numeric fields', () => {
	for (const value of ['12', '{variable}', '\n    12', ''])
		expect(referencePresence(`[printer]\nmax_z_velocity: ${value}\n`, 'printer', option.key)).toBe(
			'configured'
		);
	expect(referencePresence('[printer]\n  max_z_velocity = 12\n', 'printer', option.key)).toBe(
		'configured'
	);
	expect(referencePresence('[printer]\n#max_z_velocity: 12\n', 'printer', option.key)).toBe(
		'not-local'
	);
});
it('does not claim include-supplied values are absent and requires explicit include review', () => {
	const source = '[include other.cfg]\n[printer]\nkinematics: cartesian\n';
	expect(referencePresence(source, 'printer', option.key)).toBe('check-includes');
	expect(() => addReferenceOption(source, 'printer', option, '12', 'cartesian', false)).toThrow(
		'included'
	);
	expect(addReferenceOption(source, 'printer', option, '12', 'cartesian', true)).toContain(
		'max_z_velocity: 12'
	);
});
it('rejects generated duplicates, repeated/indented sections, wrong contexts, multiline or empty additions', () => {
	const source = '[printer]\nkinematics: cartesian\n';
	expect(referencePresence(source + tail, 'printer', option.key)).toBe('generated');
	expect(() =>
		addReferenceOption(source + tail, 'printer', option, '12', 'cartesian', true)
	).toThrow('already exists');
	for (const text of [source + '[printer]\n', '  [printer]\n'])
		expect(() => addReferenceOption(text, 'printer', option, '12', 'cartesian', true)).toThrow(
			'ambiguous'
		);
	expect(() => addReferenceOption(source, 'printer', option, '12', 'delta', true)).toThrow(
		'context'
	);
	for (const value of ['', '\n', '12\nother: value', '# no value'])
		expect(() => addReferenceOption(source, 'printer', option, value, 'cartesian', true)).toThrow(
			'explicit'
		);
});
it('keeps the protected generated suffix unchanged when adding another key and reports local context only', () => {
	const source = '[printer]\nkinematics: cartesian\n' + tail.replace('max_z_velocity', 'max_accel');
	const next = addReferenceOption(source, 'printer', option, '12', 'cartesian', true);
	expect(configParts(next).generated).toBe(configParts(source).generated);
	expect(referenceInventory(source).kinematics).toBe('cartesian');
});
