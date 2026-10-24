# PID heater calibration

Available since **0.1.0-alpha.1**. This guide describes **0.1.0-alpha.2**.

Open Calibration → PID heater calibration. The simulator returns fixed, clearly
labelled example gains without heating; never copy those gains to a real printer.

Live tuning is an owner-only, attended workflow. Both `PERILUNE_LIVE_CONTROLS=true`
and `PERILUNE_LIVE_PID=true` are required. Keep PID disabled until coordinated
heater testing with the printer owner. These flags do not authorize configuration
writes: saving requires the separate configuration application opt-in.

## Prepare and run

Use a suitable normal printing temperature for the selected nozzle or bed, with
its usual cooling arrangement. Check the heater, wiring, cooling, and clear bed.
Finish the print, turn both heater targets off, let the selected heater cool at
least 5°C below the target, and resolve existing pending settings. Keep other
printer clients idle. Targets must be whole degrees, at least 30°C, and at least
10°C below the configured maximum (with an overall 300°C cap).

The backend rechecks fresh readiness, ownership, configuration and workflow
interlocks before dispatch. It requires native, unshadowed `PID_CALIBRATE` and
`TURN_OFF_HEATERS` commands. One process-owned action runs native PID tuning then
turns heaters off. No homing or extrusion is requested. Stay with the printer:
navigation, browser closure, or another operator's page does not own the worker.

Stop calibration uses the independent emergency endpoint because ordinary G-code
can queue behind PID tuning. This shuts down Klipper and all heaters; motors may
release. Inspect hazards before following guided firmware recovery. Lost replies,
restarts, emergency stops, and unverified completion are never automatically
replayed. Review the printer and Activity recovery before submitting a new test.

## Review and save separately

A completed RPC alone is insufficient: the backend also requires fresh pending
PID gains, both heater targets off, and an idle printer. The result is staged;
previous control settings remain active until saved. The result offers **Save…** and **Discard…** directly beside the staged gains.
Each opens an inline dialog listing **all** pending Klipper settings, including
changes staged by other clients. Opening or closing the dialog does not change
the printer. Review every value before explicitly confirming either action.

Saving keeps the previous source for recovery, sends SAVE_CONFIG once, and verifies
saved bytes and startup. It requires the separate configuration application opt-in.
Read-only review remains available when saving is disabled. Discarding requires live
controls to be enabled, sends a soft restart once, and verifies the pending settings
are cleared while saved configuration stays unchanged. Either action requires an
idle printer with every heater target off. Discarding may release motors. Lost
acknowledgements remain unknown and are never automatically replayed.

If pending gains change or disappear, the result says so; disappearance alone
does not prove the proposed values were saved. Inspect active configuration.

## Owner-coordinated physical acceptance

Preliminary attended nozzle/bed runs and discard were verified with the owner.
Representative-temperature save and interruption/reconnect cases remain open in
[#100](https://github.com/colecrouter/perilune/issues/100). Automated tests use synthetic fixtures; before a new live PID session:

- Confirm the printer is idle, the correct heater and safe target are selected,
  both targets are zero, and the owner is attending the hardware.
- Run one nozzle test, then one bed test after cooldown. Observe temperature,
  result persistence through navigation/reconnection, targets off, and unchanged
  active control gains before save.
- Review every pending setting, explicitly save/restart, and verify the correct
  gains in active configuration and the previous source backup.
- Coordinate an interrupted test and emergency shutdown/recovery separately;
  verify no reheating or replay after recovery or backend restart.

References: [Klipper PID checks](https://www.klipper3d.org/Config_checks.html#calibrate-pid-settings),
[Klipper implementation](https://github.com/Klipper3d/klipper/blob/master/klippy/extras/pid_calibrate.py),
[Moonraker emergency stop](https://moonraker.readthedocs.io/en/latest/external_api/printer/).
