# Customizable Overview review

The owner approved the interactive Balanced, Camera focus and Compact proposal.
The existing midnight rail, page header position, warm surfaces, serif headings,
teal actions and lavender selection treatment are retained. The proposal's
illustrative job/camera data are not shipped as product content. Existing job
controls, recovery guidance and heater forms remain real shared workflows.

Independent review round 1 found failed optimistic layout saves could remain queued
after Cancel, additional heaters could disappear with optional panels, and sensor
button names omitted readings. The implementation now uses a serialized confirmed
preference commit, keeps every heater in the mandatory summary, and includes
readings in accessible names. Regression coverage exercises failure without later
accidental retry, sensor focus and unavailability.

Round 2 found a waiting commit could capture a new account generation after waiting,
and a new UI assertion used an unsupported matcher argument. Generation is captured
before waiting and checked before submission; an account-switch regression proves
no second-account request is issued. The matcher now asserts the complete message.
Round 3 approved with no remaining actionable findings and independently passed 17
tests across 5 files. Review limits excluded full validation, production visual QA,
Docker and physical actions; those remain the maintainer/CI responsibilities.

The production smoke extension checks Cancel, presets, hide/reorder with retained
unsent heater input, temporary reveal, full-document account preference loading,
reset and 320px layouts. Chart resize checks wait for ResizeObserver to settle.

Native preview snapshot twice returned
`Preview automation snapshot timed out after 15000ms.`; repository headless
Playwright is used for production visual QA. Only synthetic simulator data is used.
No real printer movement, heating or configuration write is part of this work.

Visual comparison checks page header alignment, unchanged navigation/palette,
fixed job/safety hierarchy, two-column versus phone panel order, explicit dialog
controls and compact sensor rows. Existing job actions/metrics and heater forms
are retained rather than replacing them with the proposal's simplified sample
content. The standalone history panel removes its former nested divider and uses
the existing serif heading style. Camera-empty and disconnected states retain
existing explanations.

Maintainer checks passed 667 tests across 96 files, type checks and a production
build. The extended main production smoke passed the layout acceptance checks.
At 320px the mobile dialog uses a sticky action footer so Save/Cancel remain
reachable while the panel list scrolls; existing dialog focus management is used.
