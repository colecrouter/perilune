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

Live calibration remains disabled pending coordinated printer testing. Probe
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
