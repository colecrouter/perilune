> Release status: alpha.2 changes are **unreleased until** the matching
> `v0.1.0-alpha.2` release is published. Use the alpha.1 guides for alpha.1 installs.

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
