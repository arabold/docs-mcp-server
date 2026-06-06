## MODIFIED Requirements

### Requirement: Vector Dimension Normalization
The system SHALL normalize every embedding vector to the resolved effective database dimension before insertion into the vector table. The resolved effective dimension SHALL be determined before vector table creation from, in priority order:
1. An explicit `embeddings.vectorDimension` value supplied by user configuration, environment variables, or CLI arguments.
2. A known fixed-output model dimension.
3. Runtime detection from a test embedding for unknown or variable-dimension models.

If an embedding vector is shorter than the resolved effective dimension, the system SHALL pad it with zeros. If an embedding vector is longer than the resolved effective dimension, the system SHALL only truncate when the embedding provider explicitly allows Matryoshka/resizable truncation. Otherwise, the system SHALL reject the vector with a dimension error.

**Default dimension:** 1536 when no embedding model is configured or when an explicit default-only configuration is needed for FTS-only operation.

#### Scenario: Padding smaller vectors
- **WHEN** the resolved effective dimension is 1536
- **AND** an embedding API returns a 1024-dimensional vector
- **THEN** the system SHALL pad the vector with 512 zeros
- **AND** insert a 1536-dimensional vector into `documents_vec`

#### Scenario: Rejecting oversized non-MRL vectors
- **WHEN** the resolved effective dimension is 768
- **AND** an embedding API returns a 1536-dimensional vector
- **AND** the embedding wrapper does not allow Matryoshka/resizable truncation
- **THEN** the system SHALL reject the vector with `DimensionError`
- **AND** the system SHALL NOT silently truncate the vector

#### Scenario: Runtime-detected unknown model dimension
- **WHEN** the configured model is unknown
- **AND** no explicit `embeddings.vectorDimension` is configured
- **AND** the provider returns a 1024-dimensional vector for the startup probe
- **THEN** the system SHALL create `documents_vec` for 1024-dimensional vectors
- **AND** generated embeddings SHALL be normalized to 1024 dimensions

#### Scenario: Explicit override remains authoritative
- **WHEN** the configured model is unknown
- **AND** `embeddings.vectorDimension` is explicitly configured as 768
- **THEN** the system SHALL create `documents_vec` for 768-dimensional vectors
- **AND** generated embeddings SHALL be validated and normalized against 768 dimensions

### Requirement: Dimension Detection
The system SHALL determine the effective embedding dimension during initialization when embeddings are enabled. The system SHALL skip runtime probing for known fixed-output models unless an explicit dimension override is configured. The system SHALL perform runtime probing for unknown models and known variable-dimension models when no explicit dimension override is configured.

Runtime probing SHALL use the configured embedding provider to generate an embedding for the string `"test"` and measure the returned vector length. The system SHALL use the detected length consistently for vector table sizing, normalization, metadata persistence, and model-change checks during that session.

#### Scenario: Known fixed-output model avoids probing
- **WHEN** the configured model is `openai:text-embedding-3-small`
- **AND** `embeddings.vectorDimension` is not explicitly configured
- **THEN** the effective dimension SHALL be 1536
- **AND** the system SHALL NOT make a startup probe request

#### Scenario: Variable-dimension model is probed
- **WHEN** the configured model is `openai:NovaSearch/stella_en_400M_v5`
- **AND** `embeddings.vectorDimension` is not explicitly configured
- **AND** the provider returns a 4096-dimensional vector for `"test"`
- **THEN** the effective dimension SHALL be 4096
- **AND** the vector table SHALL be created for 4096-dimensional vectors

#### Scenario: Explicit override skips auto dimension selection
- **WHEN** the configured model is `openai:NovaSearch/stella_en_400M_v5`
- **AND** `embeddings.vectorDimension` is explicitly configured as 1024
- **THEN** the effective dimension SHALL be 1024
- **AND** generated embeddings SHALL be validated against 1024 dimensions
