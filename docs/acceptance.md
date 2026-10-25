# Alpha acceptance and known limits

> Historical acceptance baseline: published **0.1.0-alpha.2**. See the
> [beta preparation ledger](beta-readiness.md) for later unreleased work and the
> pending release decision.

Release target: **0.1.0-alpha.2**. This is an early alpha, not a claim that every
printer, camera, browser or hardware workflow has been validated. Keep your current
printer interface available while evaluating it.

## Verified evidence

- Linux x86-64 and ARM64 image builds run native installation, online backup,
  previous-version upgrade and matching-backup rollback gates.
- The public alpha.1 bundle was anonymously downloaded/pulled and installed in an
  isolated simulator; owner login, backup and persistence after restart passed.
  The alpha.2 public release is available; its release-era evidence does not certify
  an unreleased beta bundle.
- Owner testing confirmed native OrcaSlicer upload/start and Device-tab pairing,
  persistence after quit/relaunch and revocation (Orca approximately 2.4.2).
- A small real print completed and sent image push notifications to two devices.
- Attended preliminary nozzle and bed PID runs were inspected and discarded;
  representative-temperature save acceptance remains deferred.
- Local USB MJPEG capture/conversion and software disconnect/recovery were tested
  with a Logitech C270. Raw-only formats remain unverified; see [camera limits](camera-compatibility.md).
- The owner exercised interrupted bed probing and confirmed recovery after the
  alpha.2 correction. The alert correction has automated server-rendering and
  persistence checks; final owner confirmation remains useful.

## Still requires owner/device acceptance

These tasks require the owner's device, physical presence or a deployment choice.
They are not release-pipeline failures and are not silently marked complete by CI.

| Area               | Remaining check                                                                          | Tracker                                                    |
| ------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Phone daily use    | End-to-end signed-in camera/navigation and detailed print controls                       | [#52](https://github.com/colecrouter/perilune/issues/52)   |
| Mobile push/update | App-closed error/failed-job delivery, expired image fallback and multi-tab update prompt | [#35](https://github.com/colecrouter/perilune/issues/35)   |
| PID                | Real reconnect, representative-temperature save and interrupted tuning recovery          | [#100](https://github.com/colecrouter/perilune/issues/100) |
| Backup resilience  | Choose an off-host destination and verify restoring that copy                            | [#52](https://github.com/colecrouter/perilune/issues/52)   |
| Email              | Configure a real SMTP provider and verify inbox delivery                                 | [#87](https://github.com/colecrouter/perilune/issues/87)   |
| Broader UX         | Final desktop/phone review of current workflows                                          | [#107](https://github.com/colecrouter/perilune/issues/107) |

Live controls default to off. The installation guide does not authorize physical
movement, heating, firmware restarts or configuration writes. Coordinate those
checks with the printer owner. Simulated probes, synthetic images and protocol
fixtures do not establish hardware safety.

## Compatibility boundaries

Cold rectangular probing with discrete probes is the current mesh workflow.
Saving a mesh does not alter print-start macros. Camera support depends on source
format and the managed companion; raw USB conversion has later synthetic protocol coverage, but real raw-driver
acceptance remains unverified (see the beta ledger).
Push delivery is best effort and browser/platform dependent. Browser sign-in lasts
90 days; race-safe rolling renewal is a future enhancement, not an alpha.2 feature.
