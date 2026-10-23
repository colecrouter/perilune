import { createHash } from 'node:crypto';
import { configParts } from '#lib/domain/configuration.js';
import type { ConfigSources } from '#lib/domain/config-sources.js';
export type PendingManifest = Record<string, Record<string, string>>;
export function pendingManifest(value: unknown): PendingManifest {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw Error('Pending calibration details are unavailable.');
	const result: PendingManifest = {};
	for (const [section, options] of Object.entries(value)) {
		if (
			!/^[\w .-]{1,100}$/.test(section) ||
			!options ||
			typeof options !== 'object' ||
			Array.isArray(options)
		)
			throw Error('Section removal or unsupported pending settings require manual review.');
		result[section] = {};
		for (const [key, text] of Object.entries(options)) {
			if (
				!/^[a-zA-Z0-9_]{1,100}$/.test(key) ||
				typeof text !== 'string' ||
				text.length > 65536 ||
				/[\r\0]/.test(text)
			)
				throw Error('Unsupported pending settings require manual review.');
			result[section]![key] = text;
		}
	}
	if (!Object.values(result).some((options) => Object.keys(options).length))
		throw Error('There are no pending calibration changes.');
	if (Buffer.byteLength(JSON.stringify(result)) > 128 * 1024)
		throw Error('Pending settings exceed the review limit.');
	return result;
}
export const pendingFingerprint = (manifest: PendingManifest) =>
	createHash('sha256')
		.update(
			JSON.stringify(
				Object.entries(manifest)
					.sort()
					.map(([s, o]) => [s, Object.entries(o).sort(([a], [b]) => a.localeCompare(b))])
			)
		)
		.digest('hex');
/** Predict Klipper's source-preserving autosave. Exact readback is still required before revert. */
export function pendingConfigurationText(
	before: string,
	sources: ConfigSources,
	pending: PendingManifest,
	removed: string[] = []
) {
	const values = new Map<string, Map<string, string>>();
	for (const origin of sources.definitions.filter(
		(d) => d.generated && !removed.includes(d.section)
	)) {
		if (!values.has(origin.section)) values.set(origin.section, new Map());
		values.get(origin.section)!.set(origin.option, origin.value);
	}
	for (const [section, options] of Object.entries(pending)) {
		if (!values.has(section)) values.set(section, new Map());
		for (const [key, value] of Object.entries(options)) values.get(section)!.set(key, value);
	}
	for (const origin of sources.definitions) {
		if (
			!origin.generated &&
			origin.path !== sources.root &&
			values.get(origin.section)?.has(origin.option)
		)
			throw Error(
				'Pending settings conflict with an included file. Edit the effective source instead of SAVE_CONFIG.'
			);
	}
	let section = '',
		duplicate = false;
	const lines = configParts(before)
		.editable.replace(/\r\n/g, '\n')
		.split('\n')
		.map((line) => {
			const pruned = line.replace(/[#;].*$/, '').trimEnd();
			if (!pruned) return line;
			if (/^\s/.test(pruned)) return duplicate ? '#' + line : line;
			duplicate = false;
			if (pruned.startsWith('[')) {
				section = pruned.slice(1, -1).trim();
				return line;
			}
			const key = pruned.replace(/[^A-Za-z0-9_].*$/, '');
			if (values.get(section)?.has(key)) {
				duplicate = true;
				return '#' + line;
			}
			return line;
		});
	const body = [...values]
		.map(
			([name, options]) =>
				'[' +
				name +
				']\n' +
				[...options].map(([key, value]) => key + ' = ' + value.replace(/\n/g, '\n\t')).join('\n')
		)
		.join('\n\n');
	if (!body) throw Error('There are no generated settings to save.');
	const tail =
		'\n\n#*# <---------------------- SAVE_CONFIG ---------------------->\n#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.\n#*#\n' +
		body
			.split('\n')
			.map((line) => ('#*# ' + line).trim())
			.join('\n') +
		'\n';
	return lines.join('\n').trimEnd() + tail;
}
