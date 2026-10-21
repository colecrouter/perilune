# Remote function completion review

Independent reviewer: `review_remote_completion`. Approved subject to full
`pnpm validate` passing.

The reviewer inspected correctness, permissions/session boundaries, lifecycle,
request limits, route removal, tests and deployment assumptions. Initial findings
were resolved:

- Public remote entry/pairing calls are explicitly admitted by the auth hook;
  all private functions retain server-side identity/role checks. The hook uses
  the original request URL because command events expose the calling page URL.
- Private remote calls authenticate before body parsing even when the caller
  claims a public page. Static/auth early hook branches exclude remote requests;
  spoofed static/auth page headers cannot bypass body guards. Tests cover these
  paths and declared oversized bodies receive a 413 response before stream reads.
- Remote wire payloads retain finite size/time bounds before framework parsing;
  application payload schemas retain their own limits and service validation.
- Pairing poll completion checks component lifetime before redirecting. Login and
  pairing delayed-response cookie ordering tests pass using the remote protocol.
- Preference writes are drained before following links, with failed writes left
  retryable. Bubbling interception respects custom confirmation handlers and
  preserves explicit client navigation used for configuration drafts. Tests cover
  held/coalesced writes, failed saves, client links and handled links.

Final review found no further blockers. The smoke helper exercises actual
production remote endpoints and serialization rather than restoring removed API
routes. Retained routes serve media/native URL consumers, upload progress, SDK
authentication or external slicer contracts. No database migration or physical
printer command is part of this change.

CI follow-up review approved extracting `/app/build` from the actual runtime image
before host-side protocol tests, and matching the new enrollment command in the
console smoke. The isolated Docker smoke and console smoke passed. The simulated
query response also includes its query-cache node; live-actions passed, including
reopening a review after the fixture's pending gains changed. All 14 smoke suites
passed, with affected suites rerun after these test-harness fixes. The 620 tests,
production build and formatting checks passed.
