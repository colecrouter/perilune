# Account and integrations remote-function review

Independent reviewer: `review_remote_account`. Approved subject to smoke validation.
No production correctness/security blockers were identified. The browser test's
old REST mock was replaced with a remote-query mock and an assertion that initial
rendering performs no fetch. The SSR host field uses the existing validated
installation origin rather than Kit's restricted query URL or forwarded headers.

The review checked command authorization and owner scoping, Kit's cross-origin
remote-command rejection, private summaries versus one-time credentials,
request/session/shutdown cancellation via jobOperation, identity revalidation after
async reads, explicit refresh without draft loss, private response caching, and
compatibility endpoint retention. No schema migration, worker-lifetime change or
physical-printer operation is introduced.

Smoke additions cover viewer/cross-origin command replay rejection, paired browser
and slicer summaries in direct documents, exclusion of one-time slicer tokens from
SSR, and removal of the old mount-time integrations REST reads.
