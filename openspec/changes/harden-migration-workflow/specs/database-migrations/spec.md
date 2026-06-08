## ADDED Requirements

### Requirement: Rollback-safe migration execution

The system SHALL execute database migrations with rollback-capable SQLite journaling enabled. The migration runner MUST NOT set `journal_mode = OFF` while applying migrations.

#### Scenario: Migration fails after destructive DDL

- **WHEN** a pending migration drops or rebuilds a table and a later statement in that migration fails
- **THEN** the migration transaction MUST roll back so the pre-migration table and data remain available
- **AND** the failed migration MUST NOT be recorded in `_schema_migrations`

#### Scenario: Migration pragmas preserve recoverability

- **WHEN** the migration runner prepares SQLite settings before applying pending migrations
- **THEN** it MAY apply cache, mmap, temporary-storage, and synchronous settings that preserve rollback behavior
- **AND** it MUST NOT disable journaling for migration execution

### Requirement: Production SQLite settings after migrations

The system SHALL configure production SQLite settings after migration execution completes, including WAL mode, bounded WAL checkpointing, busy timeout, foreign key enforcement, and `synchronous = NORMAL`.

#### Scenario: Post-migration settings are applied

- **WHEN** migrations complete successfully or the schema is already up to date
- **THEN** the database connection MUST be configured for WAL mode, bounded autocheckpointing, busy timeout, foreign keys, and normal synchronous durability

### Requirement: Visible migration progress

The system SHALL emit diagnostic progress for each pending migration. Progress MUST include the migration index and total pending migration count, migration identifier, a visible marker for each completed execution block, total elapsed time, and a completion or failure outcome.

#### Scenario: Migration with explicit checkpoints

- **WHEN** a migration file defines checkpoint markers for multiple migration phases
- **THEN** the runner MUST split the migration only on full-line checkpoint marker comments
- **AND** it MUST execute each marker-delimited SQL block as a whole without splitting by semicolon
- **AND** it MUST display one progress marker for each completed block
- **AND** the progress output MUST identify the migration being run

#### Scenario: Migration has SQL before the first checkpoint

- **WHEN** a migration file contains SQL before the first checkpoint marker
- **THEN** the runner MUST execute that SQL as an implicit first block
- **AND** it MUST preserve the SQL order relative to later checkpoint blocks

#### Scenario: Migration without explicit checkpoints

- **WHEN** a migration file has no checkpoint markers
- **THEN** the runner MUST still display migration start and completion diagnostics
- **AND** it MUST execute the whole migration as one implicit block
- **AND** it MUST report total elapsed time when the migration completes or fails

#### Scenario: Migration fails during a checkpoint

- **WHEN** a migration fails while running a checkpoint
- **THEN** the runner MUST emit a failure diagnostic for the migration
- **AND** it MUST NOT emit a success marker for the failed checkpoint
- **AND** it MUST report elapsed time up to the failure

### Requirement: Destructive migration validation

The system SHALL require tests for destructive migrations that verify both successful data preservation and failed-migration recoverability.

#### Scenario: Destructive migration succeeds

- **WHEN** a migration drops, renames, or rebuilds a table or virtual table
- **THEN** tests MUST verify that compatible pre-migration data is preserved after the migration succeeds

#### Scenario: Destructive migration fails

- **WHEN** a destructive migration test injects or creates a failure after the destructive operation would have occurred
- **THEN** tests MUST verify that pre-migration data remains available
- **AND** the migration marker MUST remain unapplied

### Requirement: Backup guidance for high-value databases

The system SHALL document a backup or copied-database validation workflow for large or high-value local databases before destructive migrations are applied.

#### Scenario: User prepares for a destructive migration

- **WHEN** documentation describes a destructive or large database migration
- **THEN** it MUST instruct users to back up or copy the database before running the migration against important local data
- **AND** it MUST explain how to validate the migration on the copy when practical
