# Browser pairing and slicer integrations review

Independent agent review covered authentication, revocation and cancellation races,
key expiration, UI regressions, request bounds, migrations, tests, and deployment.

Resolved findings:

- Forward session-renewal cookies through the HTTP hook. Internal identity checks
  are read-only so they cannot consume a renewal before headers reach the browser.
- Keep pairing redemption read-only for the previous session; its renewal cookie
  must not overwrite the newly paired session cookie.
- Separate polling and action rate budgets so waiting browsers sharing an address
  do not prevent approval.
- Cancel grants durably, suppress stale polling results, and revoke sessions created
  during a cancellation race. One-time redemption never reopens ambiguous outcomes.
- Add the general pairing entry point to normal login.

The reviewer inspected the fixes in subsequent rounds and reported no remaining
blockers. Auth smoke covers persistent Chromium close/relaunch, ordinary HTTP cookie
renewal, replacement of an aged prior login, linked integration disconnect, separate
browser revocation, cancellation, and origin enforcement. Unit tests cover denial,
expiry, recovery epochs, single-use redemption, ownership, optional key expiration,
and cancellation during session creation.

Deployment uses auth migration 004 and Effect SQL migration 018. The Dockerfile
copies all auth SQL files. Existing API keys keep their original expiration; newly
issued keys default to no expiration. Browser sessions use a 90-day renewable lifetime.

Actual Orca/WebKit retention on macOS remains an owner-assisted acceptance check.
No real printer commands are part of this acceptance flow.
