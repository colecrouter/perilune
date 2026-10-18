import type { ConfigFile } from './configuration.js';

const order = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
/** Klipper SAVE_CONFIG's timestamp convention; a matching base file must exist. */
export function configRevision(path: string, files: readonly ConfigFile[]) {
	const match = /^(.*)-(\d{8}_\d{6})\.cfg$/.exec(path);
	const current = match ? `${match[1]}.cfg` : null;
	return current && files.some((file) => file.path === current) ? current : null;
}
export function configFileIndex(files: readonly ConfigFile[], query = '') {
	const needle = query.trim().toLowerCase();
	const folders = new Map<string, ConfigFile[]>();
	const revisions = new Map<string, ConfigFile[]>();
	for (const file of files) {
		const revision = configRevision(file.path, files);
		if (
			needle &&
			!file.path.toLowerCase().includes(needle) &&
			!revision?.toLowerCase().includes(needle)
		)
			continue;
		if (revision) {
			const list = revisions.get(revision) ?? [];
			list.push(file);
			revisions.set(revision, list);
		} else {
			const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
			const list = folders.get(folder) ?? [];
			list.push(file);
			folders.set(folder, list);
		}
	}
	return {
		folders: [...folders]
			.sort(([a], [b]) => order(a, b))
			.map(([path, files]) => ({ path, files: files.sort((a, b) => order(a.path, b.path)) })),
		revisions: [...revisions]
			.sort(([a], [b]) => order(a, b))
			.map(([current, files]) => ({ current, files: files.sort((a, b) => order(b.path, a.path)) }))
	};
}
/** A source navigation aid only; definitions are not executed or rewritten. */
export function configMacros(text: string) {
	const result: { name: string; line: number }[] = [];
	for (const [index, line] of text.split('\n').entries()) {
		const match = /^\s*\[gcode_macro ([^\]\r\n]+)\]\s*(?:[#;].*)?$/i.exec(line);
		if (match) result.push({ name: match[1]!.trim(), line: index + 1 });
	}
	return result;
}
