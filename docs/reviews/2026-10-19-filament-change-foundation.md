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
