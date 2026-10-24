/** Docker manifest lists may omit OCI index annotations; image configs retain labels. */
export function verifyManifestIdentity(manifest, version, revision, labelsForDigest) {
	if (!Array.isArray(manifest.manifests) || manifest.manifests.length !== 2)
		throw Error('Release must contain exactly two platform images');
	for (const architecture of ['amd64', 'arm64']) {
		const matches = manifest.manifests.filter(
			(m) => m.platform?.os === 'linux' && m.platform?.architecture === architecture
		);
		if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest))
			throw Error('Invalid or missing architecture ' + architecture);
		const labels = labelsForDigest(matches[0].digest);
		if (
			labels?.['org.opencontainers.image.version'] !== version ||
			labels?.['org.opencontainers.image.revision'] !== revision ||
			labels?.['org.opencontainers.image.source'] !== 'https://github.com/colecrouter/perilune'
		)
			throw Error('Published image belongs to different source or version; never overwrite it');
	}
}
