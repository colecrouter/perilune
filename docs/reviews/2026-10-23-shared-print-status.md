# Shared print status review

The first independent review found a P1 navigation gap: a lost acknowledgement
whose receipt had not arrived was kept only in mounted component state. The fix
journals account-scoped IDs before transport, retains absent outcomes across full
document navigation and cross-tab updates, and reconciles terminal/reviewed
receipts without retrying physical commands. In-flight callbacks retain the
original account; Stop review binds both account and job generation.

Explicit receipt reconciliation atomically closes an absent request ID, so its
late original admission cannot execute. Existing receipts and other accounts'
receipts are never modified. Domain/service tests cover simulator and live late
admission, privacy, review metadata, cold journal restoration, storage behavior,
account changes and no automatic resend. The focused suite passes 85 tests across
five files, including headless browser tests. Full follow-up review and release
validation remain pending.

The production core smoke passes shared controls on Account, retained state through
navigation, a failed Resume response with no receipt, document navigation preserving
its ID, explicit reconciliation and refusal of a late original POST. No physical
printer commands have been issued against a real printer.

Follow-up review found two additional paths to track (Jobs Start and the dedicated
start/stop confirmation) and recovery access disappearing after completion. All
enhanced print submissions now use the account journal, including the calibration
preparation stop helpers with their exact forwarded IDs. Receipt checking is
independent of active-print controls and remains available after completion or
while safety recovery has priority. Final independent working-tree review found
no remaining actionable issues within its synthetic/simulator verification scope;
real printer acceptance remains attended. The updated focused suite passes 88 tests
across five files and type checks are clean.

Production core, Jobs, progressive/no-JS and loopback live action smokes pass. New
cases cover missing Start, Resume and confirmed-Stop receipts across document
navigation, explicit absent-ID closure, and refusal of a late POST. Stale Stop
confirmation is disabled when a new job replaces its reviewed generation, while
its heater choices survive ordinary telemetry updates. Headless rendered QA checked
desktop and 320px print status, Account controls, console draft retention and Stop;
no page errors or overflow were observed. Native preview snapshots twice timed out
with `Preview automation snapshot timed out after 15000ms.` Repository headless
Playwright provided the fallback. Full `pnpm validate` and Docker CI remain release
gates. A final CSS check removes excess mobile flex-basis spacing in the notice.
