# Emergency recovery (#88)

An independent agent reviewed the service, durable migration, forms, permissions,
restart lifecycle and tests before merge. Approved subject to validation/CI.

Resolved finding: the restart confirmation's explanatory text was accidentally
placed in a repeated title branch. It now appears in the confirmation body.

Review verified durable offline hazard acknowledgement, explicit owner-only
restart, authorization/expiry at dispatch, one-shot restart IDs, generation and
emergency-epoch fences, fresh ready/idle/all-heaters-off verification, preservation
of unrelated unknown outcomes, and native/enhanced form behavior. Concurrency
coverage includes a new emergency during readiness verification. Startup tests
preserve hazard review and uncertain restart receipts without replay.

No live printer emergency shutdown/restart was triggered for this implementation;
physical acceptance is tracked separately on #52. The protocol fixture simulates
shutdown/disconnect/ready notifications and validates the end-to-end UI.
