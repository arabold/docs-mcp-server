## MODIFIED Requirements

### Requirement: Model Specification Parsing
The system SHALL parse an embedding model specification string in the format `provider:model`, splitting on the first colon only. When no colon is present, the system SHALL default to the `openai` provider and treat the entire string as the model name. This ensures model identifiers containing colons (e.g., `aws:amazon.titan-embed-text-v2:0`) are handled correctly, with only the first colon separating provider from model.

**Supported providers:** `openai`, `vertex`, `gemini`, `aws`, `microsoft`, `transformers`, and `sagemaker` (`sagemaker` is parse-only; model creation not yet implemented). The `transformers` provider is fully supported (parsing and model creation) and produces embeddings locally via the optional companion package (see the `local-embeddings` capability).

**Code reference:** `src/store/embeddings/EmbeddingConfig.ts:342-369`

#### Scenario: Model string without provider prefix
- **WHEN** the model specification is `text-embedding-3-small` (no colon)
- **THEN** the system SHALL use `openai` as the provider and `text-embedding-3-small` as the model name

#### Scenario: Model string with provider prefix
- **WHEN** the model specification is `gemini:embedding-001`
- **THEN** the system SHALL use `gemini` as the provider and `embedding-001` as the model name

#### Scenario: Model string with multiple colons
- **WHEN** the model specification is `aws:amazon.titan-embed-text-v2:0`
- **THEN** the system SHALL split on the first colon only, using `aws` as the provider and `amazon.titan-embed-text-v2:0` as the model name

#### Scenario: Transformers provider with a Hugging Face model
- **WHEN** the model specification is `transformers:BAAI/bge-small-en-v1.5`
- **THEN** the system SHALL use `transformers` as the provider and `BAAI/bge-small-en-v1.5` as the model name

### Requirement: Credential Validation
The system SHALL validate that the required provider-specific credentials are available before attempting to create the embedding model. Each provider has specific required environment variables:

| Provider | Required Variables |
|----------|-------------------|
| `openai` | `OPENAI_API_KEY` |
| `vertex` | `GOOGLE_APPLICATION_CREDENTIALS` |
| `gemini` | `GOOGLE_API_KEY` |
| `aws` | (`BEDROCK_AWS_REGION` or `AWS_REGION`) and (`AWS_PROFILE` or `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`) |
| `microsoft` | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_INSTANCE_NAME`, `AZURE_OPENAI_API_DEPLOYMENT_NAME`, `AZURE_OPENAI_API_VERSION` |
| `transformers` | None. Local embeddings require no credentials; credential validation SHALL always succeed. Availability of the optional companion package is verified lazily when the model is first loaded, not during credential validation. |
| `sagemaker` | `AWS_REGION` and (`AWS_PROFILE` or `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`). Note: credential check is implemented but model creation is not; using this provider will result in an `UnsupportedProviderError`. |

When credentials are missing, the system SHALL log a warning and fall back to FTS-only mode rather than raising a hard error.

**Code reference:** `src/store/embeddings/EmbeddingFactory.ts:61-106`

#### Scenario: Valid credentials for selected provider
- **WHEN** the embedding model is `gemini:embedding-001`
- **AND** `GOOGLE_API_KEY` is set
- **THEN** the system SHALL proceed with embedding model initialization

#### Scenario: Missing credentials for selected provider
- **WHEN** the embedding model is `gemini:embedding-001`
- **AND** `GOOGLE_API_KEY` is not set
- **THEN** the system SHALL log a warning indicating missing credentials
- **AND** the system SHALL fall back to FTS-only mode

#### Scenario: OpenAI with custom endpoint
- **WHEN** the embedding model uses the `openai` provider
- **AND** `OPENAI_API_KEY` is set
- **AND** `OPENAI_API_BASE` is set to a custom URL (e.g., Ollama or LM Studio)
- **THEN** the system SHALL use the custom endpoint for embedding requests

#### Scenario: Transformers provider requires no credentials
- **WHEN** the embedding model is `transformers:BAAI/bge-small-en-v1.5`
- **AND** no provider credentials are present in the environment
- **THEN** credential validation SHALL succeed
- **AND** the system SHALL proceed with embedding model initialization

### Requirement: Known Dimensions Lookup
The system SHALL maintain a lookup table mapping well-known embedding model names to their vector dimensions. The lookup SHALL be case-insensitive. When a model is found in the lookup table, the system SHALL use the known dimensions directly without making an API call.

When a model is not found in the lookup table, the system SHALL generate a test embedding using the string `"test"` to detect the model's output dimensions. This detection SHALL have a configurable timeout (default 30 seconds, `embeddings.initTimeoutMs`). The detected dimensions SHALL be cached for the duration of the session.

The lookup table is provider-agnostic (keyed by model name), so `transformers` models that appear in it resolve without a probe. The known dimension for `BAAI/bge-small-en-v1.5` SHALL be 384 (its actual hidden size).

**Code reference:** `src/store/embeddings/EmbeddingConfig.ts:70-260`, `src/store/DocumentStore.ts:508-537`

#### Scenario: Well-known model dimensions
- **WHEN** the embedding model is `text-embedding-3-small`
- **THEN** the system SHALL resolve the dimensions to 1536 without making any API call

#### Scenario: Well-known transformers model dimensions
- **WHEN** the embedding model is `transformers:BAAI/bge-small-en-v1.5`
- **THEN** the system SHALL resolve the dimensions to 384 from the lookup table

#### Scenario: Unknown model dimension detection
- **WHEN** the embedding model is not in the known dimensions lookup table
- **THEN** the system SHALL generate a test embedding of `"test"` to detect the output dimensions
- **AND** the system SHALL cache the detected dimensions for the session

#### Scenario: Dimension detection timeout
- **WHEN** the embedding model is not in the known dimensions lookup table
- **AND** the test embedding request exceeds the initialization timeout
- **THEN** the system SHALL fail embedding initialization
- **AND** the system SHALL fall back to FTS-only mode
