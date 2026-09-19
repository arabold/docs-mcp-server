# embedding-model-change-safety Specification

## Purpose
Protects the vector index from silent corruption when the configured embedding model or vector
dimension changes between runs. The system persists the active embedding configuration as
metadata, detects mismatches against the currently configured model/dimension on startup, and
maintains a vector table whose schema matches the configured dimension so that stale or
incompatible embeddings are never mixed with new ones.

## Requirements

### Requirement: Embedding Metadata Persistence
The system SHALL persist embedding model metadata to the SQLite `metadata` table after successful embedding initialization. The metadata SHALL include the configured model specification and the resolved effective vector dimension used by the database. The system SHALL update this metadata atomically with successful initialization, not during partial or failed initialization.

The persisted dimension SHALL be the same dimension used for `documents_vec` table creation and vector normalization. For known fixed-output models this is the known dimension unless explicitly overridden. For unknown or variable-dimension models this is the runtime-detected provider output dimension on first successful initialization unless explicitly overridden. On later startups with the same model and no explicit dimension change, the persisted dimension SHALL be reused as the locked database dimension without probing the provider.

#### Scenario: Persist fixed known model metadata
- **WHEN** embeddings initialize successfully with `openai:text-embedding-3-small`
- **AND** no explicit dimension override is configured
- **THEN** the system SHALL persist `embedding_model = "openai:text-embedding-3-small"`
- **AND** the system SHALL persist `embedding_dimension = "1536"`

#### Scenario: Persist runtime-detected model metadata
- **WHEN** embeddings initialize successfully with `openai:custom-embedding-model`
- **AND** the provider returns a 1024-dimensional startup probe
- **THEN** the system SHALL persist `embedding_model = "openai:custom-embedding-model"`
- **AND** the system SHALL persist `embedding_dimension = "1024"`

#### Scenario: Do not persist metadata on initialization failure
- **WHEN** embedding initialization fails before completion
- **THEN** the system SHALL NOT overwrite existing embedding metadata
- **AND** the system SHALL NOT write new embedding metadata

#### Scenario: Metadata stored after successful embedding init
- **WHEN** the embedding model `openai:text-embedding-3-small` with dimension 1536 initializes successfully
- **THEN** the system SHALL store `embedding_model = "openai:text-embedding-3-small"` in the `metadata` table
- **AND** the system SHALL store `embedding_dimension = "1536"` in the `metadata` table

#### Scenario: No metadata stored in FTS-only mode
- **WHEN** embeddings are disabled (no model configured or missing credentials)
- **THEN** the system SHALL NOT store any embedding metadata
- **AND** the `metadata` table SHALL remain empty (for embedding keys)

### Requirement: First-Run Silent Initialization
On first startup, or when upgrading from a database that does not yet contain embedding metadata keys, the system SHALL silently store the current embedding configuration without prompting the user. This establishes the baseline for future change detection.

#### Scenario: First startup with new database
- **WHEN** the `metadata` table exists but contains no `embedding_model` key
- **AND** the configured embedding model is `openai:text-embedding-3-small` with dimension 1536
- **THEN** the system SHALL store the current model and dimension in the metadata table without prompting
- **AND** startup SHALL proceed normally

#### Scenario: Upgrade from pre-metadata database
- **WHEN** the `metadata` table is created by a new migration on an existing database
- **AND** no `embedding_model` key exists yet
- **THEN** the system SHALL treat this as a first-run scenario and silently initialize the metadata

### Requirement: Model Change Detection
The system SHALL compare the stored embedding model metadata against the current configured model specification and any explicit vector dimension override during startup. The comparison SHALL happen after database migrations but before vector table creation, vector table mutation, prepared statement initialization, provider startup probing, or vector search use.

If the stored model specification differs from the current configured model, or if an explicitly configured vector dimension differs from the stored dimension, the system SHALL throw `EmbeddingModelChangedError`. The error SHALL include the stored model, current model, stored dimension, and current resolved dimension. If the stored model specification matches and no explicit dimension override changed, the system SHALL use the stored dimension as the current resolved dimension and SHALL NOT probe the provider during startup.

#### Scenario: Model name change is detected
- **WHEN** stored metadata contains `embedding_model = "openai:text-embedding-3-small"`
- **AND** current configuration uses `gemini:embedding-001`
- **THEN** the system SHALL throw `EmbeddingModelChangedError`
- **AND** the error SHALL include both model names

