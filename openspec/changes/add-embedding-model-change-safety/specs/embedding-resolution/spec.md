## ADDED Requirements

### Requirement: Embedding Identity Persistence
After successful embedding initialization, the system SHALL persist the resolved embedding model identity to the database `metadata` table. This enables detection of model changes on subsequent startups. The persisted values SHALL be the model specification string as provided in configuration (e.g., `openai:text-embedding-3-small` or `gemini:embedding-001`) and the configured vector dimension.

The persistence SHALL occur as the final step of `initializeEmbeddings()`, after dimension detection and validation have succeeded. If embedding initialization fails or is skipped (FTS-only mode), no metadata SHALL be written.

#### Scenario: Model identity persisted after successful init
- **WHEN** the embedding model `gemini:embedding-001` initializes successfully with dimension 768
- **THEN** the system SHALL store `embedding_model = "gemini:embedding-001"` in the `metadata` table
- **AND** the system SHALL store `embedding_dimension = "768"` in the `metadata` table

#### Scenario: Model identity not persisted on init failure
- **WHEN** the embedding model fails to initialize (e.g., network timeout)
- **THEN** no embedding metadata SHALL be written to the `metadata` table
- **AND** any previously stored metadata SHALL remain unchanged

### Requirement: Startup Model Mismatch Detection
During initialization, after migrations are applied, the system SHALL read the stored `embedding_model` and `embedding_dimension` from the `metadata` table and compare them against the current configuration. If either value differs, the system SHALL throw a structured `EmbeddingModelChangedError` before proceeding with vector table creation or embedding client initialization.

This check SHALL occur only when both conditions are true:
1. The `metadata` table contains an `embedding_model` key (not a first-run scenario)
2. The current configuration specifies an embedding model (not FTS-only mode)

#### Scenario: Mismatch detected before vec table creation
- **WHEN** the stored model is `openai:text-embedding-3-small` (1536d)
- **AND** the configured model is `gemini:embedding-001` (768d)
- **THEN** the system SHALL throw `EmbeddingModelChangedError` before creating/modifying the `documents_vec` table
- **AND** the vector table SHALL remain in its previous state until the change is confirmed or rejected

#### Scenario: FTS-only mode skips mismatch check
- **WHEN** the configured embedding model is empty or credentials are missing
- **AND** the stored model is `openai:text-embedding-3-small`
- **THEN** the system SHALL NOT throw an error
- **AND** the system SHALL proceed in FTS-only mode
- **AND** the stored metadata SHALL remain unchanged
