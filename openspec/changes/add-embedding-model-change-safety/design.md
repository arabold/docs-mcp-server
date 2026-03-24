## Context

The system uses embedding vectors for semantic search via `sqlite-vec`. Vectors are produced by a configured embedding model (e.g., `openai:text-embedding-3-small`) and stored in `documents.embedding` (JSON blob) alongside an indexed `documents_vec` virtual table. The vector table is currently created by a SQL migration with a hard-coded dimension of 1536.

PR 330 introduces runtime-configurable vector dimensions so different embedding providers (e.g., 1536d for OpenAI, 3584d for Gemini) can work without migration changes. However, it has critical gaps:

1. **Silent backfill of incompatible vectors**: When the dimension changes, `ensureVectorTable()` drops and recreates the vec table, then backfills old vectors that were padded to the previous dimension. These old vectors are dimensionally and semantically incompatible with the new configuration.
2. **No model change detection**: Switching between models with the same dimension (e.g., `text-embedding-3-small` to `text-embedding-ada-002`, both 1536d) is completely undetected. Old vectors remain, producing silently degraded search results.
3. **No user feedback**: There is no warning, confirmation prompt, or guidance when the embedding configuration changes.

The existing specs document this as a "known gap" in `embedding-generation/spec.md:154` but provide no solution.

**Stakeholders**: All users who configure embedding models, especially those running the server in MCP/stdio mode where there is no TTY for interactive prompts.

## Goals / Non-Goals

**Goals:**
- Detect embedding model and/or vector dimension changes at startup by comparing the current configuration against persisted metadata in the database.
- Require explicit user confirmation (interactive TTY) before proceeding with a destructive model change.
- Fail startup entirely in non-interactive mode (no TTY) when a model change is detected, with a clear error message explaining what happened and how to resolve it.
- On confirmed change, invalidate all existing vectors (set to NULL) and recreate the vec table empty -- no backfill of incompatible data.
- Silently initialize metadata on first startup or upgrade from a pre-metadata database.
- Adopt PR 330's `ensureVectorTable()` approach for runtime-configurable dimensions, but fix the broken backfill.

**Non-Goals:**
- Per-library or per-version model tracking. A global metadata record is sufficient; per-vector model tracking would bloat table sizes with no practical benefit since you cannot mix models within a search anyway.
- Automatic re-scraping after model change. The system invalidates vectors and continues in FTS-only mode; the user must manually re-scrape to regenerate vectors.
- Supporting multiple embedding models simultaneously. The system uses one model globally.
- Migrating or converting vectors between models. This is mathematically impossible for different embedding spaces.

## Decisions

### Decision 1: Global Metadata Table for Model Tracking

