# Persistence migration (unreleased)

The preferences and filament-change settings services use Drizzle's Effect-native SQLite adapter, pinned to
`drizzle-orm@1.0.0-rc.5`. Other application stores continue using Effect SQL;
Better Auth retains its existing Kysely/Node SQLite dialect and reservation bridge.
This bounded migration does not complete issue #90 or change printer behavior.

## Ownership and compatibility

- The adapter obtains the existing Effect `SqliteClient`. It opens no additional
  connection and enables neither query caching nor query parameter logging.
- The existing Effect migrator and numbered SQL remain authoritative. Drizzle
  table definitions mirror migrated tables; no Drizzle Kit, schema push, generated
  DDL, data rewrite or new migration ledger is introduced.
- Preferences retain their JSON text storage and single-statement `json_patch`
  upsert with `RETURNING`. Runtime domain parsing/defaults remain explicit.
- Existing outer transactions and connection reservations apply to ORM queries.
  Authentication's writer reservation and lock ordering remain unchanged.
- The query boundary unwraps the native `SqlError` from Drizzle's Effect cause to
  preserve service contracts. Unexpected wrapper causes become a sanitized
  `SqlError`; query parameters are excluded from ORM errors.

The version is a release candidate. Upgrades require explicit compatibility
verification; do not silently replace the adapter with a promise-based driver or
open another SQLite connection. Do not run each query through `runPromise` inside
an existing Effect transaction, since that can lose its transaction context.

## Pilot acceptance and next boundary

Tests cover account isolation, concurrent JSON patch merging, old JSON rows and
unknown-field preservation, restart persistence, unchanged schema, same-client
identity, nested/outer rollback, cancellation, read/write error contracts, and
actual Better Auth enrollment concurrent with ORM writes in both lock orders.
Full validation and native image install/backup/upgrade/rollback CI remain release
gates. The file format is unchanged, so rollback needs no reverse schema migration.

## Revision-guarded settings

Filament-change settings mirror migration 023. Reads use the SQL revision rather
than the historical revision inside the JSON. First saves insert only from revision
zero and refuse conflicts; subsequent saves atomically compare the current revision
and increment it. Both paths return whether exactly one row changed. The existing
Effect transaction encloses the reservation/session check and settings write, so
an active printer workflow still prevents setup replacement. The specialized
cross-table lock query remains explicit SQL. No data or schema rewrite is needed.

Tests cover competing first saves, competing updates, stale writes preserving the
winning plan, target isolation, active reservations/sessions, legacy rows, unchanged
schema, restart persistence, outer rollback, interruption and sanitized SQL errors.

## Remaining stores and beta scope

The following inventory records retained SQL boundaries, not missing features.
Full conversion is deferred beyond beta preparation under issue #90. Each later
batch needs its own lifecycle and compatibility review; do not combine these into
a mechanical rewrite.

| Boundary                                                   | Current ownership / retained implementation                                    | Required before a later migration                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Preferences; filament-change settings                      | Shared Effect client, native Drizzle; existing migrator                        | Keep atomic JSON merge and revision/CAS regressions; review adapter upgrades                                                          |
| Camera settings                                            | Camera setup service; revision-guarded SQL with source validation              | Preserve test/save fingerprints, CAS and secret sanitization; separate candidate batch                                                |
| Macro shortcuts; failure acknowledgements                  | Console service and failure-notice projection; explicit SQL                    | Preserve owner scoping, combined notice bounds and receipt-history projection                                                         |
| Jobs, files, attribution and slicer starts/keys            | Job/slicer services and attribution helper                                     | Preserve unique start fences, scoped credentials, file mutation journals and no-replay receipts                                       |
| Actions, console commands, live reservations and safety    | Action store, live-action/console/safety services                              | Preserve admission/execution checks, bounded queues, reservation transactions and unknown-outcome reconciliation                      |
| Configuration files/backups/saves/applications             | Configuration and application services                                         | Preserve source fingerprints, backup evidence, apply/restart phases and interrupted recovery                                          |
| Mesh evidence and mesh/Z/PID/filament workflow checkpoints | Process runtime, mesh services and calibration workers                         | Preserve checkpoint ordering, baseline/candidate evidence and explicit restoration obligations                                        |
| Push keys/devices/deliveries/images                        | Notification service                                                           | Preserve epochs, endpoint uniqueness, event/device deduplication, binary images and expiry; #91 changes delivery transport separately |
| Better Auth and custom account/recovery SQL                | Existing Kysely/Node SQLite dialect and shared asynchronous reservation bridge | Separate framework boundary review; preserve lock order, enrollment claims and fail-closed recovery                                   |
| Migrations, PRAGMAs and specialized queries                | Existing Effect migrator and explicit SQL                                      | Retain SQL where clearer; no ORM schema runner or second migration ledger                                                             |

No correctness defect was established merely by retaining these queries. A future
conversion must not become a beta prerequisite without a concrete release blocker.
The release-candidate adapter remains pinned to `1.0.0-rc.5`; version changes require
same-client, transaction/cancellation, error/privacy and native image lifecycle
checks. Existing install/backup/upgrade/rollback gates cover the unchanged SQLite
format; the ORM metadata itself is not an alternate schema authority.
