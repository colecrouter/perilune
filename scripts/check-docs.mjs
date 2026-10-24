import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const files = [
	'README.md',
	'CONTRIBUTING.md',
	...(await readdir('docs')).filter((name) => name.endsWith('.md')).map((name) => 'docs/' + name)
];
const errors = [];
for (const file of files) {
	const text = await readFile(file, 'utf8');
	for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
		const href = match[1].replace(/^<|>$/g, '').split('#')[0];
		if (!href || /^(?:https?:|mailto:|\/)/.test(href)) continue;
		try {
			await access(resolve(dirname(file), decodeURIComponent(href)));
		} catch {
			errors.push(`${file}: missing ${href}`);
		}
	}
}
if (errors.length) throw Error(errors.join('\n'));
console.log(`Documentation local links checked across ${files.length} guides.`);
