import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { releaseVersion } from './version.mjs';
const run = (command, args) =>
	execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const tag = process.env.TAG;
const { version, prerelease } = releaseVersion(tag);
const image = process.env.IMAGE;
if (image !== 'ghcr.io/colecrouter/perilune') throw Error('Unexpected release image repository');
const revision = run('git', ['rev-parse', 'HEAD']);
let manifest;
const existing = spawnSync(
	'docker',
	['buildx', 'imagetools', 'inspect', `${image}:${version}`, '--raw'],
	{ encoding: 'utf8' }
);
if (existing.status === 0) {
	manifest = JSON.parse(existing.stdout);
	if (
		manifest.annotations?.['org.opencontainers.image.revision'] !== revision ||
		manifest.annotations?.['org.opencontainers.image.version'] !== version
	)
		throw Error('Published version belongs to different source; never overwrite it');
} else {
	if (!/not found|manifest unknown|name unknown/i.test(existing.stderr))
		throw Error(existing.stderr || 'Registry inspection failed');
	const sources = ['amd64', 'arm64'].map((arch) =>
		readFileSync(`digests/${arch}.txt`, 'utf8').trim()
	);
	if (sources.some((source) => !new RegExp('^' + image + '@sha256:[a-f0-9]{64}$').test(source)))
		throw Error('Invalid image digest artifact');
	run('docker', [
		'buildx',
		'imagetools',
		'create',
		'--tag',
		`${image}:${version}`,
		'--annotation',
		`index:org.opencontainers.image.version=${version}`,
		'--annotation',
		`index:org.opencontainers.image.revision=${revision}`,
		...sources
	]);
	manifest = JSON.parse(
		run('docker', ['buildx', 'imagetools', 'inspect', `${image}:${version}`, '--raw'])
	);
}
for (const arch of ['amd64', 'arm64'])
	if (
		!manifest.manifests?.some(
			(m) => m.platform?.os === 'linux' && m.platform?.architecture === arch
		)
	)
		throw Error('Missing architecture ' + arch);
const digest = run('docker', [
	'buildx',
	'imagetools',
	'inspect',
	`${image}:${version}`,
	'--format',
	'{{.Manifest.Digest}}'
]);
// GitHub packages start private even when linked to a public repository.
// Verify the consumer path without using the workflow's registry credentials.
const scope = 'repository:colecrouter/perilune:pull';
const tokenResponse = await fetch(
	'https://ghcr.io/token?service=ghcr.io&scope=' + encodeURIComponent(scope)
);
if (!tokenResponse.ok)
	throw Error(
		'Make the GHCR perilune package public in GitHub package settings, then rerun this release.'
	);
const { token } = await tokenResponse.json();
const anonymous = await fetch(`https://ghcr.io/v2/colecrouter/perilune/manifests/${version}`, {
	headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.oci.image.index.v1+json' }
});
if (!anonymous.ok)
	throw Error(
		'Release image is not anonymously pullable. Make the GHCR package public, then rerun.'
	);
const release = spawnSync('gh', ['release', 'view', tag, '--json', 'isDraft'], {
	encoding: 'utf8'
});
if (release.status === 0 && !JSON.parse(release.stdout).isDraft) {
	console.log('This immutable release is already published.');
	process.exit(0);
}
run(process.execPath, ['scripts/release/bundle.mjs', tag, revision, digest, 'release-assets']);
if (release.status !== 0)
	run('gh', [
		'release',
		'create',
		tag,
		'--verify-tag',
		'--draft',
		'--title',
		`Perilune ${tag}`,
		'--generate-notes',
		'--notes-file',
		'docs/release-notes.md',
		...(prerelease ? ['--prerelease'] : [])
	]);
run('gh', [
	'release',
	'upload',
	tag,
	'--clobber',
	`release-assets/perilune-${tag}-install.tar.gz`,
	'release-assets/release.json',
	'release-assets/SHA256SUMS'
]);
run('gh', [
	'release',
	'edit',
	tag,
	'--draft=false',
	`--prerelease=${prerelease}`,
	`--latest=${!prerelease}`
]);
console.log(JSON.stringify({ tag, image: `${image}@${digest}`, published: true }));
