import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const target = 'src/lib/editor/jinja/parser.ts';
execFileSync(
	'pnpm',
	['exec', 'lezer-generator', 'src/lib/editor/jinja/jinja.grammar', '-o', target, '--typeScript'],
	{ stdio: 'inherit' }
);
writeFileSync(
	target,
	readFileSync(target, 'utf8').replace('from "./tokens"', 'from "./tokens.js"')
);
execFileSync('pnpm', ['exec', 'vp', 'fmt', target, 'src/lib/editor/jinja/parser.terms.ts'], {
	stdio: 'inherit'
});
