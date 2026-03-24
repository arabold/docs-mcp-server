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
The system SHALL normalize all embedding vectors to a fixed database dimension (`embeddings.vectorDimension`, default 1536) before storage:

- **Oversized vector with MRL truncation enabled** (e.g., Gemini models via `FixedDimensionEmbeddings`): The system SHALL truncate the vector to the target dimension by keeping only the first N elements. This is valid for Matryoshka Representation Learning (MRL) models.
- **Oversized vector without truncation**: The system SHALL raise a `DimensionError`.
- **Undersized vector**: The system SHALL pad the vector with zeros to reach the target dimension.

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

### Requirement: Dimension Detection
The system SHALL determine the output dimensions of the configured embedding model using the following strategy:

1. **Known model lookup**: If the model name matches the known dimensions lookup table (case-insensitive), use the known dimensions directly.
2. **Test embedding**: If the model is not in the lookup table, generate a test embedding of the string `"test"` and measure the output vector length. This test has a configurable timeout (`embeddings.initTimeoutMs`, default 30 seconds).

The detected dimensions SHALL be cached for the duration of the session and used for all subsequent vector operations.

**Code reference:** `src/store/DocumentStore.ts:508-537`

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

**Known gap:** The system does not track which embedding model was used for existing vectors. If the user changes the embedding model, old vectors remain in the database but are semantically incompatible with new vectors. Vector similarity search will produce degraded results. The only remedy is to re-scrape all libraries. There is currently no automatic detection or migration for model changes.
