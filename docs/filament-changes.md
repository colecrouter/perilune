# Filament changes

## Slicer-managed workflow (unreleased)

Your slicer owns the filament-change sequence: it pauses the print and handles
loading, purging and any prime tower after you resume. Perilune adds no M600,
parking, unload or purge sequence.

Open **Controls → Filament changes**. An owner reviews the setup once: the selected
Resume command must return to printing in one call, without an extra loading or
purge stage. Review is bound to the printer configuration; changing it requires a
new review. Saving the setup sends no printer commands.

When your sliced print pauses:

1. Confirm that you are at the printer and begin the filament change. Beginning
   only adopts the existing pause; it sends no macro or movement.
2. Replace the filament. Insert the replacement into the extruder. Optional manual
   controls can help feed or retract it if needed.
3. Choose **Resume print**. Perilune sends the reviewed command once; the slicer
   continues its own loading/purge sequence.

Attendance stays confirmed through successful steps. Another session, operator,
configuration, continuity loss or recovery requires a new confirmation. Leaving the
page retains the shared session but does not retain an attendance confirmation.

### Optional manual extrusion

Expand **Manual extrusion** and confirm nozzle clearance. This verifies existing
printer parking without moving any axes. Feed/Retract buttons use the same control
as the extrusion workshop: 5, 10 or 25mm at 1mm/s. Every move requires a stationary
paused print, trusted coordinates, a hot nozzle, and the live-filament server
opt-in. Distance and speed must fit the printer's configured limits. Parser state
is saved and restored; a lost acknowledgement is never automatically repeated.

### Printer and slicer compatibility

A macro called `RESUME` may perform more than a resume. If it purges and leaves the
print paused, revise that setup in a coordinated printer review before choosing
slicer-managed changes. Perilune does not bypass it using a renamed base command
or automatically send Resume twice. A command that leaves the print paused becomes
a recovery condition, not another normal Resume step.

Check the generated slicer file too. Automatic tool-change loading intended for
an automatic filament system can conflict with manual loading or Klipper's
extrusion limits. Re-slice with an appropriate manual-change profile; do not raise
firmware safety limits to hide an incompatible load move.

Older macro/assisted plans and interrupted sessions remain stored for recovery.
New setup offers slicer-managed changes; finish old guidance before saving it.
No printer macros are installed or silently replaced.

The Jobs start review lists recognizable M600/pause locations from text G-code.
It cannot discover pauses hidden in templates or certify a printer's behavior.
See [Jobs](jobs.md#planned-manual-interventions), [Console](console.md) and
[live controls](live-controls.md).

The earlier macro/assisted workflow was available since **0.1.0-alpha.1**. The
slicer-managed replacement above is unreleased until its first tag.
