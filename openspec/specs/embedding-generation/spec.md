# embedding-generation Specification

## Purpose
Defines how embeddings are produced for document chunks, including metadata enrichment, batch processing, error recovery, dimension normalization, and fallback behavior when embeddings are disabled.

## Requirements

### Requirement: Chunk Metadata Header
The system SHALL prepend a metadata header to each chunk's content before generating its embedding. The header SHALL include the page title, URL, and hierarchical section path in the following format:

```
<title>{title}</title>
<url>{url}</url>
<path>{section path joined by " / "}</path>
```

This enriches the embedding vector with document context to improve semantic search relevance. The header is prepended only for the embedding input; it is not stored as part of the chunk content in the database.

**Code reference:** `src/store/DocumentStore.ts:1170-1173`

#### Scenario: Chunk with section path
- **WHEN** a chunk has title `React Docs`, URL `https://react.dev/learn`, and section path `["Learn", "Installation", "Setup"]`
- **THEN** the embedding input SHALL be prefixed with `<title>React Docs</title>\n<url>https://react.dev/learn</url>\n<path>Learn / Installation / Setup</path>\n`
- **AND** the chunk content in the database SHALL remain unchanged (without the header)

#### Scenario: Chunk with empty section path
- **WHEN** a chunk has an empty section path `[]`
- **THEN** the embedding input SHALL still include the metadata header with an empty path element

### Requirement: Batch Processing
The system SHALL batch chunks for embedding generation using two concurrent limits:

- **Character limit** (`embeddings.batchChars`, default 50,000): total characters of all texts in the batch
- **Count limit** (`embeddings.batchSize`, default 100): maximum number of items in a single batch

When adding a chunk to the current batch would exceed either limit, the system SHALL send the current batch for embedding and start a new one.

**Code reference:** `src/store/DocumentStore.ts:1188-1236`

#### Scenario: Batch splits on item count
- **WHEN** 120 chunks are queued for embedding
- **AND** `batchSize` is 100
- **THEN** the system SHALL process the chunks in at least 2 batches

#### Scenario: Batch splits on character count
- **WHEN** chunks totaling 60,000 characters are queued for embedding
- **AND** `batchChars` is 50,000
- **THEN** the system SHALL split into multiple batches so no batch exceeds 50,000 total characters

#### Scenario: Both limits respected simultaneously
- **WHEN** a batch has 50 items totaling 49,000 characters
- **AND** the next chunk would push the total to 51,000 characters
- **THEN** the system SHALL send the current batch and start a new one with the remaining chunk

### Requirement: Input Size Error Recovery
The system SHALL detect embedding API errors caused by input exceeding the model's context window and apply automatic recovery:

1. **Multi-text batch too large**: The system SHALL split the batch at the midpoint and retry each half recursively in parallel.
2. **Single text too large**: The system SHALL truncate the text to its first half (`text.substring(0, midpoint)`) and retry recursively. If the truncated half still exceeds the limit, it will be truncated again (to a quarter, eighth, etc.) until the embedding succeeds or the operation fails entirely. This preserves the beginning of the content, which typically contains the most important context (metadata header, title, introductory text).

Size errors SHALL be detected by matching error messages against keywords including `"maximum context length"`, `"too long"`, `"token limit"`, `"input is too large"`, `"exceeds"`, and combined `"max"` + `"token"` patterns.

**Code reference:** `src/store/DocumentStore.ts:1059-1147`

#### Scenario: Batch exceeds model context window
- **WHEN** a batch of 10 texts causes an input size error from the embedding API
- **THEN** the system SHALL split the batch into two halves of 5 texts each
- **AND** retry each half independently in parallel

#### Scenario: Single text exceeds model context window
- **WHEN** a single text of 20,000 characters causes an input size error
- **THEN** the system SHALL truncate the text to 10,000 characters (first half)
- **AND** retry the embedding with the truncated text

#### Scenario: Recursive single-text truncation
- **WHEN** the truncated first half of a single text still exceeds the model context window
- **THEN** the system SHALL recursively truncate again to a quarter of the original length
- **AND** continue until the embedding succeeds or the operation fails entirely

#### Scenario: Recursive batch splitting
- **WHEN** a half-batch still exceeds the model context window after splitting
- **THEN** the system SHALL continue splitting recursively until the batch succeeds or contains a single text

### Requirement: Vector Dimension Normalization
The system SHALL normalize every embedding vector to the resolved effective database dimension before insertion into the vector table. The resolved effective dimension SHALL be determined before vector table creation from, in priority order:
1. An explicit `embeddings.vectorDimension` value supplied by user configuration, environment variables, or CLI arguments.
2. A stored `embedding_dimension` when stored `embedding_model` matches the current configured model.
3. A known fixed-output model dimension.
4. Runtime detection from a test embedding for unknown or variable-dimension models that do not have matching stored metadata.

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

