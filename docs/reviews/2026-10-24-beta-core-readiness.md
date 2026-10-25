# Beta core workflow readiness

Independent review: `perilune-beta-readiness-review-1` requested stronger keyboard
proof. Opening via mouse and checking Escape was insufficient. The follow-up now
opens the dialog/menu by keyboard, verifies focus entry, checks Tab/Shift+Tab wrap
boundaries, exercises menu Down/Up navigation and checks Escape focus return.

Final reviewer `perilune-beta-readiness-review-2` approved with no actionable
findings and independently passed all 143 scans against an isolated SQLite fixture
on a separate port. Smoke inventory and whitespace checks also passed. The reviewer
inspected scoped contrast fixes, development-only dependency, CI and documentation.

The parent used the native collaborative preview for setup/login, core route
inspection, initial desktop accessibility scans and mobile layout inspection.
Initial desktop evidence found low-contrast secondary/sensor text. The expanded
headless matrix additionally found dark teal-on-tint and destination legend issues;
all are corrected without changing physical-command behavior. Native preview later
lost its automation host during screenshot capture, so final evidence uses the
repository headless browser workflow. All data are synthetic.

Scope: 15 authenticated default routes in two themes/four widths, 15 enlarged-text
states, two keyboard dialog/menu states and six public entry/recovery states.
Existing component and protocol suites remain the evidence for reconnect/draft,
permission and failed/unknown-outcome cases. This is not full WCAG certification.
Manual screen-reader/native zoom, phone and printer acceptance remain deferred.
Parent full validation and exact-head Docker/native image CI are merge gates;
final results are recorded in the PR.
