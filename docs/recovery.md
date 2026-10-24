# Locks, failures and recovery

> Release status: alpha.2 changes are **unreleased until** the matching
> `v0.1.0-alpha.2` release is published. Use the alpha.1 guides for alpha.1 installs.


Available since **0.1.0-alpha.1**. Mesh recovery and failure-alert resolution were
corrected in **0.1.0-alpha.2**.

## Read the state before acting

A pending request, failed request and unknown outcome mean different things.
A failed receipt records an attempt that failed. An unknown outcome means the
backend cannot prove whether a sent command took effect. Perilune never blindly
replays it. Use **Review action** or **Activity** to inspect the receipt and check
the actual printer before deciding what to do next.

A lock notice explains which condition blocks ordinary controls and links to the
relevant workflow. Dismissing a failure alert does not unlock the printer. A
connection failure requires a fresh connection and telemetry; a calibration lock
requires completion or explicit recovery of that calibration.

## Emergency stop

Use emergency stop when the printer must stop immediately. After resolving the
physical hazard, follow **Recover from emergency stop** to inspect the printer
and restart firmware. This requires owner coordination and is not a substitute for
hardware power isolation when needed.

An acknowledged restart can unlock automatically after fresh ready, idle and
heater-off checks pass. The emergency menu then closes; its second verification
step is a fallback for a lost acknowledgement or externally initiated restart.
Recovery does not resume a print.

## Interrupted bed probing

Emergency recovery and mesh recovery are independent. Once firmware is ready,
return to **Bed mesh** and review the interrupted workflow. **Discard bed mesh**
verifies saved and loaded configuration before restoring previous compensation.
If no completed candidate exists but an external restart has already restored the
captured baseline with no pending settings, it does not send another restart.

If pending settings remain or configuration differs from captured evidence, stop
and inspect Configuration. Perilune will not erase unrelated changes to make its
workflow disappear. Read-only reconciliation never substitutes for a required
physical activation; any restoration is an explicit action.

## Alerts versus history

After successful mesh save, discard or verified reconciliation, prior failed
attempts for that workflow remain in Activity but stop being active alerts.
Manual dismissal acknowledges the displayed failures for the signed-in account
on the server, across pages and devices. New failures still appear. If that
acknowledgement fails, the alert remains and offers retry; it is never hidden by a
browser-storage read after initial page rendering.

For configuration-write recovery, use the exact reviewed snapshot flow in
[Configuration](configuration.md#reviewed-application-and-recovery-opt-in).
