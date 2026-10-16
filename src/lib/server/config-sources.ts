import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { configParts, validConfigPath, type ConfigDocument } from '#lib/domain/configuration.js';
import type { ConfigSources, SettingOrigin } from '#lib/domain/config-sources.js';
/** Deliberately limited glob dialect: unsupported patterns fail closed. */
function matches(pattern: string, path: string) {
	if (/[\[\]{}\\]/.test(pattern))
		throw new Error('This include pattern needs manual source review.');
	const segments = pattern.split('/'),
		names = path.split('/');
	return (
		segments.length === names.length &&
		segments.every((part, i) => {
			const name = names[i]!;
			if (name.startsWith('.') && !part.startsWith('.')) return false;
			const expression = part
				.split('')
				.map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^$()|]/g, '\\$&')))
				.join('');
			return new RegExp('^' + expression + '$').test(name);
		})
	);
}
export async function resolveConfigSources(
	root: string,
	paths: string[],
	read: (path: string) => Promise<ConfigDocument>
): Promise<ConfigSources> {
	if (!validConfigPath(root)) throw new Error('Choose a supported main configuration file.');
	const cache = new Map<string, ConfigDocument>();
	const definitions: SettingOrigin[] = [];
	let bytes = 0,
		visits = 0;
	const visit = async (path: string, parents: string[], generated = false) => {
		if (parents.includes(path))
			throw new Error('Configuration includes contain a cycle. Review the source manually.');
		if (parents.length >= 16 || ++visits > 128)
			throw new Error('Configuration includes exceed the review limit.');
		let document = cache.get(path);
		if (!document) {
			document = await read(path);
			bytes += Buffer.byteLength(document.text);
			if (bytes > 4 * 1024 * 1024 || cache.size >= 64)
				throw new Error('Configuration sources exceed the review limit.');
			cache.set(path, document);
		}
		const parts = configParts(document.text);
		if (parts.warning)
			throw new Error('Resolve the generated configuration warning before source review.');
		let section = '',
			previous: SettingOrigin | undefined;
		let previousIndent = -1;
		const lines = generated
			? parts.generated.split('\n').map((line) => (line.startsWith('#*# ') ? line.slice(4) : ''))
			: parts.editable.split('\n');
		for (let index = 0; index < lines.length; index++) {
			const line = lines[index]!.split('#', 1)[0]!.trimEnd();
			if (!line.trim() || line.trimStart().startsWith(';')) continue;
			if (generated && index < 3) continue;
			const header = /^\s*\[([^\]]+)\]\s*(?:;.*)?$/.exec(line);
			if (line.search(/\S/) > previousIndent && previous && !header?.[1]?.startsWith('include ')) {
				previous.multiline = true;
				previous.value += '\n' + line.trim();
				continue;
			}
			if (header) {
				previous = undefined;
				if (header[1]!.startsWith('include ')) {
					if (generated)
						throw new Error('Includes inside generated settings require manual review.');
					const spec = header[1]!.slice(8).trim();
					if (!spec || spec.startsWith('/') || spec.includes('\\'))
						throw new Error('Includes outside the configuration folder require manual review.');
					const pattern = posix.normalize(posix.join(posix.dirname(path), spec));
					if (pattern.startsWith('../') || pattern === '..')
						throw new Error('Includes outside the configuration folder require manual review.');
					const included = paths.filter((candidate) => matches(pattern, candidate)).sort();
					if (!included.length && !/[*?]/.test(pattern))
						throw new Error('An included configuration file is missing or unsupported.');
					for (const child of included) await visit(child, [...parents, path]);
					section = '';
				} else section = header[1]!;
				continue;
			}
			if (line.search(/\S/) > previousIndent && previous) {
				previous.multiline = true;
				previous.value += '\n' + line.trim();
				continue;
			}
			const field = /^\s*([^:=\s]+)\s*[:=]\s*(.*?)\s*(?:;.*)?$/.exec(line);
			if (!section || !field)
				throw new Error('Unrecognized configuration syntax requires manual source review.');
			previousIndent = line.search(/\S/);
			previous = {
				path,
				line: index + 1 + (generated ? parts.editable.split('\n').length - 1 : 0),
				section,
				option: field[1]!.toLowerCase(),
				value: field[2]!,
				generated,
				multiline: false
			};
			definitions.push(previous);
		}
	};
	await visit(root, []);
	// Klipper regular settings override matching autosave entries, regardless of location.
	const regular = new Set(definitions.map((d) => d.section + '\0' + d.option));
	const beforeGenerated = definitions.length;
	await visit(root, [], true);
	const filtered = definitions.filter(
		(d, i) => i < beforeGenerated || !regular.has(d.section + '\0' + d.option)
	);
	const dependencies = [...cache.values()]
		.map((d) => ({ path: d.path, version: d.version }))
		.sort((a, b) => a.path.localeCompare(b.path));
	const fingerprint = createHash('sha256')
		.update(JSON.stringify({ root, dependencies, definitions: filtered }))
		.digest('hex');
	return { root, fingerprint, dependencies, definitions: filtered };
}
