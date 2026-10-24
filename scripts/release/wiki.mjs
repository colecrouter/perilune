import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
export const wikiPages = {
	README: 'Home',
	'getting-started': 'Installation',
	upgrading: 'Upgrading',
	'configuration-options': 'Installation-settings',
	deployment: 'Deployment',
	overview: 'Overview',
	jobs: 'Jobs-and-slicers',
	'camera-setup': 'Cameras',
	'camera-compatibility': 'Camera-compatibility',
	'bed-mesh': 'Bed-mesh',
	calibration: 'Calibration',
	'pid-calibration': 'PID-calibration',
	'filament-changes': 'Filament-changes',
	configuration: 'Configuration',
	'configuration-intelligence': 'Configuration-editor',
	console: 'Console',
	accounts: 'Accounts',
	'account-email': 'Accounts-and-email',
	notifications: 'Notifications',
	preferences: 'Preferences',
	'live-controls': 'Live-controls',
	actions: 'Action-receipts',
	recovery: 'Recovery',
	acceptance: 'Alpha-acceptance',
	development: 'Development'
};
const repository = 'https://github.com/colecrouter/perilune';
export function renderWikiPage(text, ref) {
	const target = (url) => {
		if (/^(?:[a-z]+:|#|\/)/i.test(url)) return url;
		const [path, ...anchor] = url.split('#');
		const source = posix.normalize(posix.join('docs', path));
		const stem = posix.basename(source, '.md');
		const suffix = anchor.length ? '#' + anchor.join('#') : '';
		if (source === `docs/${stem}.md` && wikiPages[stem]) return wikiPages[stem] + suffix;
		if (source.startsWith('docs/images/'))
			return `https://raw.githubusercontent.com/colecrouter/perilune/${ref}/${source}` + suffix;
		return `${repository}/blob/${ref}/${source}` + suffix;
	};
	return text
		.replace(
			/(!?\[[^\]]*\]\()([^\s)]+)(\))/g,
			(_, before, url, after) => before + target(url) + after
		)
		.replace(/src="([^"]+)"/g, (_, url) => `src="${target(url)}"`);
}
export async function buildWiki(ref, output) {
	if (!/^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(ref))
		throw Error('Use an explicit release tag.');
	const read = (path) =>
		execFileSync('git', ['show', `refs/tags/${ref}:${path}`], { encoding: 'utf8' });
	if ('v' + JSON.parse(read('package.json')).version !== ref)
		throw Error('Tag/package version mismatch.');
	// Resolve every source before touching the Wiki checkout.
	const pages = Object.entries(wikiPages).map(([source, page]) => [
		page,
		renderWikiPage(read(`docs/${source}.md`), ref)
	]);
	await mkdir(output, { recursive: true });
	for (const [page, text] of pages) await writeFile(resolve(output, page + '.md'), text);
	await writeFile(
		resolve(output, '_Sidebar.md'),
		'**Perilune**\n\n' +
			pages.map(([page]) => `- [${page.replaceAll('-', ' ')}](${page})`).join('\n') +
			'\n'
	);
	await writeFile(
		resolve(output, '_Footer.md'),
		`Guides for **${ref}** · [Release](${repository}/releases/tag/${ref}) · [Versioned source](${repository}/tree/${ref}/docs) · [Report an issue](${repository}/issues/new)\n`
	);
	console.log(
		`Prepared ${pages.length} Wiki pages for ${ref}. Existing unrelated pages were retained.`
	);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const [ref, output] = process.argv.slice(2);
	if (!ref || !output)
		throw Error('Usage: node scripts/release/wiki.mjs vVERSION /path/to/wiki-checkout');
	await buildWiki(ref, output);
}
