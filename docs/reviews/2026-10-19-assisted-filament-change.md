# Assisted filament handling and paused-print notices

Independent reviewer: `review_assisted_design`. Approved after two actionable
findings were resolved: assisted feed controls now respect the server filament
opt-in, and interrupted parking/recovery explains that a new relative lift starts
from the current position and may follow a previously executed uncertain lift.

The review covered the generated command/state semantics, native scale overrides,
parser and physical position verification, transform exclusions, limits, durable
worker ownership, uncertain outcomes, settings review and notification audience.
No physical operations or deployment were performed during review.

Synthetic acceptance covers printer parking without extra movement, generated
Z-before-XY parking, duplicate UUIDs, duplicate parking, explicit bounded extrusion,
lost acknowledgement without replay, position drift, cold/over-limit rejection,
server opt-in and unsupported topology/native overrides. Notification tests cover
legacy default-off preferences, independent pause occurrences, stable-pause
suppression, reconnect baseline, job audience, quiet hours and snapshot delivery.
The headless protocol workflow exercises setup, pause, parking inspection,
unload/load, reload, fresh attendance and Resume at desktop and 390px widths.

Native collaborative browser QA used an isolated synthetic protocol fixture.
The filament route had the expected title/content, no framework overlay or relevant
console errors. An explicit purge produced verified feedback and reset attendance;
390px layout had no horizontal overflow and stacked usable handling buttons.
The existing frontend-testing-debugging workflow was used with the native T3
preview. No live camera media or physical printer was involved.

Physical filament movement, return-to-print behavior of the owner's custom macros
and actual push delivery for a paused print remain attended owner acceptance.
