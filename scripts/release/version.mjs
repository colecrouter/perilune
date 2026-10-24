import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
export const version = JSON.parse(
	readFileSync(new URL('../../package.json', import.meta.url))
).version;
export function releaseVersion(tag) {
	if (!/^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(tag) || tag !== `v${version}`)
		throw Error('Release tag must match package.json: v' + version);
	return { version, prerelease: version.includes('-') };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
	const tag = process.argv[2];
	const info = releaseVersion(tag);
	const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	execFileSync('git', ['merge-base', '--is-ancestor', revision, 'origin/main']);
	console.log(JSON.stringify({ ...info, revision }));
}
