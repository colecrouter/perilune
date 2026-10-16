import { expect, it } from 'vite-plus/test';
import { resolveConfigSources } from './config-sources.js';
import { effectiveSetting } from '#lib/domain/config-sources.js';
import type { ConfigDocument } from '#lib/domain/configuration.js';
const fixture = (texts: Record<string, string>) =>
	resolveConfigSources('printer.cfg', Object.keys(texts), async (path) => {
		if (!(path in texts)) throw Error('missing');
		return {
			path,
			text: texts[path]!,
			version: texts[path]!,
			updatedAt: 0,
			source: 'simulator',
			backups: []
		} satisfies ConfigDocument;
	});
it('resolves nested includes inline with sorted globs and preserves overridden origins', async () => {
	const sources = await fixture({
		'printer.cfg':
			'[extruder]\nrotation_distance: 7\n[include parts/*.cfg]\n[extruder]\npressure_advance: .03\n',
		'parts/b.cfg': '[extruder]\nrotation_distance: 9\n',
		'parts/a.cfg': '[include nested/tool.cfg]\n',
		'parts/nested/tool.cfg': '[extruder]\nrotation_distance: 8\n'
	});
	expect(effectiveSetting(sources, 'extruder', 'rotation_distance')).toMatchObject({
		path: 'parts/b.cfg',
		line: 2,
		value: '9'
	});
	expect(
		sources.definitions.filter((d) => d.option === 'rotation_distance').map((d) => d.value)
	).toEqual(['7', '8', '9']);
});
it('fingerprints include membership and changed dependencies, even identical effective values', async () => {
	const texts = { 'printer.cfg': '[include *.cfg]\n' };
	await expect(fixture(texts)).rejects.toThrow('cycle');
	const base = {
		'printer.cfg': '[include parts/*.cfg]\n',
		'parts/a.cfg': '[extruder]\nrotation_distance: 7\n'
	};
	const first = await fixture(base);
	expect((await fixture({ ...base, 'parts/b.cfg': '# added\n' })).fingerprint).not.toBe(
		first.fingerprint
	);
	expect(
		(await fixture({ ...base, 'parts/a.cfg': base['parts/a.cfg'] + '# changed\n' })).fingerprint
	).not.toBe(first.fingerprint);
});
it('fails closed for missing, escaping and unsupported includes', async () => {
	for (const include of ['missing.cfg', '../secret.cfg', '[ab].cfg', '/etc/printer.cfg'])
		await expect(fixture({ 'printer.cfg': `[include ${include}]\n` })).rejects.toThrow();
	await expect(fixture({ 'printer.cfg': '[include empty/*.cfg]\n' })).resolves.toMatchObject({
		definitions: []
	});
});
it('marks multiline values and distinguishes indentation from a new field', async () => {
	const sources = await fixture({
		'printer.cfg':
			'[extruder]\n rotation_distance: 7\n pressure_advance: .04\n[gcode_macro TEST]\ngcode:\n  G1 X1\n  {% if true %}\n  {% endif %}\n'
	});
	expect(effectiveSetting(sources, 'extruder', 'rotation_distance')?.multiline).toBe(false);
	expect(effectiveSetting(sources, 'gcode_macro TEST', 'gcode')?.multiline).toBe(true);
});
it('keeps autosave settings protected and honors regular overrides', async () => {
	const tail =
		'\n#*# <---------------------- SAVE_CONFIG ---------------------->\n#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.\n#*#\n#*# [probe]\n#*# z_offset = 1.200\n';
	expect(
		effectiveSetting(
			await fixture({ 'printer.cfg': '[printer]\nmax_velocity: 200\n' + tail }),
			'probe',
			'z_offset'
		)
	).toMatchObject({ generated: true, value: '1.200' });
	expect(
		effectiveSetting(
			await fixture({ 'printer.cfg': '[probe]\nz_offset: 2\n' + tail }),
			'probe',
			'z_offset'
		)
	).toMatchObject({ generated: false, value: '2' });
});

it('does not treat an indented section inside a multiline value as an effective setting', async () => {
	const sources = await fixture({
		'printer.cfg':
			'[gcode_macro TEST]\ngcode:\n  [extruder]\n  rotation_distance: 99\n[extruder]\nrotation_distance: 7\n'
	});
	expect(sources.definitions.filter((d) => d.section === 'extruder')).toHaveLength(1);
	expect(effectiveSetting(sources, 'extruder', 'rotation_distance')?.value).toBe('7');
});
