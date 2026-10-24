# Persistence migration pilot (unreleased)

The preferences service uses Drizzle's Effect-native SQLite adapter, pinned to
`drizzle-orm@1.0.0-rc.5`. Other application stores continue using Effect SQL;
Better Auth retains its existing Kysely/Node SQLite dialect and reservation bridge.
This pilot does not complete issue #90 or change printer behavior.

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

The next candidate is the filament-change settings store, whose revision-guarded
write adds a useful compare-and-swap case. Workflow journals and command stores
should follow only after those semantics pass. Authentication's custom synchronous
SQL needs a separate boundary review; its framework adapter is not replaced by
this pilot. Retain explicit SQL where a migration, PRAGMA or specialized operation
is clearer and better supported.
