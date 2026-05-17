## Why

The system currently has no mechanism to detect when the configured embedding model or vector dimension changes between startups. Vectors produced by different embedding models are semantically incompatible -- cosine similarity between them is meaningless -- yet the system silently continues serving degraded search results. PR 330 introduces configurable vector dimensions but compounds this problem by silently backfilling old vectors into a potentially incompatible table. This change adds safety rails to prevent silent data corruption and enforce explicit user acknowledgment before invalidating existing vectors.

## What Changes

- **BREAKING**: Non-interactive startup (MCP/stdio) SHALL fail with a descriptive error when an embedding model or dimension change is detected, requiring manual interactive confirmation.
- Store the active embedding model identifier and vector dimension as global metadata in the database to enable change detection across restarts.
- On first startup (or upgrade from a database without metadata), silently initialize the metadata record with the current configuration -- no user action required.
- When a model or dimension change is detected during interactive startup, display a warning explaining that all existing vectors will be invalidated, and require explicit user confirmation before proceeding.
- On confirmed model/dimension change, set all `documents.embedding` values to `NULL` and recreate the `documents_vec` table empty (no backfill of incompatible vectors).
- Adopt PR 330's runtime-configurable `documents_vec` creation via `ensureVectorTable()`, but remove the broken backfill that inserts old-dimension vectors into a new-dimension table.
- Add Zod validation ensuring `vectorDimension >= 1`.

## Capabilities

### New Capabilities
- `embedding-model-change-safety`: Defines startup-time detection of embedding model/dimension changes, interactive confirmation flow, non-interactive failure behavior, vector invalidation on confirmed change, and metadata persistence for tracking the active embedding configuration.

### Modified Capabilities
- `embedding-generation`: Close the documented "known gap" about model change tracking. Add requirements for vector invalidation when the model changes, and update dimension normalization to cover runtime-configurable vector table creation.
- `embedding-resolution`: Add requirements for persisting resolved model identity to the database and detecting mismatches on subsequent startups.
- `configuration`: Add `embeddings.vectorDimension` as a documented configurable parameter with Zod validation (`>= 1`).

## Impact

- **`src/store/DocumentStore.ts`**: Major changes to `initialize()`, new `ensureVectorTable()` method (from PR 330, modified), new metadata read/write methods, new vector invalidation method.
- **`src/store/embeddings/`**: No structural changes, but `EmbeddingConfig` output is now persisted to the database.
- **`src/utils/config.ts`**: Minor -- add `.min(1)` validation on `vectorDimension` (from PR 330).
- **`db/migrations/`**: New migration to create `metadata` table. Migration 012 from PR 330 (drop `documents_vec`) is adopted.
- **`src/cli/`**: Startup commands need to handle interactive confirmation prompts and non-interactive failure for model changes.
- **User-facing docs**: `docs/guides/embedding-models.md` and `docs/setup/configuration.md` need updates explaining model change behavior and `vectorDimension` configuration.
