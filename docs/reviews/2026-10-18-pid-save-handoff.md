# PID save and discard review

Independent reviewer: `review_notification_scope`. Result: approved after one
recovery finding was resolved. Reviewed inline owner-only dialogs, all-pending
review, separate save/discard capabilities, unchanged saved bytes on discard,
execution-time checks, one-shot restart, unknown outcomes, recovery locks,
idempotency, and browser coverage.

The review found that discard recovery could accept a cleared flag with a
nonempty pending manifest. Execution and recovery now share a strict predicate
requiring an explicit false flag and an empty object manifest. A regression test
verifies contradictory state keeps the lock, then recovery clears it without
replaying the restart. The reviewer confirmed no remaining actionable findings.

Validation is reported in the PR. Synthetic fixtures were used; no real printer
configuration write, restart, movement, or heating was performed for this change.
