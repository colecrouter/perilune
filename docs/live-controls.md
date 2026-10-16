# Live printer controls

Set `PERILUNE_MOONRAKER_URL` and explicitly enable `PERILUNE_LIVE_CONTROLS=true`
on the backend. Restart the process after changing connection settings. The default
remains read-only; this flag is independent of live mesh and configuration flags.
Keep private endpoints and API keys in installation settings, outside Git.

Enabled actions are homing, bounded manual movement, releasing all motors, primary
bed/nozzle targets, cooldown, and starting/pausing/resuming/stopping jobs already in
the live file library. Uploading/deleting live files, arbitrary console/macros,
Z-offset and extrusion workflows are not enabled by this flag.

## Operation lifecycle

All Perilune clients share a process-owned worker and admission gate. Mesh,
configuration and ordinary live actions cannot race admission. There is one
ordinary live action slot, including work currently executing; subsequent requests
receive a pending explanation instead of accumulating stale movement. Submission
IDs are bound to account and payload, persisted before dispatch, and never replayed.
Queued work expires after 30 seconds. Execution rechecks authorization, connection
generation, fresh readiness, limits, job identity and active workflow reservations.

Movement uses relative distances from the reviewed toolhead position, preserves
G-code positioning/feed state, and includes `M400`. Travel bounds, homing and bed
clearance confirmations still apply. Heater targets must fit both application
limits and the configured heater limits. A successful target action means the
requested target was observed, not that the heater has reached it.

Job start refreshes the live catalog and rejects changed file identities. Job
controls bind to the observed run, including a new identity after reconnect or a
new run of the same filename. Stop runs the printer's cancellation behavior,
verifies that the same job has stopped, then applies the independent cooldown
choices. Keeping heat restores the previous target if a cancel macro turned it
off. Failure at either stage leaves an unknown outcome instead of replaying either
stage. Moonraker's filename/modified/size catalog identity cannot detect a writer
that deliberately preserves all three; Perilune does not lock external files.

Acknowledgement and fresh observed state are separate requirements for completion.
A timeout, disconnect, unverifiable result or storage failure can leave an unknown
outcome. The durable reservation survives backend restart, keeps incompatible
controls locked and displays recovery throughout the printer pages. An owner must
inspect the printer and explicitly clear recovery; the backend requires fresh,
ready, idle state. This clears a lock only: it does not undo, repeat or complete
the original action. Original outcomes remain visible in action history.

Perilune serializes its own users. Other Moonraker clients, printer screens and
external macros can act between a query and command dispatch; Moonraker does not
provide an atomic reservation against them. Keep other controllers idle during
calibration/configuration and coordinated acceptance. After a failed movement,
inspect positioning mode and printer state before clearing recovery: a failed
G-code script can stop before its modal-state restoration line.

## Verification

Headless protocol/browser coverage includes shared admission, deduplication,
authorization and position changes, configured heater limits, live catalog/job
identity, partial cancellation, dropped acknowledgements, observed-state failure,
restart recovery, unexpected defects, JavaScript-disabled basic forms and mobile
layout. The fixtures never connect to a physical printer.

Owner-authorized physical acceptance verified homing, raising Z, a 2 mm X move and
return, 40°C bed/50°C nozzle targets, actual nozzle warming and cooldown. Both
heater targets were observed off afterward. Motor release still needs a physical
check with gantry support available. Failure injection remains on the protocol
fixture rather than the physical printer.

Recovery-time stop/cooldown is tracked in [#42](https://github.com/colecrouter/perilune/issues/42).
Until that lands, an active or paused print must be stopped using the printer or
another trusted Moonraker client before clearing an unknown-outcome lock here.
Unlocking does not stop a job or turn heaters off.
