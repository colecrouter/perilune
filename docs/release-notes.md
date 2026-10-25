# Planned beta (unreleased)

Proposed target: **0.1.0-beta.1**. Version/tag/publication are deferred until the
final visual and owner release review. These notes are provisional.

- More consistent loading, retained server state through browser reconnects,
  stable live Z controls and verified workshop-dialog completion.
- Core contrast fixes and automated accessibility/reflow/keyboard coverage.
- Broader raw USB conversion with bounded shared capture; physical driver and
  browser-platform limits remain explicit.
- Preferences and filament settings use the shared Effect-native ORM adapter,
  preserving existing data, revision checks and transaction behavior.
- Push sender migration retains existing subscriptions and VAPID identity, with
  protocol, cancellation and privacy checks; device acceptance remains separate.
- Static privacy-safe sharing metadata and stronger fresh-install/upgrade/backup/
  rollback evidence for application settings and durable receipts.

Final motion/lunar refinements and their review are still pending. See the
[beta ledger](beta-readiness.md) for proposed blockers and known limitations.

## 0.1.0-alpha.2 (published)

Second alpha; explicit updates preserve the immutable first release.

- Pairing submissions stay disabled until browser handlers are ready, preventing
  an early click from submitting the plain HTML form without creating a code.
- Release retries verify both platform image configs, supporting registries that
  omit optional OCI index annotations while still refusing source/version mismatches.

- Interrupted bed probes can recover without a completed candidate after the saved
  baseline is verified; an already-completed firmware restart is not repeated.
- Successful mesh recovery resolves earlier alerts for that workflow. Historical
  receipts stay in Activity. Manual acknowledgement is server-side, avoiding
  hydration-time alert flashes on reload.
- The GitHub Wiki is the primary guide, with illustrated core workflows, explicit
  compatibility/acceptance limits and matching versioned copies in install bundles.

This release exercises installation, account retention, online backup, upgrade
from the preceding tagged release and matching-backup rollback on native Linux
x86-64 and ARM64. See the included upgrade guide before changing versions.

Perilune remains an early alpha. Physical printer controls are opt-in and require
attended acceptance. No command with an unknown outcome is automatically replayed.
