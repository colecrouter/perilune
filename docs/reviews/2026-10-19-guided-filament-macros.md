# Guided filament macro lifecycle review

Independent reviewer: `review_swap_lifecycle`. Scope: macro-only guided changes,
persisted session ownership, existing action worker integration, setup locking,
shared printer locks, owner metadata release, UI and synthetic acceptance.

The reviewer approved the final implementation subject to full validation.
Assisted movement/extrusion, notifications and hardware acceptance remain outside
this increment; no unattended physical acceptance is claimed.

Resolved findings:

- Successful Resume can report printing motion. Same-run printing with paused=false
  now completes without incorrectly requiring idle motion; remaining paused still
  requires stationary, consistent telemetry and another deliberate Resume.
- An interruption write failure could strand storage. A checkpoint retries only
  persistence; shared admission serializes checkpoint/monitor writes with release.
- Stopped printers may lack run identity after restart. Verified operator release
  accepts an empty current stopped identity. Explicit owner metadata release also
  works offline, atomically writes receipt and finished state, rejects pending
  work/checkpoints, and preserves independent recovery/safety/storage locks.
- External resumption now says guidance ended, without claiming the print ended.

Service tests cover these cases plus macro-only dispatch, no replay, duplicate
UUIDs, competing accounts, stale steps/settings, cold nozzle, missing pause
telemetry, revoked authority, restart, owner recovery and locked setup mutation.
The existing headless live-action smoke configures M600, runs one change macro,
navigates/reloads shared guidance, observes a staged Resume, checks 390px layout
and resumes without duplicate parking/unloading.

Native collaborative browser QA used the isolated protocol fixture at desktop
and 390px widths, with no console errors or horizontal overflow. The owner
explicitly ended staged guidance; the UI retained the paused print and showed
that no stop/resume or position verification occurred. No private printer or
captured camera media was involved. A full-suite fixture fix gives the unrelated
mesh guidance sample a future expiry, and a service test verifies filament console
guidance uses the matching public message without private diagnostics. The
reviewer rechecked the follow-up and maintained approval.

Authorization-storage callback exceptions now fail closed rather than terminating
the worker. The checkpoint test throws after admission and verifies review,
persistence repair and liveness; the reviewer approved this final hardening.
Attended confirmation is bound to the session stage/owner as well as its step and
print identity, so a transition to recovery requires fresh confirmation.

Validation result: 592 tests passed in the full unit run; the final worker suite
passed 64 tests after authorization/fingerprint hardening. Formatting, lint,
Svelte/TypeScript (zero diagnostics), production build and all 13 smoke suites
passed across the full run and affected-suite reruns. The final actions rerun
also verifies the setup warning is shown once. CI verifies the exact published
head and Docker image before merge.
