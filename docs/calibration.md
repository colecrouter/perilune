# Calibration workshop

Open **Calibration** to rehearse Z-offset adjustments in the simulator. Stop the
simulated job, turn off heater targets, and home all axes if needed. Printer readiness, job state, homing and heater-target checkboxes update
automatically. Homing and cooldown buttons explain when their conditions are
already satisfied. Review cleanliness, physical clearance and the simulator
acknowledgement manually, then begin. A real paper test requires a clean nozzle/bed
at room temperature; the simulator does not verify those physical conditions.

Use the segmented increment selector and **Z + · farther** / **Z − · closer**.
Positive relative adjustment increases clearance; negative reduces it. The
candidate is limited to −2..+2 mm and remains a candidate until finishing.
The schematic is not a measurement of nozzle height or a Klipper probe offset.

The next step explains high, even and low first-layer examples. It does not print
or inspect a layer. Choose the even/joined example to continue to the finish step.

- **Apply until restart** changes only this simulator process. Restart restores
  the saved default.
- **Save simulator default…** confirms a database save that survives restarts.
  It never writes the printer configuration.
- **Cancel calibration…** confirms discarding the candidate and retaining the
  previous applied offset. Heater targets and saved defaults are unchanged.

The initiating operator owns the session; other users can observe. Conflicting
motion, heating and printing controls are disabled. Cooldown remains available.
The account owner can confirm ending another operator's abandoned session.
Sessions expire after 10 minutes without a step change/adjustment. Reopening the
page or reconnecting the browser retains the same session, while a simulator
printer disconnect or backend restart interrupts it and discards unsaved work.
A storage failure reports an unknown outcome; check the saved default once storage
recovers. Perilune does not automatically replay the failed command.

Live Z-offset calibration remains disabled. The opt-in live bed mesh workflow is described below. Probe
reference calibration and first-layer print tuning are separate workflows.

References: [Klipper paper test](https://www.klipper3d.org/Bed_Level.html#the-paper-test),
[Klipper probe calibration](https://www.klipper3d.org/Probe_Calibrate.html).

## Bed mesh inspection

Open **Calibration → Bed mesh** to inspect the current reported sample grid or a
saved profile. Selecting a profile changes the view only; it does not load it.
Tap a sample, use arrow keys from a focused sample, or choose row/column numbers.
The numeric table provides every reported value. Maximum Y is at the top and
minimum X at the left. Zero is the mesh reference, not necessarily its minimum.

Comparisons show **selected − reference** on identical coordinates. Different
grids are explained and displayed without subtraction. Changing thermal/probing
conditions or mesh references can affect differences. No measurement time or
bed temperature is inferred. The reported grid can contain substituted or
extrapolated values; it is distinct from Klipper's interpolated compensation grid.
See [Klipper Bed Mesh](https://www.klipper3d.org/Bed_Mesh.html) and
[status fields](https://www.klipper3d.org/Status_Reference.html#bed_mesh).

Live inspection is read-only; no probing, heating, motion or config write occurs.

Choose **Isometric** for LayerChart's rotatable wireframe. Drag to turn/tilt, use
the sliders, or reset the view. The height-scale control makes small variation
visible and clearly labels amplification; ×1 uses actual proportions. Numeric
heights and comparison values stay unchanged. Lines connect grid samples and
are not the interpolated compensation surface. **Top-down** remains available
for cell selection; row/column fields and the table work in both views.

## Guided bed mesh simulator run

Choose **Probe bed…** and review the fixed X/Y 20–200 mm, 5×5 plan. Automatic checks
follow connection/readiness, job state, homing and heater targets. Manual checks
acknowledge cleanliness, area clearance and synthetic samples. Preparation offers
homing/cooldown and the existing stop-job prompt where needed. Heater targets off
is not a claim that surfaces are cool. Real thermal/probing requirements must be
reviewed for the actual printer before enabling live runs.

The backend advances 25 synthetic samples; leaving the page doesn't stop it.
The initiating operator owns the workflow. Other accounts can observe; account
owners may cancel an abandoned run. Cancel/discard leaves the previous active mesh
and saved profiles intact. A run or unsaved review expires ten minutes after start.
Printer loss, access revocation and backend restart interrupt it without replay.

Review displays the actual candidate separately from earlier inspection choices.
**Use temporarily…** activates it until process restart. **Save profile…** creates
a new named simulator profile without activation; it survives restart. Existing
profiles are never overwritten. Interrupted/unknown actions are explained and not
retried automatically; storage recovery may reveal a profile whose commit succeeded
before its acknowledgement was lost. No live probing or printer config write occurs.

## Live cold bed mesh probing

Set `PERILUNE_LIVE_MESH=true` alongside the backend Moonraker connection to enable
this workflow. Other live commands remain disabled. Review the printer-derived
rectangular probing bounds and readings per point, clear the bed, and check the
probe/nozzle. Heater targets must be off and both temperatures at most 40°C.
**Home and probe bed** homes automatically if needed, then measures the mesh.
Leaving the page does not stop it. Normal queued commands cannot interrupt probing;
use the printer's emergency stop if movement must stop immediately.

Klipper activates the result immediately. **Use temporarily…** keeps that active
compensation until Klipper restarts or another profile is loaded. **Restore previous
mesh…** restores the previously active saved profile (or clears compensation if
there was none). It is available only after probing, with fresh idle printer state.

**Save profile…** explicitly confirms writing ALL pending Klipper configuration
and restarting it. Choose a new identifier; default and internal names are reserved
and existing names cannot be overwritten. Completion is verified from the profile
reported after restart. Perilune does not edit your start macro: it must load the
saved profile if you want prints to use it. An uncertain outcome is never retried;
verify the printer is stopped before restoring/clearing the workflow.

The initial live workflow supports cold rectangular meshes with discrete probes.
Warm-bed preparation, standalone profile management and live probe-reference /
Z-offset calibration remain separate milestones.

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
The live page calculates from an externally performed test, even while offline;
it does not heat or extrude through Perilune yet. The simulator uses entered
example measurements, not physical observations.

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
