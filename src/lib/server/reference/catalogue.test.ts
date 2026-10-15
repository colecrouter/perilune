import { expect, it } from 'vite-plus/test';
import { createHash } from 'node:crypto';
import { buildReference } from './catalogue.js';
import snapshot from './Config_Reference.md?raw';
import source from './source.json';
import {
	isReferenceCatalogue,
	parseKlipperReference,
	referenceMatches
} from '#lib/domain/klipper-reference.js';
it('extracts pinned documentation with distinct kinematic variants and original defaults prose', async () => {
	const catalogue = await buildReference(async () => new Response(snapshot));
	expect(isReferenceCatalogue(catalogue)).toBe(true);
	expect(catalogue.options.length).toBeGreaterThan(500);
	const variants = catalogue.options.filter(
		(o) => o.section === 'printer' && o.key === 'max_z_velocity'
	);
	expect(
		variants.some((o) => o.context === 'cartesian' && o.description.includes('max_velocity'))
	).toBe(true);
	expect(variants.some((o) => o.context === 'delta')).toBe(true);
	expect(variants.every((o) => o.context !== null)).toBe(true);
	const corner = catalogue.options.find(
		(o) => o.section === 'printer' && o.key === 'square_corner_velocity' && o.context === null
	)!;
	expect(corner.exampleValue).toBe('5.0');
	expect(corner.commented).toBe(true);
	expect(corner.description).toContain('default');
	expect(
		referenceMatches(
			variants.find((o) => o.context === 'cartesian')!,
			'printer',
			'delta'
		)
	).toBe(false);
});
it('network failures, changed bytes, and oversized upstream bodies yield identical verified snapshot output', async () => {
	const expected = parseKlipperReference(snapshot, source);
	for (const fetcher of [
		async () => {
			throw new Error('offline');
		},
		async () => new Response('untrusted different content'),
		async () => new Response('x'.repeat(512 * 1024 + 1))
	])
		expect(await buildReference(fetcher)).toEqual(expected);
	expect(createHash('sha256').update(snapshot).digest('hex')).toBe(source.sha256);
});
it('parses descriptive blocks without inferring requirements, default values, or merging repeated options', () => {
	const text =
		'### Cartesian Kinematics\n```\n[printer]\nkinematics: cartesian\n#max_z_velocity:\n#   The default is max_velocity if unspecified.\n```\n### Linear Delta Kinematics\n```\n[printer]\nkinematics: delta\nmax_z_velocity:\n#   Conditional description.\n```';
	const result = parseKlipperReference(text, source);
	expect(result.options.filter((o) => o.key === 'max_z_velocity').map((o) => o.context)).toEqual([
		'cartesian',
		'delta'
	]);
	expect(result.options[1]).not.toHaveProperty('default');
	expect(result.options[1]).not.toHaveProperty('required');
	expect(() => parseKlipperReference('```\n[printer]\nmax_velocity:', source)).toThrow('complete');
});
