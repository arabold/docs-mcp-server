## 1. Migration Runner Safety

- [x] 1.1 Update `applyMigrations()` so migration execution never sets `journal_mode = OFF`.
- [x] 1.2 Keep rollback-safe migration pragmas for cache, mmap, temp storage, and `synchronous = NORMAL`.
- [x] 1.3 Preserve post-migration production settings for WAL mode, autocheckpointing, busy timeout, foreign keys, and `synchronous = NORMAL`.
- [x] 1.4 Ensure failed migrations keep `_schema_migrations` unchanged and surface the original failure through `StoreError`.

## 2. Progress Reporting

- [x] 2.1 Add support for full-line SQL checkpoint markers such as `-- @migration-step <label>`.
- [x] 2.2 Execute marker-delimited SQL blocks without splitting arbitrary SQL by semicolon, including SQL before the first marker as an implicit first block.
- [x] 2.3 Emit migration diagnostics that identify `migration index/total`, print one visible marker per completed block, and report success or failure.
- [x] 2.4 Report total elapsed time for each migration on success and failure.
- [x] 2.5 Ensure migrations without checkpoint markers execute as one implicit block and still log start, one completion marker, and elapsed time.

## 3. Migration 014 Hardening

- [x] 3.1 Add checkpoint markers to `014-rebuild-vector-partition-keys.sql` for preserve, rebuild, restore, backfill, and cleanup phases.
- [x] 3.2 Verify migration 014 preserves existing compatible vectors and backfills missing vectors from `documents.embedding`.
- [x] 3.3 Verify migration 014 derives partition keys from current `documents -> pages -> versions` relationships rather than stale vector metadata.

## 4. Tests

- [x] 4.1 Add a failure-path test proving a failed destructive migration preserves the old `documents_vec` table and data.
- [x] 4.2 Add tests proving migration 014 does not record `_schema_migrations` on failure and can be retried.
- [x] 4.3 Add tests for marker-delimited progress execution and failure logging behavior.
- [x] 4.4 Update existing migration tests to await the async migration runner consistently.

## 5. Documentation and Validation

- [x] 5.1 Document backup or copied-database validation guidance for destructive and large database migrations.
- [x] 5.2 Document the migration PRAGMA policy and why `journal_mode = OFF` is not used during schema migrations.
- [x] 5.3 Validate the workflow on a copied local database containing real vector rows.
- [x] 5.4 Run focused migration/store tests, typecheck, lint, and the broader test suite where practical.
