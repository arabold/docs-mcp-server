## ADDED Requirements

### Requirement: Vector Dimension Configuration
The system SHALL support a configurable vector dimension via the `embeddings.vectorDimension` configuration key. This value determines the size of the `documents_vec` virtual table column and the target dimension for vector padding/truncation.

The configuration key SHALL follow the standard configuration precedence:
1. Built-in default: `1536` (lowest priority)
2. Configuration file (`config.yaml`, key `embeddings.vectorDimension`)
3. Environment variable (`DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION`)
4. CLI arguments (highest priority)

The Zod schema SHALL validate that `vectorDimension` is a positive integer (`>= 1`). Values of 0, negative numbers, or non-integers SHALL be rejected at configuration load time.

#### Scenario: Default vector dimension
- **WHEN** no `vectorDimension` override is specified
- **THEN** the system SHALL use 1536 as the vector dimension

#### Scenario: Custom vector dimension via environment variable
- **WHEN** `DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION` is set to `768`
- **THEN** the system SHALL use 768 as the vector dimension
- **AND** the `documents_vec` table SHALL use `embedding FLOAT[768]`

#### Scenario: Invalid vector dimension rejected
- **WHEN** `DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION` is set to `0`
- **THEN** the system SHALL reject the configuration with an error message
- **AND** startup SHALL fail

#### Scenario: Non-integer vector dimension rejected
- **WHEN** `DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION` is set to `768.5`
- **THEN** the system SHALL reject the configuration with an error message