#### Scenario: Resolved dimension change is detected
- **WHEN** stored metadata contains `embedding_model = "openai:custom-embedding-model"`
- **AND** stored metadata contains `embedding_dimension = "1024"`
- **AND** current configuration uses `openai:custom-embedding-model`
- **AND** `embeddings.vectorDimension` is explicitly configured as 768
- **THEN** the system SHALL throw `EmbeddingModelChangedError`
- **AND** the error SHALL include stored dimension 1024 and current dimension 768

#### Scenario: Same resolved model and dimension proceeds
- **WHEN** stored metadata contains `embedding_model = "openai:NovaSearch/stella_en_400M_v5"`
- **AND** stored metadata contains `embedding_dimension = "6144"`
- **AND** current configuration uses `openai:NovaSearch/stella_en_400M_v5`
- **THEN** startup SHALL proceed without model-change confirmation
- **AND** the system SHALL NOT probe the provider during startup

#### Scenario: Model changed, same dimension
- **WHEN** the stored `embedding_model` is `openai:text-embedding-3-small`
- **AND** the configured model is `openai:text-embedding-ada-002`
- **AND** both models use dimension 1536
- **THEN** the system SHALL detect a model change and throw `EmbeddingModelChangedError`

#### Scenario: Dimension changed, same model
- **WHEN** the stored `embedding_dimension` is `"1536"`
- **AND** the configured dimension is `768`
- **AND** the model has not changed
- **THEN** the system SHALL detect a dimension change and throw `EmbeddingModelChangedError`

#### Scenario: Both model and dimension changed
- **WHEN** the stored model is `openai:text-embedding-3-small` with dimension `"1536"`
- **AND** the configured model is `gemini:embedding-001` with dimension `768`
- **THEN** the system SHALL detect the change and throw `EmbeddingModelChangedError`

#### Scenario: No change detected
- **WHEN** the stored `embedding_model` matches the configured model
- **AND** the stored `embedding_dimension` matches the configured dimension
- **THEN** startup SHALL proceed normally without any prompt or error

#### Scenario: No stored metadata (first run)
- **WHEN** no `embedding_model` key exists in the `metadata` table
- **THEN** the system SHALL NOT treat this as a change
- **AND** startup SHALL proceed normally (silent initialization applies)

### Requirement: Non-Interactive Startup Failure
When an `EmbeddingModelChangedError` is thrown and `process.stdout.isTTY` is falsy (non-interactive mode, e.g., MCP/stdio), the system SHALL fail startup entirely with a descriptive error message. The error message SHALL include:

- The previous model and dimension
- The current model and dimension
- Instructions to start the server interactively (with a TTY) to confirm the change

The system SHALL NOT fall back to FTS-only mode, SHALL NOT silently proceed, and SHALL NOT invalidate vectors without explicit confirmation.

#### Scenario: Model change in MCP/stdio mode
- **WHEN** a model change is detected
- **AND** `process.stdout.isTTY` is falsy
- **THEN** the system SHALL terminate startup with an error
- **AND** the error message SHALL include the previous and current model/dimension values
- **AND** the error message SHALL instruct the user to start interactively

#### Scenario: Model change in piped output
- **WHEN** a model change is detected
- **AND** stdout is redirected to a pipe or file
- **THEN** the system SHALL treat this as non-interactive and fail startup

### Requirement: Interactive Confirmation Flow
When an `EmbeddingModelChangedError` is thrown and `process.stdout.isTTY` is truthy (interactive mode), the CLI layer SHALL display a warning and prompt for explicit user confirmation before proceeding.

The prompt flow SHALL be:
1. Display the previous and current model/dimension values
2. Explain the consequences: all existing embedding vectors will be invalidated and libraries must be re-scraped to restore vector search
3. Prompt with `Proceed with model change? (y/N)` where the default is `N` (abort)
4. Only `y` or `Y` SHALL be accepted as confirmation

On confirmation, the system SHALL invoke vector invalidation and update the metadata, then retry initialization. On abort, the system SHALL exit with an error.

#### Scenario: User confirms model change interactively
- **WHEN** a model change is detected in interactive mode
- **AND** the user responds `y` to the confirmation prompt
- **THEN** the system SHALL invalidate all existing vectors
- **AND** the system SHALL update the metadata with the new model and dimension
- **AND** startup SHALL proceed

