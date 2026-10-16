import { expect, it } from 'vite-plus/test';
import {
	pendingConfigurationText,
	pendingManifest,
	pendingFingerprint
} from './pending-configuration.js';
import { resolveConfigSources } from './config-sources.js';
const sources = (texts: Record<string, string>) =>
	resolveConfigSources('printer.cfg', Object.keys(texts), async (path) => ({
		path,
		text: texts[path]!,
		version: texts[path]!,
		updatedAt: 0,
		source: 'simulator',
		backups: []
	}));
it('predicts the source-preserving Klipper autosave format with untouched comments', async () => {
	const before = '# keep this\n[probe]\nz_offset: 1.0 # prior\n\n[printer]\nmax_velocity: 200\n';
	const after = pendingConfigurationText(before, await sources({ 'printer.cfg': before }), {
		probe: { z_offset: '1.250' }
	});
	expect(after).toBe(
		'# keep this\n[probe]\n#z_offset: 1.0 # prior\n\n[printer]\nmax_velocity: 200\n\n#*# <---------------------- SAVE_CONFIG ---------------------->\n#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.\n#*#\n#*# [probe]\n#*# z_offset = 1.250\n'
	);
});
it('preserves existing generated settings and refuses include conflicts', async () => {
	const before = '[include probe.cfg]\n';
	await expect(
		sources({ 'printer.cfg': before, 'probe.cfg': '[probe]\nz_offset: 1\n' }).then((s) =>
			pendingConfigurationText(before, s, { probe: { z_offset: '1.25' } })
		)
	).rejects.toThrow('included file');
});
it('reviews the complete manifest deterministically and refuses removals', () => {
	expect(
		pendingFingerprint({ probe: { z_offset: '1' }, extruder: { rotation_distance: '7' } })
	).toBe(pendingFingerprint({ extruder: { rotation_distance: '7' }, probe: { z_offset: '1' } }));
	expect(() => pendingManifest({ probe: null })).toThrow('removal');
	expect(() => pendingManifest({})).toThrow('no pending');
});
