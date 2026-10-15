# Configuration workspace review

Independent reviewer: `config_review` agent, 2026-10-14.

Scope: raw-source preservation and narrow guided edits; Klipper generated suffix;
owner-only SSR/API/live reads; bounded I/O; simulator SQLite revision/save/backup
lifecycle; browser drafts, review, conflicts and exports; deployment assumptions.

Two actionable findings were resolved and re-reviewed:

- Failed same-page file navigation unmounted the editor and discarded drafts.
  The page now retains its last successful document and mounted per-file draft
  store on allowed-owner load errors. It clears retained state for nonowners.
  Production coverage removes a listed fixture file before following its link,
  verifies the open draft survives the load error, and returns to that draft.
- Invalid guided input could remain visibly typed while later edits permitted
  review of the old canonical value. Rejected input now visibly reverts to the
  canonical source value. A browser regression edits an invalid field followed
  by a valid one, then verifies displayed values and raw text agree.

The reviewer also approved request-body deadlines/abort cleanup and disabling
editable controls until hydration. Backend review confirmed transactional backups,
revision checks and owner-bound deduplication, generated-suffix comparison,
fixed-root live GET reads with redirect refusal, private authentication headers,
size/deadline limits, and suppression of revoked read results.

Independent review approved after fixes, with no remaining blocking findings,
contingent on full validation and CI. Live writes remain disabled; simulator saves
do not mutate running printer state. Private configuration content is excluded from the shared dashboard and action
payload/history. Public fixtures contain only synthetic examples.

The reviewer also checked immediate scalar input handling: valid edits enable
review without waiting for blur, while a rejected final value restores the
focus-time source baseline and displayed value. Production checks exercise this
through the second client's focused edit before conflicting save.

Local verification covers the domain/service/browser suite, owner-only SSR/API,
transaction rollback/retry, bounded save admission and retention, source bytes,
unsafe live paths/redirects/oversize/timeouts/revocation, full production
save/conflict/restore/offline flows, and live export without writes. The complete
validation command and GitHub Docker pipeline are required before merging.
