# Extrusion calibration review

Independent reviewer: `extrusion_review` agent, 2026-10-14.

Scope: simulator filament handling and actor-owned extrusion-distance workflow,
SQLite lifecycle/recovery, manual live calculator, unapplied proposal exports,
responsive interface, tests, and deployment assumptions.

The reviewer requested five changes, all resolved:

- Reject baselines that can round a proposal to zero at three decimals.
- Invalidate manual results and export controls when measurement drafts change.
- Reset loaded-filament/clearance checks between workflows, preserving them during
  ordinary telemetry updates and reconnects.
- Exercise SQLite acknowledgement failures before and after committing a feed,
  verifying unknown outcomes, released leases, and no physical-command replay.
- Disable and explain heater targeting while another calibration owns controls.

The reviewer subsequently approved the implementation with no remaining blocking
findings, contingent on passing validation/CI. The reviewer also inspected finished
proposal reconciliation after a lost commit acknowledgement; an additional service
regression covers this path. Browser coverage verifies acknowledgment reset and
cross-workflow heater disabling. Tests run headless.

Live extrusion/heating remain disabled. The live calculator accepts measurements
from an externally performed test; neither calculator nor export writes printer
configuration. Simulator exports explicitly identify their example source.
