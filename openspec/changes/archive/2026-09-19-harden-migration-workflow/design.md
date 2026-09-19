## Context

The migration runner previously executed pending SQL migrations inside an IMMEDIATE transaction, but it also applied `journal_mode = OFF` and `synchronous = OFF` before running them. Those settings were introduced to speed up large vector-table migrations and reduce runtime pressure, then production settings such as WAL mode and `synchronous = NORMAL` were applied afterward.

That workflow is risky for destructive migrations because rollback cannot be trusted when journaling is disabled. PR #416 rebuilds `documents_vec` to use sqlite-vec partition keys, and a failure after dropping the old virtual table could lose the vector index even though `_schema_migrations` does not mark the migration complete.

The project already documents transaction rollback as a data consistency guarantee, and historical issues call out migration atomicity, rollback, and backup expectations.

## Goals / Non-Goals

**Goals:**

- Keep migrations recoverable by default, including migrations that drop and recreate tables or virtual tables.
- Preserve safe performance tuning that does not disable rollback.
- Provide visible progress for long migrations without changing structured command output contracts.
- Make destructive migration failure behavior testable.
- Document and test a backup/copy workflow for high-value local databases.

**Non-Goals:**

- Build a full migration framework with TypeScript migration files.
- Add automatic live-database backup before every migration.
- Solve all disk-space constraints for very large SQLite databases.
- Change public CLI, MCP, or web APIs.

## Decisions

### Keep rollback-capable journaling during migration execution

The migration runner will not set `journal_mode = OFF` before applying migrations. It will continue to use an IMMEDIATE transaction and may apply rollback-safe pragmas such as `synchronous = NORMAL`, `mmap_size`, `cache_size`, and `temp_store`.

Alternatives considered:

- Keep `journal_mode = OFF` for speed: rejected because destructive migrations can become unrecoverable on failure.
- Toggle `journal_mode = OFF` only for explicitly marked migrations: rejected for now because the safety benefit depends on perfect classification and future migration authors could mislabel destructive changes.
- Create a backup automatically before every migration: rejected for initial implementation because database copies can be expensive and surprising; documented copy-based testing is the safer first step.

### Retain production WAL configuration after migration

After migrations complete, the runner will continue applying production settings: WAL mode, bounded autocheckpointing, busy timeout, foreign keys, and `synchronous = NORMAL`. This preserves the existing concurrency and durability intent while separating runtime settings from migration execution safety.

Alternatives considered:

- Leave whatever journal mode the database had before startup: rejected because existing behavior intentionally normalizes production SQLite settings.
- Disable WAL entirely to avoid WAL growth: rejected because post-migration autocheckpointing already bounds WAL growth and WAL improves concurrent reads.

### Add migration progress checkpoints

Migration progress will be emitted by the migration runner as diagnostics, not by SQL itself. The runner will display the migration number, total pending migration count, migration filename, one dot per completed block, and total elapsed time. The output may be a single line or multiple lines depending on what fits existing logging conventions best.

For SQL migrations, blocks are delimited only by full-line marker comments:

```sql
-- @migration-step preserve existing vectors
...
-- @migration-step rebuild vector table
...
```

The runner will not split SQL by semicolon. Each block between markers is passed whole to `db.exec()`. SQL before the first marker is allowed as an implicit first block. If no markers exist, the whole migration runs as one implicit block and emits one completion dot. This keeps existing migrations compatible and avoids pretending to know progress within a long single SQLite statement.

Example output:

```text
Applying migration 5/14 014-rebuild-vector-partition-keys.sql: ..... done in 42.8s
```

Multi-line output is also acceptable when it is clearer for long migrations:

```text
Applying migration 5/14 014-rebuild-vector-partition-keys.sql
  preserve vectors. rebuild table. restore vectors. backfill. cleanup.
Completed in 42.8s
```

Alternatives considered:

- Print fixed timer-based dots while `db.exec()` runs: rejected because it suggests progress even if SQLite is blocked or stuck.
- Split every SQL file by semicolon: rejected because SQL parsing is fragile and can break triggers or string literals.
- Require all migrations to be TypeScript: rejected as too large a change.

### Require failure-path tests for destructive migrations

Any migration that drops, renames, or rebuilds a table or virtual table must include a test that forces a failure after the destructive point and verifies the original data remains available, the migration marker is not written, and retry behavior remains possible.

Alternatives considered:

- Only test successful migration results: rejected because it misses the exact data-loss class this change addresses.
- Rely on SQLite transaction tests generically: rejected because sqlite-vec virtual tables and PRAGMA choices can have different behavior than ordinary tables.

## Risks / Trade-offs

- [Longer migration runtime] → Keep rollback-safe performance pragmas and test against copied large databases.
- [Higher temporary disk usage] → Document backup/copy testing and log clear migration start/completion messages so users understand what is happening.
- [Progress dots may be sparse for long single statements] → Prefer marker-level checkpoints and include total elapsed time.
- [Existing migrations may lack markers] → Treat markers as incremental; unmarked migrations still log start and completion.
- [Manual SQL marker parsing could be brittle] → Only split on full-line marker comments, allow an implicit first block, and execute each block exactly as written.

## Migration Plan

1. Update `applyMigrations()` to remove unsafe `journal_mode = OFF` and `synchronous = OFF` migration pragmas while retaining safe cache/temp pragmas.
2. Add migration progress diagnostics with start/completion messages and marker-based checkpoints.
3. Add marker comments to migration 014 for major phases: preserve, rebuild, restore, backfill, cleanup.
4. Add failure-path tests for migration 014 and progress-output tests for marker handling.
5. Document that important databases should be copied or backed up before running large destructive migrations.
6. Validate on a copied local database containing real vector rows before merging.

Rollback strategy: if the implementation causes migration regressions, revert the runner changes. Databases migrated successfully remain compatible because the schema changes are unchanged; the workflow only changes execution safety and diagnostics.

## Open Questions

- Should the runner expose a CLI flag to suppress progress diagnostics for scripts beyond the existing quiet/logging behavior?
- Should migration marker comments become required for all future destructive migrations, or only recommended after migration 014?
