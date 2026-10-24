# Overview and everyday printing

Available since **0.1.0-alpha.1**. This guide describes **0.1.0-alpha.2**.

![Overview with synthetic printer data](images/overview.png)

Overview brings together the current job, heater readings, temperature history
and selected camera. The backend owns the printer connection, so another browser
can observe the same job without becoming its controller.

1. Open **Jobs** and upload or select a G-code file. Review its filename and any
   recognized pause/filament-change locations before starting.
2. Follow progress from any page. Pause, resume and stop use the shared print
   notice; stopping asks for confirmation.
3. An accepted request has a receipt. Pending is different from completed, and an
   unknown outcome must be inspected before another action is attempted.
4. If controls are locked, use the explanation and recovery destination in the
   notice. Reloading is not a recovery action.

**Customize** lets you hide and reorder optional panels. Save commits the layout
to your account; Cancel abandons the staged edit. Printer status, safety and heater
readings remain available even when optional panels are hidden. Camera panels stop
viewing when hidden. See [preferences](preferences.md).

Temperature controls retain edits while fresh readings arrive. Reconnection does
not clear the page or input drafts. Physical controls require the host's separate
[opt-ins](live-controls.md); simulator actions do not operate hardware.

For a phone-sized preview, see the [documentation index](README.md#preview).
Related guides: [Jobs and slicers](jobs.md), [camera setup](camera-setup.md),
[action receipts](actions.md), [recovery](recovery.md).
