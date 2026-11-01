# Slicer-managed filament changes (unreleased)

The owner chose to replace new macro/assisted plans with slicer-owned changes after
attended acceptance exposed overlapping manual, macro and slicer loading/purging.
Private printer macros and the failing sliced file were inspected read-only; they
are not included here. No printer configuration or commands were changed.

Independent design review approved an explicit one-time, fingerprint-bound Resume
contract, adoption-only Begin, optional manual controls and retained legacy recovery.
The implementation review found consent-handoff and feedback issues, resolved by
the parent with regression coverage:

- Lost continuity clears attendance and the pending Begin handoff. User/account,
  session, generation and configuration bind consent; a completed Recover cannot
  satisfy an earlier Begin handoff.
- A staged Resume retains a fixed diagnostic in the unknown receipt and recovery
  session, without releasing its reservation or repeating the command.
- Execution-time failed/unknown receipts show their reason without duplicating a
  session alert.

The reviewer found no other actionable issues and independently passed six focused
tests before the final regressions. Parent focused validation subsequently passed
80 tests across workflow UI, live action lifecycle and slicer planning suites.
Type checking reports zero errors/warnings. Coverage includes adoption without
commands, a single Resume through delayed telemetry, staged-macro recovery,
variable manual feed limits and parser restoration, interrupted handoff, account
switching, accepted-then-failed receipts and legacy session access.

Production smoke/full validation and exact-head CI remain release gates. Real
compatibility is not accepted by these synthetic tests. The owner's staged Resume
macro and slicer loading profile need coordinated review/re-slicing before another
physical test; the app does not bypass the macro or raise firmware limits.

CI follow-up: the live-actions smoke still selected retired printer/assisted
methods. It now exercises slicer pause adoption and clearance verification with
zero commands, navigation/reload consent handling, two explicit manual moves and
exactly one Resume. This caught manual controls unmounting/collapsing during a
pending feed; the UI now keeps them mounted and disabled, with a component
regression. The production live-actions smoke and all seven workflow browser
tests pass. Final full validation/CI are rerunning on the follow-up.
