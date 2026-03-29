## 1. Database Schema & Migrations

- [x] 1.1 Remove PR 330's destructive `012-drop-documents-vec-for-runtime.sql` migration (unnecessary — `ensureVectorTable()` reconciles dimensions at runtime without data loss)
- [x] 1.2 Create migration `013-create-metadata-table.sql` with `CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
- [x] 1.3 Add `EmbeddingModelChangedError` to `src/store/errors.ts` with fields for `previousModel`, `previousDimension`, `currentModel`, `currentDimension`

## 2. Metadata Persistence in DocumentStore

- [x] 2.1 Add prepared statements for metadata CRUD: `getMetadata(key)`, `setMetadata(key, value)` in `DocumentStore.prepareStatements()`
- [x] 2.2 Add `getEmbeddingMetadata()` method to read `embedding_model` and `embedding_dimension` from the metadata table
- [x] 2.3 Add `setEmbeddingMetadata(model, dimension)` method to write/update both keys in the metadata table
- [x] 2.4 Call `setEmbeddingMetadata()` at the end of successful `initializeEmbeddings()` to persist the active model identity

## 3. Model Change Detection

- [x] 3.1 Add `checkEmbeddingModelChange()` method to `DocumentStore` that compares stored metadata against current config and throws `EmbeddingModelChangedError` on mismatch
- [x] 3.2 Handle first-run case: if no `embedding_model` key exists in metadata, skip the check (silent initialization)
- [x] 3.3 Handle FTS-only case: if current config has no embedding model or credentials are missing, skip the check
- [x] 3.4 Integrate `checkEmbeddingModelChange()` into `DocumentStore.initialize()` after migrations but before `ensureVectorTable()`

## 4. Vector Invalidation

- [x] 4.1 Add `invalidateAllVectors()` method to `DocumentStore` that executes `UPDATE documents SET embedding = NULL` and drops/recreates `documents_vec` as empty
- [x] 4.2 Ensure `invalidateAllVectors()` updates the metadata table with the new model and dimension after clearing vectors
- [x] 4.3 Add logging to `invalidateAllVectors()` indicating vectors have been cleared and re-scraping is required

## 5. Fix ensureVectorTable() from PR 330

- [x] 5.1 Remove the backfill `INSERT OR REPLACE INTO documents_vec ... FROM documents WHERE embedding IS NOT NULL` from `ensureVectorTable()`
- [x] 5.2 Keep the dimension validation, existing-table detection, and drop/recreate logic from PR 330
- [x] 5.3 Confirm no backfill in `ensureVectorTable()` — vectors are populated during scraping, not at startup

## 6. Configuration Validation

- [x] 6.1 Add `.min(1, "embedding dimension must be at least 1")` to the `vectorDimension` Zod schema in `src/utils/config.ts` (from PR 330, already present)
- [x] 6.2 Verify that `DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION` env var is correctly auto-mapped via `mapEnvToConfig()`

## 7. CLI Interactive Confirmation Flow

- [x] 7.1 Add `EmbeddingModelChangedError` handling in the CLI startup path (likely `src/cli/utils.ts` or individual command handlers)
- [x] 7.2 Implement TTY detection: check `process.stdout.isTTY` when catching `EmbeddingModelChangedError`
- [x] 7.3 Implement non-interactive path: re-throw the error with a descriptive message instructing the user to start interactively
- [x] 7.4 Implement interactive path: display warning with previous/current model+dimension, prompt `Proceed with model change? (y/N)`, handle user input
- [x] 7.5 On user confirmation (`y`/`Y`): call `invalidateAllVectors()` on the DocumentStore, then retry initialization
- [x] 7.6 On user rejection (any other input or Enter): exit with error, no changes made

## 8. Update DocumentStore.initialize() Sequence

- [x] 8.1 Reorder initialization steps: (1) load sqlite-vec, (2) apply migrations, (3) check embedding model metadata, (4) ensureVectorTable(), (5) prepare statements, (6) initialize embeddings, (7) persist metadata
- [x] 8.2 Ensure `ensureVectorTable()` runs only after model change detection has passed (or after invalidation is complete)
- [x] 8.3 Expose a method or mechanism for the CLI layer to call `invalidateAllVectors()` and retry `initialize()` after user confirmation

## 9. Tests

- [x] 9.1 Test metadata table creation via migration (metadata table exists after `applyMigrations`)
- [x] 9.2 Test `getEmbeddingMetadata()` returns null when no keys exist (first-run)
- [x] 9.3 Test `setEmbeddingMetadata()` writes and reads correctly
- [x] 9.4 Test `checkEmbeddingModelChange()` throws `EmbeddingModelChangedError` when model differs
- [x] 9.5 Test `checkEmbeddingModelChange()` throws `EmbeddingModelChangedError` when dimension differs
- [x] 9.6 Test `checkEmbeddingModelChange()` does not throw when model and dimension match
- [x] 9.7 Test `checkEmbeddingModelChange()` does not throw on first run (no stored metadata)
- [x] 9.8 Test `checkEmbeddingModelChange()` does not throw when in FTS-only mode
- [x] 9.9 Test `invalidateAllVectors()` sets all embeddings to NULL
- [x] 9.10 Test `invalidateAllVectors()` recreates `documents_vec` as empty
- [x] 9.11 Test `invalidateAllVectors()` updates metadata with new model and dimension
- [x] 9.12 Test `ensureVectorTable()` creates table with configured dimension (no backfill)
- [x] 9.13 Test `ensureVectorTable()` is no-op when dimension matches
- [x] 9.14 Test Zod schema rejects `vectorDimension` of 0 or negative values
- [x] 9.15 Update existing `applyMigrations.test.ts` tests from PR 330 to account for metadata table

## 10. Documentation Updates

- [x] 10.1 Update `docs/guides/embedding-models.md` with a section on model change behavior (warning, confirmation, re-scraping)
- [x] 10.2 Update `docs/setup/configuration.md` to document `embeddings.vectorDimension` with its env var and validation rules
- [x] 10.3 Update `docs/concepts/data-storage.md` to describe the metadata table and embedding model tracking
