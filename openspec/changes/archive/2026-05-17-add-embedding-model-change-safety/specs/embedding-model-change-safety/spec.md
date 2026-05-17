## ADDED Requirements

### Requirement: Embedding Metadata Persistence
The system SHALL persist the active embedding configuration in a `metadata` table in the SQLite database using two key-value pairs:

- `embedding_model`: The full model specification string (e.g., `openai:text-embedding-3-small`)
- `embedding_dimension`: The configured vector dimension as a string (e.g., `"1536"`)

The `metadata` table SHALL be created by a database migration with the schema `CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)`.

The metadata SHALL be written after successful embedding initialization during `DocumentStore.initialize()`. If embeddings are disabled (FTS-only mode), no embedding metadata SHALL be stored.

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
During `DocumentStore.initialize()`, after applying migrations but before creating the vector table, the system SHALL compare the configured embedding model and dimension against the values stored in the `metadata` table. A change is detected when either:

- The `embedding_model` value differs from `config.app.embeddingModel`, OR
- The `embedding_dimension` value differs from `config.embeddings.vectorDimension`

When a change is detected, the system SHALL throw an `EmbeddingModelChangedError` containing the previous and current model identifiers and dimensions. This error is structured to enable the CLI layer to decide how to handle it (prompt or fail).

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
The `documents_vec` virtual table SHALL be created at runtime by `DocumentStore.ensureVectorTable()` using the configured `embeddings.vectorDimension` rather than being defined in a SQL migration. A migration SHALL drop any existing hard-coded `documents_vec` table to allow runtime recreation.

The method SHALL:
- Validate that the dimension is a positive integer (throw `StoreError` otherwise)
- Check if `documents_vec` already exists with the correct dimension (no-op if matching)
- If the table does not exist, create it with the configured dimension
- NOT backfill vectors from the `documents` table (vectors are populated only during scraping)

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
