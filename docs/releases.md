# Release policy

Releases use SemVer-style tags matching `package.json`, starting at
`v0.1.0-alpha.1`. Before 1.0, minor releases may introduce compatibility changes;
patch releases should remain compatible within the documented scope. Alpha/beta/rc
builds are explicitly prereleases. A tag and versioned container tag identify one
source revision and are never moved or overwritten. Installs pin the manifest
digest; there is no automatic-update policy or mutable `latest` image alias.

## Release gates

A tag must match `package.json` and belong to `main`. The release workflow reruns
all CI, including container and native x86-64/ARM64 lifecycle verification. Each
architecture is built on a native runner, tested, then pushed under a staging tag.
Only after both pass is the version manifest assembled from those exact digests.
Source revision/version/time/license OCI labels and `/health` identify the build.

Lifecycle acceptance installs the nearest previous tagged ancestor, creates an
owner and persisted state, backs up online, upgrades to the candidate with the same
volume, then restores the matching backup into a fresh volume and starts the old
image. For the first release, the preceding commit supplies the bootstrap baseline;
this is recorded in the job summary. No real printer or camera is connected.

Install assets include Compose, camera/USB overrides, example settings, docs,
`release.json` and SHA256 checksums. A draft GitHub release is populated before
publication. Retries reuse an existing version manifest only when both platform images’ source and
version config labels match; published versions/assets are not overwritten. Failure
before publication may leave staging images or a draft release for diagnosis.
Checksums detect accidental corruption; they are not an independent signature.

## Maintainer procedure

1. Update version and release notes in a reviewed PR. Update affected guides and
   examples; validate the install bundle and previous-release lifecycle.
2. Merge after independent review and all CI checks, including both native images.
3. Create a signed tag on that exact merged commit, then push it:

   ```sh
   git tag -s v0.1.0-alpha.1 -m 'Perilune 0.1.0-alpha.1'
   git push origin v0.1.0-alpha.1
   ```

4. Watch the **Release** workflow. It repeats validation before publication. On the
   first publication, GitHub’s package starts private: change the `perilune` package
   visibility to Public in GitHub package settings. The publisher checks anonymous
   manifest access and refuses to publish installation assets until that succeeds.
   Re-run a failed workflow after correcting this setting; never delete/move a tag
   merely to retry. [GitHub package visibility guide](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).
5. Confirm the GitHub release, anonymously pull its digest, inspect both architecture
   manifests, and run the downloaded bundle’s install path in a disposable simulator.
   Record the release result. Physical printer acceptance remains separate.

GitHub-generated change lists supplement the curated release notes. Use a new
version for corrections to already published code or assets. If publication fails
for another reason, inspect the log and existing manifest/draft before retrying;
do not overwrite a mismatched tag. Registry/package permissions are limited to the
publication jobs; PR image checks do not receive registry write permissions.

## Local verification

```sh
pnpm validate
pnpm test:compose
actionlint .github/workflows/*.yml
docker build -t perilune:release-candidate --build-arg VERSION=0.1.0-alpha.1 \
  --build-arg REVISION="$(git rev-parse HEAD)" .
# Build a previous tagged ancestor (or bootstrap parent) as perilune:release-previous.
node scripts/release/lifecycle.mjs perilune:release-previous perilune:release-candidate
```

The lifecycle script creates uniquely named disposable Docker containers/volumes,
uses synthetic accounts, and removes only those resources. Never pass a production
container or data volume to an isolated acceptance test.

## Wiki publication

The Wiki is the primary user guide. Repository Markdown remains the reviewed,
versioned source and is included in install bundles for offline or older-version
use. Publish only after the corresponding GitHub release is public:

```sh
# Clone once (GitHub requires an initial Home page to exist).
git clone https://github.com/colecrouter/perilune.wiki.git /tmp/perilune-wiki
node scripts/release/wiki.mjs v0.1.0-alpha.2 /tmp/perilune-wiki
git -C /tmp/perilune-wiki diff --check
git -C /tmp/perilune-wiki add -- '*.md'
git -C /tmp/perilune-wiki commit -S -m 'docs: publish guides for v0.1.0-alpha.2'
git -C /tmp/perilune-wiki push
```

The generator reads an explicit tag, verifies its package version, rewrites guide
links to Wiki pages and pins screenshots/developer links to that immutable tag.
It replaces only its managed pages/sidebar/footer and retains unrelated pages.
Review the diff before pushing; GitHub Wiki does not have the repository's PR gate.
Do not publish working-tree drafts or private deployment material.

## Beta candidate preparation (unreleased)

The [beta readiness ledger](beta-readiness.md) separates passing automation from
pending owner/platform acceptance. Native lifecycle CI now also enrolls an owner
and writes a backup on a fresh candidate. It seeds synthetic preferences, filament
settings and completed/unknown receipts on the previous tagged baseline, then
checks exact data and VAPID identity through upgrade and matching-backup rollback.
No receipt is submitted or replayed; no printer/camera is connected. Only uniquely
named disposable containers and six volumes are used and cleaned up.

The static share card can be regenerated with `node scripts/generate-social-card.mjs`
in a development install. Metadata is fixed brand copy, never live printer state;
image URLs use the installation origin and omit request queries/paths. External
access gateways can still prevent a crawler from reaching the page or asset.
