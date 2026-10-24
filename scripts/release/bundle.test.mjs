import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { releaseVersion, version } from './version.mjs';
void test('release identity must exactly match the declared version', () => {
	assert.equal(releaseVersion('v' + version).version, version);
	for (const invalid of ['main', 'v9.0.0', 'v' + version + ';echo bad', 'v01.0.0'])
		assert.throws(() => releaseVersion(invalid));
});
void test('install bundle is digest-pinned, self-contained and contains no build or private data', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'perilune-bundle-'));
	try {
		const out = join(directory, 'release');
		execFileSync(process.execPath, [
			'scripts/release/bundle.mjs',
			'v' + version,
			'a'.repeat(40),
			'sha256:' + 'b'.repeat(64),
			out
		]);
		const files = await readdir(join(out, 'perilune'));
		assert.ok(files.includes('.env.example'));
		assert.ok(!files.includes('.env'));
		assert.ok(!files.includes('data'));
		const config = JSON.parse(
			execFileSync(
				'docker',
				[
					'compose',
					'--env-file',
					join(out, 'perilune/.env.example'),
					'-f',
					join(out, 'perilune/compose.yaml'),
					'config',
					'--format',
					'json'
				],
				{ encoding: 'utf8' }
			)
		);
		assert.equal(
			config.services.perilune.image,
			'ghcr.io/colecrouter/perilune@sha256:' + 'b'.repeat(64)
		);
		assert.equal(config.services.perilune.build, undefined);
		assert.equal(config.services.perilune.environment.PERILUNE_MOONRAKER_URL, '');
		assert.equal(config.services.perilune.ports[0].host_ip, '127.0.0.1');
		const metadata = JSON.parse(await readFile(join(out, 'release.json'), 'utf8'));
		assert.deepEqual(metadata.platforms, ['linux/amd64', 'linux/arm64']);
		execFileSync('shasum', ['-a', '256', '-c', 'SHA256SUMS'], { cwd: out });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
