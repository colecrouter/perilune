# Printer lock guidance review

Independent reviewer: `review_printer_lock_guidance`. Result: approved after
resolving role-restricted activity links and preserving reconnect reason priority
in temperature controls.

The reviewer inspected fixed snapshot-derived notices, safety/action recovery
precedence, role-aware destinations, console publication/removal, draft lifecycle,
and unchanged admission conditions. Viewer storage notices now ask an operator or
owner for help instead of linking to an inaccessible activity page. Existing
emergency and configuration recovery flows remain in charge of those cases.

Domain/browser tests cover healthy vs uncertain workflow states, removal after
resolution, fixed-text diagnostic privacy, viewer permissions and console priority.
Service coverage verifies console guidance follows shared state and clears after
resolution. Production mesh smoke observes global/console links while preserving
heater and command drafts through calibration ownership and resolution.

No workflow was cleared on the live printer, and no physical printer action was
issued for this work. Validation and rendered QA results are recorded in the PR.

Native collaborative browser QA used the isolated synthetic Moonraker fixture at
desktop and 390px widths. The overview showed the same workflow explanation beside
temperature controls and globally; the global review link opened the bed-mesh
review. No console errors or horizontal overflow were observed. Production mesh
smoke passed with heater/console drafts retained and notices removed after save.
