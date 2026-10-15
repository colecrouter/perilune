import { expect, test } from 'vite-plus/test';
import { propertyAt } from './property-help.js';
import { helpFixture } from './property-help.fixture.js';

test('help identifies only property keys in the appropriate local context', () => {
	const text = '\uFEFF[printer]\nkinematics: cartesian\nmax_z_velocity: 10 # max_velocity\n';
	const pos = text.indexOf('max_z_velocity');
	expect(propertyAt(text, pos + 2, helpFixture)?.option.description).toBe(
		'Cartesian vertical speed.'
	);
	expect(propertyAt(text, text.indexOf('10'), helpFixture)).toBeNull();
	expect(propertyAt(text, text.indexOf('# max_velocity') + 3, helpFixture)).toBeNull();
	const delta = text.replace('cartesian', 'delta');
	expect(propertyAt(delta, delta.indexOf('max_z_velocity'), helpFixture)?.option.description).toBe(
		'Delta vertical speed.'
	);
});
test('unknown context, duplicate sections, macro continuation and unrelated sections do not invent help', () => {
	for (const text of [
		'[printer]\nmax_z_velocity: 10\n',
		'[printer]\nmax_velocity: 10\n[printer]\n',
		'[gcode_macro TEST]\ngcode:\n  max_velocity: 10\n',
		'[extruder]\nmax_velocity: 10\n',
		'# max_velocity: 10\n'
	]) {
		expect(propertyAt(text, text.indexOf('max_') + 2, helpFixture)).toBeNull();
	}
});
