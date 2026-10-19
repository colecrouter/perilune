# Filament-change setup foundation review

Independent reviewer: `review_filament_design`. Scope: capability discovery,
configuration fingerprint, pause telemetry subscription, SQLite setup persistence,
owner/operator remote endpoints, setup UI and synthetic tests. This is the first
increment of #84; it does not dispatch physical commands.

Two findings were resolved before approval:

- A review checkbox could transfer to refreshed configuration. Review now binds
  to the exact mode, change/resume selection and discovered fingerprint. Changing
  any of these invalidates approval and disables Save.
- A fingerprint limited to macros/extruder/runout missed geometry dependencies.
  The backend now hashes recursively canonicalized complete configuration and
  sorted loaded object names. Raw configuration remains private.

The reviewer re-inspected both fixes and their regression coverage and reported
no remaining actionable findings. Approval is limited to setup/discovery;
execution needs a separate lifecycle review.

Tests cover loaded-object discovery without help, private macro body exclusion,
configuration ordering stability, geometry invalidation, unknown pause state,
per-printer isolation, revision races and restart persistence. The existing
headless console smoke includes saved setup, approval invalidation on selection
and discovery changes, mobile overflow, viewer denial and no physical RPCs.
Native collaborative preview also checked the synthetic route at desktop and
390px, with no relevant console errors. No real printer was used.

A final viewer regression exposed a generic query error instead of the intended
friendly access panel. The page now skips private discovery for viewers; the
reviewer confirmed the guard and unchanged authoritative endpoint checks. All
13 smoke suites passed across the initial validation and affected-suite reruns.
The first run's live-mesh enrollment failure came from a local preview port
collision, resolved by shutting down/moving the preview fixture. Final action
smokes passed the added setup regressions. Formatting, Svelte/TypeScript checks,
unit tests and production build passed; CI separately verifies the Docker image.
