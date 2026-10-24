import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyManifestIdentity } from './manifest-identity.mjs';
const version = '0.1.0-alpha.1',
	revision = 'a'.repeat(40);
const labels = {
	'org.opencontainers.image.version': version,
	'org.opencontainers.image.revision': revision,
	'org.opencontainers.image.source': 'https://github.com/colecrouter/perilune'
};
const manifest = (mediaType) => ({
	mediaType,
	manifests: ['amd64', 'arm64'].map((architecture, i) => ({
		digest: 'sha256:' + String(i).repeat(64),
		platform: { os: 'linux', architecture }
	}))
});
void test('accepts both real registry formats without relying on optional index annotations', () => {
	for (const mediaType of [
		'application/vnd.docker.distribution.manifest.list.v2+json',
		'application/vnd.oci.image.index.v1+json'
	]) {
		const read = [];
		verifyManifestIdentity(manifest(mediaType), version, revision, (digest) => {
			read.push(digest);
			return labels;
		});
		assert.equal(read.length, 2);
	}
});
void test('rejects mismatched source or version in either platform and incomplete platform sets', () => {
	for (const platform of [0, 1])
		for (const field of Object.keys(labels)) {
			const m = manifest('docker');
			assert.throws(
				() =>
					verifyManifestIdentity(m, version, revision, (digest) =>
						digest === m.manifests[platform].digest ? { ...labels, [field]: 'wrong' } : labels
					),
				/different source or version/
			);
		}
	const missing = manifest('docker');
	missing.manifests.pop();
	assert.throws(
		() => verifyManifestIdentity(missing, version, revision, () => labels),
		/two platform/
	);
	const duplicate = manifest('docker');
	duplicate.manifests[1].platform.architecture = 'amd64';
	assert.throws(
		() => verifyManifestIdentity(duplicate, version, revision, () => labels),
		/architecture/
	);
});
