import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { releaseVersion } from './version.mjs';

const [tag, revision, digest, output] = process.argv.slice(2);
const { version, prerelease } = releaseVersion(tag);
if (
	!/^[a-f0-9]{40}$/.test(revision ?? '') ||
	!/^sha256:[a-f0-9]{64}$/.test(digest ?? '') ||
	!output
)
	throw Error('Usage: bundle.mjs vVERSION FULL_COMMIT sha256:DIGEST OUTPUT_DIRECTORY');
const root = resolve(output);
await mkdir(root);
const directory = join(root, 'perilune');
await mkdir(directory);
const image = `ghcr.io/colecrouter/perilune@${digest}`;
let compose = await readFile('compose.yaml', 'utf8');
if (!compose.includes('    build: .\n')) throw Error('Unexpected source Compose structure');
compose = compose.replace(
	'    build: .\n',
	'    image: ${PERILUNE_IMAGE:?Set PERILUNE_IMAGE in .env}\n'
);
compose = compose.replace(
	'  perilune-data:\n',
	'  perilune-data:\n    name: ${PERILUNE_DATA_VOLUME:-perilune-data}\n'
);
compose = compose.replace(
	'  perilune-backups:\n',
	'  perilune-backups:\n    name: ${PERILUNE_BACKUP_VOLUME:-perilune-backups}\n'
);
await writeFile(join(directory, 'compose.yaml'), compose);
await writeFile(
	join(directory, '.env.example'),
	`# ${tag}; override only with another reviewed release.\nCOMPOSE_PROJECT_NAME=perilune\nPERILUNE_IMAGE=${image}\n\n` +
		(await readFile('.env.example', 'utf8'))
);
for (const file of ['compose.camera.yaml', 'compose.camera-usb.yaml', 'LICENSE', 'CONTRIBUTING.md'])
	await copyFile(file, join(directory, file));
await cp('docker/camera', join(directory, 'docker/camera'), { recursive: true });
await cp('docs', join(directory, 'docs'), { recursive: true });
await writeFile(
	join(directory, 'INSTALL.md'),
	'# Perilune ' +
		tag +
		'\n\nFollow [the installation guide](docs/getting-started.md). Keep this bundle’s files together.\n'
);
const metadata = {
	format: 1,
	tag,
	version,
	prerelease,
	revision,
	image,
	platforms: ['linux/amd64', 'linux/arm64']
};
await writeFile(join(root, 'release.json'), JSON.stringify(metadata, null, 2) + '\n');
await copyFile(join(root, 'release.json'), join(directory, 'release.json'));
// The bundle contains only an explicit public-file allowlist, never checkout data or secrets.
const archive = `perilune-${tag}-install.tar.gz`;
execFileSync('tar', ['-czf', join(root, archive), '-C', root, 'perilune']);
const sums = await Promise.all(
	[archive, 'release.json'].map(
		async (name) =>
			`${createHash('sha256')
				.update(await readFile(join(root, name)))
				.digest('hex')}  ${name}`
	)
);
await writeFile(join(root, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log(JSON.stringify({ ...metadata, archive }));