#### Scenario: User aborts model change interactively
- **WHEN** a model change is detected in interactive mode
- **AND** the user responds `N` (or presses Enter for default)
- **THEN** the system SHALL exit with an error
- **AND** no vectors SHALL be invalidated
- **AND** the metadata SHALL remain unchanged

#### Scenario: User enters invalid input
- **WHEN** a model change is detected in interactive mode
- **AND** the user responds with anything other than `y`, `Y`, `n`, `N`, or Enter
- **THEN** the system SHALL treat the response as a rejection (same as `N`)

### Requirement: Vector Invalidation on Confirmed Change
When a model or dimension change is confirmed (either via interactive prompt or future escape mechanisms), the system SHALL invalidate all existing embedding vectors:

1. Execute `UPDATE documents SET embedding = NULL` to clear all stored embedding blobs
2. Drop and recreate the `documents_vec` virtual table as empty (no backfill)
3. Update the `metadata` table with the new `embedding_model` and `embedding_dimension` values
4. Log a message indicating vectors have been invalidated and re-scraping is required

These operations SHALL be performed atomically in a transaction (except for the virtual table DDL, which SQLite does not support in transactions; the table drop/create SHALL happen immediately after the UPDATE).

After invalidation, the system SHALL continue startup. Documents remain fully searchable via full-text search. Vector search results will be empty until libraries are re-scraped.

#### Scenario: Full vector invalidation
- **WHEN** a model change is confirmed
- **AND** 10,000 documents have existing embeddings
- **THEN** all 10,000 `documents.embedding` values SHALL be set to NULL
- **AND** `documents_vec` SHALL be recreated as empty
- **AND** the metadata SHALL be updated to the new model and dimension
- **AND** FTS search SHALL continue working for all documents

#### Scenario: Post-invalidation search behavior
- **WHEN** vectors have been invalidated
- **AND** the user performs a search
- **THEN** the system SHALL fall back to FTS-only search
- **AND** vector similarity search SHALL return no results (empty vec table)

### Requirement: Runtime-Configurable Vector Table
The system SHALL create the SQLite vector table with the current resolved effective vector dimension. The table DDL SHALL use `float[N]` where `N` is the resolved effective dimension. The system SHALL create the table only after the effective dimension has been resolved and model-change safety checks have passed.

If the resolved effective dimension changes relative to stored embedding metadata, the system SHALL refuse to reuse the existing vector table until the user confirms reindexing or reset behavior through the existing model-change flow.

#### Scenario: Create vector table with known fixed dimension
- **WHEN** the configured model is `openai:text-embedding-3-small`
- **AND** no explicit dimension override is configured
- **THEN** the system SHALL create `documents_vec` with `embedding float[1536]`

#### Scenario: Create vector table with runtime-detected dimension
- **WHEN** the configured model is `openai:custom-embedding-model`
- **AND** the provider returns a 1024-dimensional startup probe
- **THEN** the system SHALL create `documents_vec` with `embedding float[1024]`

#### Scenario: Create vector table with locked stored dimension
- **WHEN** the configured model is `openai:custom-embedding-model`
- **AND** stored metadata contains `embedding_model = "openai:custom-embedding-model"`
- **AND** stored metadata contains `embedding_dimension = "1024"`
- **THEN** the system SHALL create `documents_vec` with `embedding float[1024]`
- **AND** the system SHALL NOT make a provider probe request during startup

#### Scenario: Create vector table with explicit override dimension
- **WHEN** `embeddings.vectorDimension` is explicitly configured as 768
- **THEN** the system SHALL create `documents_vec` with `embedding float[768]`

#### Scenario: First startup creates vector table
- **WHEN** `documents_vec` does not exist
- **AND** `vectorDimension` is configured as 1536
- **THEN** the system SHALL create `documents_vec` with `embedding FLOAT[1536]`
- **AND** the table SHALL be empty

#### Scenario: Matching dimension is a no-op
- **WHEN** `documents_vec` exists with dimension 1536
- **AND** `vectorDimension` is configured as 1536
- **THEN** `ensureVectorTable()` SHALL make no changes

#### Scenario: Invalid dimension rejected
- **WHEN** `vectorDimension` is 0 or negative
- **THEN** the system SHALL throw a `StoreError`
