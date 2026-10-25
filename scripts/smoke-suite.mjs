import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// Each group runs serially; CI gives groups separate runners and isolated ports/data.
const groups = {
	platform: [
		'test:smoke',
		'test:smoke:live',
		'test:smoke:camera',
		'test:smoke:auth',
		'test:smoke:account-email',
		'test:smoke:readiness'
	],
	calibration: ['test:smoke:calibration', 'test:smoke:mesh-probe', 'test:smoke:live-mesh'],
	workspaces: ['test:smoke:jobs', 'test:smoke:extrusion', 'test:smoke:configuration'],
	actions: ['test:smoke:console', 'test:smoke:progressive', 'test:smoke:live-actions']
};
const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const listed = Object.values(groups).flat();
const expected = Object.keys(scripts).filter((name) => /^test:smoke(?::|$)/.test(name));
if (
	new Set(listed).size !== listed.length ||
	listed.length !== expected.length ||
	expected.some((name) => !listed.includes(name)) ||
	listed.some((name) => !/^node scripts\/smoke[\w-]*\.mjs$/.test(scripts[name] ?? ''))
)
	throw new Error('Every production smoke script must belong to exactly one CI group.');
const selected = process.argv[2] ?? 'all';
if (selected === '--check') {
	console.log(`Smoke inventory: ${listed.length} suites in ${Object.keys(groups).length} groups.`);
} else {
	if (selected !== 'all' && !Object.hasOwn(groups, selected))
		throw new Error(`Unknown smoke group: ${selected}`);
	for (const name of selected === 'all' ? listed : groups[selected]) {
		console.log(`\nRunning ${name}`);
		const status = await new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [scripts[name].slice('node '.length)], {
				stdio: 'inherit'
			});
			child.once('error', reject);
			child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
		});
		if (status !== 0) {
			process.exitCode = status;
			break;
		}
	}
}