#### Scenario: Gemini model with MRL truncation
- **WHEN** a Gemini embedding model returns 768-dimensional vectors
- **AND** the resolved effective dimension is 1536
- **THEN** the system SHALL zero-pad the vector to 1536 dimensions

#### Scenario: Model returns oversized vector without MRL support
- **WHEN** an embedding model returns 2048-dimensional vectors
- **AND** MRL truncation is not enabled for the model
- **AND** the resolved effective dimension is 1536
- **THEN** the system SHALL raise a `DimensionError`

#### Scenario: Model returns exact target dimensions
- **WHEN** an embedding model returns 1536-dimensional vectors
- **AND** the resolved effective dimension is 1536
- **THEN** the system SHALL store the vector as-is without modification

#### Scenario: Custom vector dimension configuration
- **WHEN** `embeddings.vectorDimension` is set to 768
- **AND** the embedding model returns 768-dimensional vectors
- **THEN** the system SHALL store the vector as-is without modification
- **AND** the `documents_vec` table SHALL use `embedding FLOAT[768]`

### Requirement: Dimension Detection
The system SHALL determine the effective embedding dimension during initialization when embeddings are enabled. The system SHALL skip runtime probing for known fixed-output models unless an explicit dimension override is configured. The system SHALL also skip runtime probing for unknown and variable-dimension models when stored metadata contains the same `embedding_model` as the current configuration and a stored `embedding_dimension`.

Runtime probing SHALL use the configured embedding provider to generate an embedding for the string `"test"` and measure the returned vector length only when no matching stored dimension exists and no explicit dimension override is configured. The system SHALL use the detected or stored length consistently for vector table sizing, normalization, metadata persistence, and model-change checks during that session.

#### Scenario: Known fixed-output model avoids probing
- **WHEN** the configured model is `openai:text-embedding-3-small`
- **AND** `embeddings.vectorDimension` is not explicitly configured
- **THEN** the effective dimension SHALL be 1536
- **AND** the system SHALL NOT make a startup probe request

#### Scenario: Variable-dimension model is probed
- **WHEN** the configured model is `openai:NovaSearch/stella_en_400M_v5`
- **AND** `embeddings.vectorDimension` is not explicitly configured
- **AND** no stored metadata exists for that model
- **AND** the provider returns a 4096-dimensional vector for `"test"`
- **THEN** the effective dimension SHALL be 4096
- **AND** the vector table SHALL be created for 4096-dimensional vectors

#### Scenario: Variable-dimension model reuses locked dimension
- **WHEN** the configured model is `openai:NovaSearch/stella_en_400M_v5`
- **AND** `embeddings.vectorDimension` is not explicitly configured
- **AND** stored metadata contains `embedding_model = "openai:NovaSearch/stella_en_400M_v5"`
- **AND** stored metadata contains `embedding_dimension = "4096"`
- **THEN** the effective dimension SHALL be 4096
- **AND** the system SHALL NOT make a startup probe request

#### Scenario: Unknown model reuses locked dimension
- **WHEN** the configured model is `openai:custom-embedding-v1`
- **AND** `embeddings.vectorDimension` is not explicitly configured
- **AND** stored metadata contains `embedding_model = "openai:custom-embedding-v1"`
- **AND** stored metadata contains `embedding_dimension = "1024"`
- **THEN** the effective dimension SHALL be 1024
- **AND** the system SHALL NOT make a startup probe request

#### Scenario: Explicit override skips auto dimension selection
- **WHEN** the configured model is `openai:NovaSearch/stella_en_400M_v5`
- **AND** `embeddings.vectorDimension` is explicitly configured as 1024
- **THEN** the effective dimension SHALL be 1024
- **AND** generated embeddings SHALL be validated against 1024 dimensions

#### Scenario: Known model skips test embedding
- **WHEN** the model is `text-embedding-3-small` (in the known dimensions table)
- **THEN** the system SHALL resolve dimensions to 1536 without making an API call

#### Scenario: Unknown model triggers test embedding
- **WHEN** the model is `openai:custom-embedding-v1` (not in the known dimensions table)
- **AND** the model returns a 384-dimensional vector for the test input
- **THEN** the system SHALL detect 384 as the model's dimension and cache it

#### Scenario: Test embedding timeout
- **WHEN** the test embedding request does not complete within `initTimeoutMs`
- **THEN** the system SHALL fail embedding initialization and fall back to FTS-only mode

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
