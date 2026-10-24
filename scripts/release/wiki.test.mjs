import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWikiPage, buildWiki } from './wiki.mjs';
test('Wiki links retain anchors, images use immutable tag URLs and developer links stay versioned', () => {
	const output = renderWikiPage(
		'[Install](getting-started.md#connect) ![Mesh](images/bed-mesh.png) <img src="images/overview-mobile.png" /> [Architecture](architecture.md) [Contribute](../CONTRIBUTING.md) [External](https://example.test/a) [Local](#here)',
		'v0.1.0-alpha.2'
	);
	assert.match(output, /\(Installation#connect\)/);
	assert.match(
		output,
		/raw.githubusercontent.com\/colecrouter\/perilune\/v0.1.0-alpha.2\/docs\/images\/bed-mesh.png/
	);
	assert.match(output, /blob\/v0.1.0-alpha.2\/CONTRIBUTING.md/);
	assert.match(output, /blob\/v0.1.0-alpha.2\/docs\/architecture.md/);
	assert.match(output, /\[Local\]\(#here\)/);
	assert.match(output, /\(https:\/\/example.test\/a\)/);
});
test('Wiki publication refuses branch names and shell-like input', async () => {
	await assert.rejects(buildWiki('main', '/tmp/unused-wiki-output'), /explicit release tag/);
	await assert.rejects(
		buildWiki('v0.1.0;echo x', '/tmp/unused-wiki-output'),
		/explicit release tag/
	);
});

test('all managed guide sources exist and their rendered Wiki links resolve', async () => {
	const { readFile } = await import('node:fs/promises');
	const { wikiPages } = await import('./wiki.mjs');
	const pages = new Set(Object.values(wikiPages));
	for (const source of Object.keys(wikiPages)) {
		const rendered = renderWikiPage(await readFile(`docs/${source}.md`, 'utf8'), 'v0.1.0-alpha.2');
		for (const match of rendered.matchAll(/!?\[[^\]]*\]\(([^\s)]+)\)/g)) {
			const target = match[1].split('#')[0];
			if (!target || /^[a-z]+:/i.test(target)) continue;
			assert(pages.has(target), `${source}: unknown Wiki target ${target}`);
		}
	}
});
