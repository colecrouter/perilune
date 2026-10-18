# Account-scoped notification review

Independent reviewer: `review_notification_scope`.
Reviewed notification implementation `35f33eb` against `446e4ca`, plus the
follow-up history-schema, authorization-during-capture test and documentation changes.

Result: approved; no remaining actionable findings.

Resolved finding: a verified local run lost its owner when dispatch-time history
was unavailable and a later read supplied a history key. Local UUID ownership now
remains valid when no durable key was claimed. Conflicting non-null keys still
fail closed. Native slicer tests cover distinct, equal, absent and empty preflight
history cursors; unverified late keys never become durable claims.

The review inspected atomic simulator/live/slicer receipt attribution, default
account audience, all-print/shared-error opt-ins, capture eligibility, delivery
rechecks, preference compatibility and deployment assumptions. Follow-up review
confirmed the actual Moonraker `status: in_progress` schema and revocation during
a pending capture. The reviewer did not independently run validation.

Documented boundary: same-connection stale-row protection does not prove an atomic
object/history join after reconnect. Recovery trusts Moonraker's latest active
history identity; missing or contradictory identities remain unattributed. No
physical commands or actual device pushes were used for acceptance.