**Choice**: Store embedding model identity and dimension in a new `metadata` key-value table (`CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).

**Alternatives considered**:
- *Per-vector model column in `documents`*: Rejected -- massive storage bloat (one string per row) for information that is always the same globally. The system enforces a single model across the entire database.
- *Per-version model tracking*: Rejected -- adds complexity without benefit. Even if tracked per-version, you cannot search across versions with mixed models. A global record is sufficient to detect changes.
- *File-based metadata (e.g., `.embedding-meta.json`)*: Rejected -- metadata should live alongside the data it describes. A separate file can get out of sync with the database.

**Keys stored**:
- `embedding_model`: The full model spec string (e.g., `openai:text-embedding-3-small`). Compared against `config.app.embeddingModel`.
- `embedding_dimension`: The configured vector dimension as a string (e.g., `"1536"`). Compared against `config.embeddings.vectorDimension`.

### Decision 2: Fail Non-Interactive Startup on Model Change

**Choice**: When a model or dimension change is detected and `process.stdout.isTTY` is falsy, throw a fatal `EmbeddingModelChangedError` that prevents startup entirely.

**Rationale**: In MCP/stdio mode, there is no user present to see warnings. Silently degrading search quality or silently dropping vectors could lead to hours of confusion. A hard failure with a descriptive error message is the safest option for automated environments.

**Error message format**:
```
Embedding model change detected:
  Previous: openai:text-embedding-3-small (1536 dimensions)
  Current:  gemini:embedding-001 (768 dimensions)

All existing vectors are incompatible and must be invalidated.
To confirm this change, start the server interactively (with a TTY connected)
and follow the prompts.
```

**Alternative considered**:
- *Escape hatch env var (`DOCS_MCP_CONFIRM_MODEL_CHANGE=true`)*: Not adopted initially to keep the surface area small. Can be added later if automated deployments need it.

### Decision 3: Interactive Confirmation Flow

**Choice**: When a model change is detected and `process.stdout.isTTY` is truthy, display a warning and prompt the user for explicit confirmation before proceeding.

**Flow**:
1. Display warning with previous vs. current model/dimension
2. Explain consequences: "All existing embedding vectors will be invalidated. Libraries must be re-scraped to restore vector search."
3. Prompt: `Proceed with model change? (y/N)`
4. Default is `N` (abort). Only `y` or `Y` confirms.
5. On confirm: invalidate vectors, update metadata, continue startup.
6. On abort: throw error, exit.

**Implementation**: The confirmation prompt is handled at the CLI layer (not in `DocumentStore`). `DocumentStore.initialize()` detects the mismatch and throws a structured error (`EmbeddingModelChangedError`) containing old/new model info. The CLI command handler catches this error and either prompts (TTY) or re-throws (non-TTY).

### Decision 4: Vector Invalidation Strategy

**Choice**: On confirmed model change, execute two operations in a transaction:
1. `UPDATE documents SET embedding = NULL` -- clears all stored embedding blobs
2. Drop and recreate `documents_vec` as empty (no backfill)

**Rationale**: Setting embeddings to NULL rather than deleting documents preserves all indexed content. FTS search continues working immediately. The user can re-scrape at their convenience to regenerate vectors.

**Alternative considered**:
- *Delete only from `documents_vec`, keep `documents.embedding` blobs*: Rejected -- stale blobs would be backfilled into the vec table on next dimension reconciliation, recreating the incompatibility problem.

### Decision 5: First-Run / Upgrade Behavior

**Choice**: If the `metadata` table does not contain `embedding_model` or `embedding_dimension` keys, silently store the current configuration values without prompting.

**Rationale**: Existing deployments upgrading to this version have no stored metadata. Requiring confirmation on upgrade would break all existing automated deployments. The first run establishes the baseline; subsequent changes are detected against it.

### Decision 6: Initialization Order in DocumentStore

**Choice**: The startup sequence in `DocumentStore.initialize()` becomes:
1. Load `sqlite-vec` extension
2. Apply migrations (including metadata table creation)
3. Check embedding model/dimension metadata (detect changes, throw if mismatch)
4. If no mismatch (or after confirmed invalidation): `ensureVectorTable()` with current dimension
5. Prepare SQL statements
6. Initialize embeddings client

This ensures the metadata check happens before any table manipulation, preventing the table from being left in an inconsistent state if the user aborts.

### Decision 7: Adopt PR 330's ensureVectorTable() With Fixes

**Choice**: Keep PR 330's approach of creating `documents_vec` at runtime with configurable dimensions, but modify the backfill behavior:
- On **first creation** (table doesn't exist): Create empty. Vectors will be populated during scraping.
- On **dimension match** (table exists, same dimension): No-op. Existing vectors are valid.
- On **dimension mismatch**: This case is now handled by the model change detection in step 3 above. By the time `ensureVectorTable()` runs, vectors have already been invalidated if needed.

The original PR 330 backfill (`INSERT OR REPLACE ... FROM documents WHERE embedding IS NOT NULL`) is removed entirely.

## Risks / Trade-offs

**[Risk] Non-interactive failure blocks automated deployments that intentionally change models** → Mitigation: The error message clearly explains how to resolve it (interactive startup). A future enhancement could add a `DOCS_MCP_CONFIRM_MODEL_CHANGE=true` env var escape hatch if demand warrants it.

**[Risk] First-run silent initialization stores wrong baseline if config is misconfigured** → Mitigation: The baseline is only stored after successful embedding initialization. If the model fails to initialize (bad credentials, invalid model), no metadata is stored, so the next attempt with correct config becomes the new "first run."

**[Risk] Setting all embeddings to NULL is expensive on large databases** → Mitigation: This is a single UPDATE statement that SQLite handles efficiently. The alternative (deleting and re-inserting documents) would be far more expensive and would break FTS indexes.

**[Risk] Users may not realize they need to re-scrape after model change** → Mitigation: The confirmation prompt and post-invalidation log message explicitly state that re-scraping is required. The system continues in FTS-only mode as a safety net.

**[Trade-off] Global model tracking vs per-version tracking** → We chose global for simplicity. This means the system cannot detect if individual versions were scraped with different models (e.g., if a user changed models between scraping two libraries). This is acceptable because: (a) search is always performed within a single version, and (b) the model change detection catches the transition point.
