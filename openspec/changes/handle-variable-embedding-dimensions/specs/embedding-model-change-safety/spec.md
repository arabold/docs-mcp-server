## MODIFIED Requirements

### Requirement: Embedding Metadata Persistence
The system SHALL persist embedding model metadata to the SQLite `metadata` table after successful embedding initialization. The metadata SHALL include the configured model specification and the resolved effective vector dimension used by the database. The system SHALL update this metadata atomically with successful initialization, not during partial or failed initialization.

The persisted dimension SHALL be the same dimension used for `documents_vec` table creation and vector normalization. For known fixed-output models this is the known dimension unless explicitly overridden. For unknown or variable-dimension models this is the runtime-detected provider output dimension unless explicitly overridden.

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

### Requirement: Model Change Detection
The system SHALL compare the stored embedding model metadata against the current configured model specification and current resolved effective vector dimension during startup. The comparison SHALL happen after database migrations and after resolving the current effective dimension, but before vector table creation, vector table mutation, prepared statement initialization, or vector search use.

If the stored model specification or stored dimension differs from the current values, the system SHALL throw `EmbeddingModelChangedError`. The error SHALL include the stored model, current model, stored dimension, and current resolved dimension.

#### Scenario: Model name change is detected
- **WHEN** stored metadata contains `embedding_model = "openai:text-embedding-3-small"`
- **AND** current configuration uses `gemini:embedding-001`
- **THEN** the system SHALL throw `EmbeddingModelChangedError`
- **AND** the error SHALL include both model names

#### Scenario: Resolved dimension change is detected
- **WHEN** stored metadata contains `embedding_model = "openai:custom-embedding-model"`
- **AND** stored metadata contains `embedding_dimension = "1024"`
- **AND** current configuration uses `openai:custom-embedding-model`
- **AND** runtime detection resolves the current dimension to 768
- **THEN** the system SHALL throw `EmbeddingModelChangedError`
- **AND** the error SHALL include stored dimension 1024 and current dimension 768

#### Scenario: Same resolved model and dimension proceeds
- **WHEN** stored metadata contains `embedding_model = "openai:NovaSearch/stella_en_400M_v5"`
- **AND** stored metadata contains `embedding_dimension = "6144"`
- **AND** current configuration uses `openai:NovaSearch/stella_en_400M_v5`
- **AND** runtime detection resolves the current dimension to 6144
- **THEN** startup SHALL proceed without model-change confirmation

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

#### Scenario: Create vector table with explicit override dimension
- **WHEN** `embeddings.vectorDimension` is explicitly configured as 768
- **THEN** the system SHALL create `documents_vec` with `embedding float[768]`
