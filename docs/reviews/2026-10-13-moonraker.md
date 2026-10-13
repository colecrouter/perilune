# Persistent read-only Moonraker review

An independent agent reviewed the transport, process service composition,
read-only admission, telemetry/draft handling, and deployment assumptions.

Resolved findings:

- Lifecycle notifications during initial list/subscribe could reactivate an old
  subscription. Readiness epochs now invalidate pending initialization.
- Deltas arriving before subscription acknowledgement are buffered and merged
  using event time, avoiding rollback to the initial snapshot.
- Partial layer metadata updates now preserve sibling values.
- Disposal interrupts pending RPCs and unopened WebSocket handshakes.
- Live state hides historical simulator actions rather than implying they ran
  on the physical printer.
- Added a composed service/bridge test with two subscribers sharing one socket.

Read-only testing against the owner's printer caught a required identify URL;
this is now supplied and required by the protocol fixture. Live telemetry was
received with Moonraker connected and Klipper ready. No physical commands,
configuration writes, heating, or movement were performed. Private addresses,
printer filenames, configuration, and media are excluded from this record.

Validation includes protocol fixtures, domain/service tests, headless component
browser tests, simulator production smoke, and live protocol production smoke.
The latter exercises startup, readiness, deltas, shutdown, reconnect, shared
state, disabled physical controls, preserved drafts, and mobile overflow.
T3 preview initially worked, then reported no automation host; headless
Playwright supplied final checks. Fixture desktop/mobile captures were inspected.

Independent re-review approved the corrected implementation without blocking
findings. Physical action acknowledgement and reconciliation remain a separate
milestone; the live transport exposes no command API.
