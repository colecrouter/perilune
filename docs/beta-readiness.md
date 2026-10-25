# Beta preparation and release decision (unreleased)

Planned target: **0.1.0-beta.1**, not yet versioned, tagged or published. The current
published release is [0.1.0-alpha.2](https://github.com/colecrouter/perilune/releases/tag/v0.1.0-alpha.2).
This is a preparation ledger, not a claim that beta acceptance is complete.

## Autonomous implementation

| Area               | Evidence and scope                                                                                                                                                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistence        | [#163](https://github.com/colecrouter/perilune/pull/163) and [#169](https://github.com/colecrouter/perilune/pull/169): same-client preferences and revision-guarded filament settings, rollback/cancellation and unchanged schema. Full ORM conversion stays outside the beta critical path.                                                 |
| Core readiness     | [#170](https://github.com/colecrouter/perilune/pull/170): scoped contrast fixes, 143 synthetic accessibility/reflow/keyboard scans and documented manual limits.                                                                                                                                                                             |
| Push migration     | [#171](https://github.com/colecrouter/perilune/pull/171): unchanged subscription/VAPID identity, independently verified wire encryption/signatures, cancellation and expiry handling. Real-device delivery after this migration remains unverified.                                                                                          |
| Sharing            | Static brand-only OpenGraph/large-card metadata and a public 1200×630 PNG. It contains no account, job, camera, configuration or deployment data. Crawlers still need network access to the installation; external access gateways may prevent previews.                                                                                     |
| Distribution gates | Native amd64/arm64 CI installs the nearest previous tagged ancestor, backs up, upgrades and restores the matching backup into a fresh volume. The expanded fixture also enrolls an owner and backs up a fresh candidate, and retains preferences, filament revisions, VAPID identity and completed/unknown receipts across upgrade/rollback. |

The first three PRs passed independent review, full local validation and all eleven
exact-head CI gates. Expanded distribution/metadata gates require their own passing
PR CI before being counted. No beta manifest, digest or downloaded beta bundle
exists yet. Anonymous image/bundle acceptance must be repeated after publication;
the previous public-alpha acceptance is historical evidence only.

## Deferred owner review and proposed release disposition

These are proposed classifications for the final review, not automatic waivers.
Keep trackers open until their actual acceptance is recorded.

| Tracker                                                                                                              | Required review                                                                                      | Proposed disposition                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [#107](https://github.com/colecrouter/perilune/issues/107), [#52](https://github.com/colecrouter/perilune/issues/52) | Representative desktop/phone daily use and the owner's current print workflow                        | Release-decision gate: review the actual beta candidate before calling it ready.                                                             |
| [#35](https://github.com/colecrouter/perilune/issues/35)                                                             | Target-device notification delivery after #91, app-closed errors, image expiry and multi-tab updates | Verify before claiming platform delivery; otherwise explicitly retain experimental platform status in beta notes.                            |
| [#100](https://github.com/colecrouter/perilune/issues/100)                                                           | Attended PID save/reconnect/interruption                                                             | Keep live PID opt-in and unverified until attended acceptance; not evidence supplied by simulator tests.                                     |
| [#84](https://github.com/colecrouter/perilune/issues/84)                                                             | Installed macro/assisted filament-change acceptance                                                  | Keep printer-specific review and opt-in limits; do not advertise unattended physical compatibility.                                          |
| [#2](https://github.com/colecrouter/perilune/issues/2)                                                               | Real raw drivers, Safari/native HLS, low-power throughput and physical cable recovery                | Document the exact tested camera matrix; unsupported/unverified hardware remains a known limitation.                                         |
| [#87](https://github.com/colecrouter/perilune/issues/87)                                                             | Real SMTP inbox and account recovery                                                                 | Verify the configured provider before relying on email recovery; document owner-generated recovery-link fallback.                            |
| [#52](https://github.com/colecrouter/perilune/issues/52)                                                             | Off-host backup destination and restore                                                              | Deployment decision remains open; same-disk copies are not disaster recovery.                                                                |
| [#81](https://github.com/colecrouter/perilune/issues/81), [#8](https://github.com/colecrouter/perilune/issues/8)     | Final motion/lunar proposals                                                                         | Direction accepted; implementation and final exact-head gates must preserve reduced motion, focus, stable controls and the approved palette. |

## Candidate completion sequence

1. Complete the accepted motion/lunar implementation and its review. Retain working hard links,
   drafts and urgent controls; avoid broad visual changes before that review.
2. Update this ledger and curated release notes from the accepted implementation.
   Explicitly decide each outstanding acceptance item's disposition.
3. Set the actual package version in a reviewed PR, then rerun full validation and
   both native lifecycle gates on that exact final candidate. Earlier passes do not
   certify later visual or release changes.
4. Follow the [release procedure](releases.md). Publish an immutable signed tag only
   after the release decision; verify anonymous digest pull, identity, downloaded
   install bundle, fresh setup, backup and restart persistence after publication.
5. Publish the Wiki from that released tag. Working-tree drafts remain unreleased
   and do not replace the current stable Wiki.

Issue [#167](https://github.com/colecrouter/perilune/issues/167) remains open through
final candidate evidence. The roadmap is [#168](https://github.com/colecrouter/perilune/issues/168).
