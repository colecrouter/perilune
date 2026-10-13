# Independent foundation review

An independent agent reviewed backend lifetime, action semantics, concurrency,
stream cancellation, origin handling, and deployment assumptions before this
iteration merged. It found five actionable issues in the initial foundation:

1. Compose misspelled the browser origin override.
2. Completion could overwrite concurrent telemetry/connection updates.
3. Storage errors could strand a sending action and lock controls indefinitely.
4. A brief disconnect/reconnect during sending could be forgotten.
5. An action could pass its deadline between selection and execution.

Fixes add the Compose config check, an explicit ActionStore boundary, atomic
terminal state publication, connection generation tracking, execution-time expiry,
and visible storage degradation with status-only recovery. Focused regression
tests exercise storage faults and gated writes, connection flaps, and deadline
crossing. Existing idempotency, queue-bound, restart, and UI-draft checks remain.

The reviewer independently re-ran the 21 domain tests and approved the fixes,
finding no remaining blocking correctness issue. The full suite has 25 tests,
including four headless browser tests, plus production and container smoke checks.
Future substantial changes require an independent review before merging; see
AGENTS.md.
