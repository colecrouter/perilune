# Calibration workshop

Available since **0.1.0-alpha.1**. This guide describes **0.1.0-alpha.2**.

Choose the workflow from **Calibration**. The simulator rehearses interactions;
physical workflows require independent host opt-ins and attended acceptance.

- [Bed mesh](bed-mesh.md): inspect samples, create a new calibration, replace a
  saved target, load compensation or delete a saved profile.
- [PID heater tuning](pid-calibration.md): attended heater measurement and staged
  gains with explicit save/discard.
- [Filament changes](filament-changes.md): review printer macro compatibility or
  use attended assisted handling.
- Filament/extrusion distance: bounded feed/retract and measured calibration below.

## Z calibration

The simulator provides a guided paper-test rehearsal and first-layer examples;
these do not measure a real nozzle height or print a test layer. A live manual Z
workflow requires `PERILUNE_LIVE_CONTROLS=true` and
`PERILUNE_LIVE_Z_CALIBRATION=true`. Follow the preparation checks, inspect physical
clearance and use the deliberately separated closer/farther controls.

Live paper-test steps belong to a persistent backend session. Navigation and
incoming telemetry retain the workflow; they do not reissue a movement. Accepting
a result is distinct from saving printer configuration. Review staged settings in
[Configuration](configuration.md#reviewed-application-and-recovery-opt-in).
If acknowledgement is lost, inspect the receipt and use the explicit recovery
flow rather than repeating a command.

References: [Klipper paper test](https://www.klipper3d.org/Bed_Level.html#the-paper-test),
[probe calibration](https://www.klipper3d.org/Probe_Calibrate.html).

## Filament and extrusion distance

Open **Calibration → Filament & extrusion**. Simulator controls require an idle
printer and a nozzle settled at the selected filament temperature; XYZ homing is
unnecessary for extrusion alone. Confirm loaded filament and nozzle clearance.
Use the slow feed/retract buttons for 5, 10, or 25 mm, or begin a measured 50 mm run
at 1 mm/s. The shared backend keeps running through page navigation and reserves
the printer until measurement review finishes. Another operator can observe;
the account owner can end an abandoned workflow.

For a real measurement, mark the filament about 70 mm from a fixed point at the
extruder intake and measure precisely. Enter the current `rotation_distance`,
including any runtime override; do not substitute slicer flow or change
`gear_ratio`. After feeding 50 mm slowly, measure from that same point to the mark.
With live filament controls disabled, the live page is a manual calculator for an
externally performed test, even while offline; it does not heat or extrude in that
mode. With `PERILUNE_LIVE_CONTROLS=true` and `PERILUNE_LIVE_FILAMENT=true`,
Perilune can send the bounded feed/retract or measured run after fresh extrusion
permission, settled temperature and ownership checks. Use the heater controls only
with owner-coordinated preparation. The simulator uses entered example
measurements, not physical observations.

The calculation is `old rotation_distance × (initial − remaining) / 50`, rounded
to three decimal places. Repeat with a fresh mark to confirm; discrepancies over
2 mm explicitly recommend another measurement. Large or impossible deviations
are rejected so a slipped filament or blocked nozzle is investigated first.
See [Klipper’s rotation-distance guidance](https://www.klipper3d.org/Rotation_Distance.html#calibrating-rotation_distance-on-extruders).

**Export proposal** downloads an unapplied configuration snippet and measurement
notes. Review it against the existing `[extruder]` section; exporting never saves
or restarts the printer. Simulator exports explicitly warn against applying example
data. Editing live calculator inputs clears the previous result until recalculated.
**Finish measurement** and cancellation offer an explicit nozzle cooldown choice.
A finished simulator proposal survives restart; unfinished work is interrupted on
printer disconnect, access revocation, expiry, or backend restart and never replayed.
Owners can choose **Review in configuration** to carry the result into a local
configuration draft. Choose the file containing the existing `[extruder]`
`rotation_distance`, confirm the repeated measurement and review other configuration
sources/runtime overrides. Perilune requires the draft's old value to match the
measurement and changes only that numeric value. Missing/ambiguous/generated
settings require manual review. Simulator results cannot be staged into live files.
The handoff is private to this tab, clears on refresh/account changes, and expires
after 30 minutes. It is not stored in URLs or browser storage. Other draft edits
remain intact. Use the normal source-diff review/export/save/application flow next;
adding a proposal never writes or restarts the printer. Live application remains
default-off pending coordinated testing.

Z-offset and bed-mesh saves remain in their dedicated Klipper workflows; this
handoff does not rewrite generated calibration blocks or synthesize mesh data.
Print-based flow/pressure-advance tuning remains a separate milestone.

For interrupted operations, see [recovery](recovery.md).

## Stable live paper-test controls (unreleased)

Preparation includes **Home All**, using the same guarded action as printer
controls after confirming bed clearance and attendance. Starting does not home or
move automatically beyond the explicitly selected operation. Once the newly
requested paper-test session is observed active, Perilune focuses and scrolls to
its adjustment controls; observers are not redirected.

During adjustment, routine submission/receipt messages do not insert text above
the movement buttons. Pending buttons disable without changing their labels.
Errors and blocked-state explanations appear below the controls. Fine/coarse
selection keeps the control rows in place. The larger **Current Z coordinate**
sits directly below Z + / Z − so it remains visible with those buttons on phones.
It is the printer coordinate, not a measured nozzle-to-bed gap.
