## MODIFIED Requirements

### Requirement: Known Dimensions Lookup
The system SHALL maintain a lookup table mapping well-known fixed-output embedding model names to their vector dimensions. The lookup SHALL be case-insensitive and SHALL support common provider aliases when they unambiguously identify the same fixed-output model. When a model is found in the lookup table and is not marked as runtime-detected, the system SHALL use the known dimensions directly without making an API call.

The system SHALL treat known variable-dimension models as runtime-detected models rather than forcing a single table value. Variable-dimension models include models that advertise multiple valid output dimensions, such as Matryoshka/resizable models with selectable projection heads. For these models, the system SHALL generate a test embedding using the string `"test"` to detect the model's actual provider output dimensions.

When a model is not found in the lookup table, the system SHALL generate a test embedding using the string `"test"` to detect the model's output dimensions. This detection SHALL have a configurable timeout (default 30 seconds, `embeddings.initTimeoutMs`). The detected dimensions SHALL be cached for the duration of the session.

**Code reference:** `src/store/embeddings/EmbeddingConfig.ts:70-260`, `src/store/DocumentStore.ts:508-537`

#### Scenario: Well-known fixed-output model dimensions
- **WHEN** the embedding model is `text-embedding-3-small`
- **THEN** the system SHALL resolve the dimensions to 1536 without making any API call

#### Scenario: Known variable-dimension model triggers runtime detection
- **WHEN** the embedding model is `openai:NovaSearch/stella_en_400M_v5`
- **AND** the provider returns a 6144-dimensional vector for the test input
- **THEN** the system SHALL detect 6144 as the model's effective dimension
- **AND** the system SHALL NOT use a hardcoded known-dimension table value for that model

#### Scenario: Unknown model dimension detection
- **WHEN** the embedding model is not in the known dimensions lookup table
- **THEN** the system SHALL generate a test embedding of `"test"` to detect the output dimensions
- **AND** the system SHALL cache the detected dimensions for the session

#### Scenario: Dimension detection timeout
- **WHEN** the embedding model is not in the known dimensions lookup table
- **AND** the test embedding request exceeds the initialization timeout
- **THEN** the system SHALL fail embedding initialization
- **AND** the system SHALL fall back to FTS-only mode

### Requirement: Embedding Identity Persistence
After successful embedding initialization, the system SHALL persist the resolved embedding model identity to the database `metadata` table. This enables detection of model changes on subsequent startups. The persisted values SHALL be the model specification string as provided in configuration (e.g., `openai:text-embedding-3-small` or `gemini:embedding-001`) and the resolved effective vector dimension.

The persistence SHALL occur as the final step of `initializeEmbeddings()`, after dimension detection and validation have succeeded. If embedding initialization fails or is skipped (FTS-only mode), no metadata SHALL be written.

#### Scenario: Model identity persisted after successful init
- **WHEN** the embedding model `gemini:embedding-001` initializes successfully with resolved dimension 768
- **THEN** the system SHALL store `embedding_model = "gemini:embedding-001"` in the `metadata` table
- **AND** the system SHALL store `embedding_dimension = "768"` in the `metadata` table

#### Scenario: Auto-detected dimension persisted after successful init
- **WHEN** the embedding model `openai:custom-embedding-v1` returns a 1024-dimensional test embedding
- **THEN** the system SHALL store `embedding_model = "openai:custom-embedding-v1"` in the `metadata` table
- **AND** the system SHALL store `embedding_dimension = "1024"` in the `metadata` table

#### Scenario: Model identity not persisted on init failure
- **WHEN** the embedding model fails to initialize (e.g., network timeout)
- **THEN** no embedding metadata SHALL be written to the `metadata` table
- **AND** any previously stored metadata SHALL remain unchanged

### Requirement: Startup Model Mismatch Detection
During initialization, after migrations are applied and after resolving the current effective vector dimension, the system SHALL read the stored `embedding_model` and `embedding_dimension` from the `metadata` table and compare them against the current model specification and resolved effective dimension. If either value differs, the system SHALL throw a structured `EmbeddingModelChangedError` before proceeding with vector table creation or prepared statement initialization.

This check SHALL occur only when both conditions are true:
1. The `metadata` table contains an `embedding_model` key (not a first-run scenario)
2. The current configuration specifies an embedding model (not FTS-only mode)

#### Scenario: Mismatch detected before vec table creation
- **WHEN** the stored model is `openai:text-embedding-3-small` (1536d)
- **AND** the configured model is `gemini:embedding-001` (resolved 768d)
- **THEN** the system SHALL throw `EmbeddingModelChangedError` before creating/modifying the `documents_vec` table
- **AND** the vector table SHALL remain in its previous state until the change is confirmed or rejected

#### Scenario: Auto-detected dimension matches metadata
- **WHEN** the stored model is `openai:custom-embedding-v1`
- **AND** the stored dimension is `"1024"`
- **AND** the current provider test embedding resolves to 1024 dimensions
- **THEN** startup SHALL proceed normally without any prompt or error

#### Scenario: FTS-only mode skips mismatch check
- **WHEN** the configured embedding model is empty or credentials are missing
- **AND** the stored model is `openai:text-embedding-3-small`
- **THEN** the system SHALL NOT throw an error
- **AND** the system SHALL proceed in FTS-only mode
- **AND** the stored metadata SHALL remain unchanged
