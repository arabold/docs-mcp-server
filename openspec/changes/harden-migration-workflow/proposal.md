## Why

Database migrations can rebuild large SQLite virtual tables, including `documents_vec`, and must remain recoverable if any step fails. PR #416 exposed that the current migration runner prioritizes speed by disabling journaling, which conflicts with expected rollback behavior and increases data-loss risk during destructive schema changes.

## What Changes

- Define a safe migration workflow for destructive and large-dataset migrations.
- Preserve rollback safety by default for schema migrations, especially migrations that drop and recreate tables.
- Keep non-destructive performance tuning where it does not undermine recoverability.
- Add visible migration progress logging that reports meaningful migration phases, using step markers such as `Running migration 014-rebuild-vector-partition-keys.sql: ....`.
- Require migration failure tests for destructive migrations so data preservation and migration-marker behavior are verified.
- Document the operational expectation that users test large migrations on a backup or copied database before running against important local data.

## Capabilities

### New Capabilities

- `database-migrations`: Defines migration safety, recoverability, progress reporting, and validation requirements for SQLite schema/data migrations.

### Modified Capabilities

None.

## Impact

- Affects `src/store/applyMigrations.ts`, migration SQL files under `db/migrations/`, and migration tests.
- Does not change public CLI, MCP, or web APIs.
- May increase runtime and temporary disk usage for destructive migrations because rollback-safe journaling remains enabled.
- Improves recoverability for failed migrations and gives users clearer progress feedback during long-running database changes.
