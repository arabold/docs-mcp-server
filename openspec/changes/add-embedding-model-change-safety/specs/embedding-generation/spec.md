## MODIFIED Requirements

### Requirement: Vector Dimension Normalization
The system SHALL normalize all embedding vectors to a fixed database dimension (`embeddings.vectorDimension`, default 1536) before storage:

- **Oversized vector with MRL truncation enabled** (e.g., Gemini models via `FixedDimensionEmbeddings`): The system SHALL truncate the vector to the target dimension by keeping only the first N elements. This is valid for Matryoshka Representation Learning (MRL) models.
- **Oversized vector without truncation**: The system SHALL raise a `DimensionError`.
- **Undersized vector**: The system SHALL pad the vector with zeros to reach the target dimension.

The target dimension (`embeddings.vectorDimension`) is configurable at runtime and determines the size of the `documents_vec` virtual table. When the dimension changes between startups, the model change detection system SHALL handle invalidation before any new vectors are stored.

**Code reference:** `src/store/embeddings/FixedDimensionEmbeddings.ts:13-67`, `src/store/DocumentStore.ts:455-465`

#### Scenario: Gemini model with MRL truncation
- **WHEN** a Gemini embedding model returns 768-dimensional vectors
- **AND** the database vector dimension is 1536
- **THEN** the system SHALL zero-pad the vector to 1536 dimensions

#### Scenario: Model returns oversized vector without MRL support
- **WHEN** an embedding model returns 2048-dimensional vectors
- **AND** MRL truncation is not enabled for the model
- **AND** the database vector dimension is 1536
- **THEN** the system SHALL raise a `DimensionError`

#### Scenario: Model returns exact target dimensions
- **WHEN** an embedding model returns 1536-dimensional vectors
- **AND** the database vector dimension is 1536
- **THEN** the system SHALL store the vector as-is without modification

#### Scenario: Custom vector dimension configuration
- **WHEN** `embeddings.vectorDimension` is set to 768
- **AND** the embedding model returns 768-dimensional vectors
- **THEN** the system SHALL store the vector as-is without modification
- **AND** the `documents_vec` table SHALL use `embedding FLOAT[768]`

### Requirement: Embedding Skip When Disabled
When embeddings are disabled (no model configured, missing credentials, or initialization failure), the system SHALL skip all embedding generation without raising errors:

- No embedding API calls SHALL be made
- Document chunks SHALL be stored with `NULL` embedding values
- The FTS5 full-text search index SHALL still be populated
- Documents SHALL remain fully searchable via full-text search

When the embedding model changes and vectors are invalidated, existing documents SHALL have their embeddings set to `NULL`. The system SHALL continue operating in FTS-only mode for those documents until they are re-scraped with the new model.

**Code reference:** `src/store/DocumentStore.ts:483-486, 1166-1169, 1308`

#### Scenario: No embedding model configured
- **WHEN** no embedding model is configured and no `OPENAI_API_KEY` is set
- **THEN** the system SHALL log that embedding initialization was skipped (FTS-only mode)
- **AND** documents SHALL be stored without embeddings
- **AND** documents SHALL be searchable via full-text search

#### Scenario: Embedding initialization failure
- **WHEN** the embedding model is configured but initialization fails (e.g., invalid API key, network error)
- **THEN** the system SHALL log the error
- **AND** the system SHALL continue operating in FTS-only mode
- **AND** documents SHALL be stored without embeddings

#### Scenario: Vectors invalidated after model change
- **WHEN** a model change has been confirmed and vectors have been invalidated
- **THEN** all existing documents SHALL have `NULL` embeddings
- **AND** FTS search SHALL continue working for all documents
- **AND** vector search SHALL return no results until libraries are re-scraped

## REMOVED Requirements

### Requirement: Known Gap Documentation
**Reason**: The "known gap" note previously documented at the end of this spec ("The system does not track which embedding model was used for existing vectors...") is now resolved by the `embedding-model-change-safety` capability, which implements model tracking via database metadata and vector invalidation on model change.
**Migration**: No code migration needed. The gap is closed by the new `embedding-model-change-safety` spec.
