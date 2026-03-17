# embedding-resolution Specification

## Purpose
Defines how the embedding model is resolved from configuration sources, how provider credentials are validated, and how vector dimensions are determined.

## Requirements

### Requirement: Model Specification Parsing
The system SHALL parse an embedding model specification string in the format `provider:model`, splitting on the first colon only. When no colon is present, the system SHALL default to the `openai` provider and treat the entire string as the model name. This ensures model identifiers containing colons (e.g., `aws:amazon.titan-embed-text-v2:0`) are handled correctly, with only the first colon separating provider from model.

**Supported providers:** `openai`, `vertex`, `gemini`, `aws`, `microsoft`, `sagemaker` (parse-only; model creation not yet implemented).

**Code reference:** `src/store/embeddings/EmbeddingConfig.ts:290-317`

#### Scenario: Model string without provider prefix
- **WHEN** the model specification is `text-embedding-3-small` (no colon)
- **THEN** the system SHALL use `openai` as the provider and `text-embedding-3-small` as the model name

#### Scenario: Model string with provider prefix
- **WHEN** the model specification is `gemini:embedding-001`
- **THEN** the system SHALL use `gemini` as the provider and `embedding-001` as the model name

#### Scenario: Model string with multiple colons
- **WHEN** the model specification is `aws:amazon.titan-embed-text-v2:0`
- **THEN** the system SHALL split on the first colon only, using `aws` as the provider and `amazon.titan-embed-text-v2:0` as the model name

### Requirement: Configuration Precedence
The system SHALL resolve the embedding model from multiple configuration sources, merged in the following priority order (later sources override earlier ones):

1. Built-in defaults (lowest priority)
2. Configuration file (`config.yaml`, key `app.embeddingModel`)
3. Environment variable (`DOCS_MCP_EMBEDDING_MODEL`)
4. CLI flag (`--embedding-model`) (highest priority)

**Code reference:** `src/utils/config.ts:396-410`

#### Scenario: CLI flag overrides environment variable
- **WHEN** `DOCS_MCP_EMBEDDING_MODEL` is set to `text-embedding-3-small`
- **AND** the CLI flag `--embedding-model gemini:embedding-001` is provided
- **THEN** the system SHALL use `gemini:embedding-001` as the embedding model

#### Scenario: Environment variable overrides config file
- **WHEN** `config.yaml` sets `app.embeddingModel` to `text-embedding-3-small`
- **AND** `DOCS_MCP_EMBEDDING_MODEL` is set to `vertex:text-embedding-004`
- **THEN** the system SHALL use `vertex:text-embedding-004` as the embedding model

#### Scenario: Config file overrides defaults
- **WHEN** no environment variable or CLI flag is set
- **AND** `config.yaml` sets `app.embeddingModel` to `gemini:embedding-001`
- **THEN** the system SHALL use `gemini:embedding-001` as the embedding model

### Requirement: Default Model Fallback
The system SHALL default to `text-embedding-3-small` via the built-in default configuration (`DEFAULT_CONFIG.app.embeddingModel`). This default applies unconditionally unless overridden by a higher-precedence source.

When the embedding model has been explicitly cleared to a falsy value (e.g., set to an empty string in config or env) AND `OPENAI_API_KEY` is present in the environment, the system SHALL restore `text-embedding-3-small` as the model.

When the resolved model's credentials are missing (e.g., the default `text-embedding-3-small` is set but no `OPENAI_API_KEY` exists), the system SHALL fall back to FTS-only mode via credential validation, not by clearing the model.

**Code reference:** `src/utils/config.ts:36, 405-408`

#### Scenario: Default model with OpenAI API key present
- **WHEN** no embedding model override is specified in any configuration source
- **AND** `OPENAI_API_KEY` is set
- **THEN** the system SHALL use the built-in default `text-embedding-3-small` with the `openai` provider

#### Scenario: Default model without API key
- **WHEN** no embedding model override is specified in any configuration source
- **AND** `OPENAI_API_KEY` is not set
- **THEN** the system SHALL resolve the model to `text-embedding-3-small` (built-in default)
- **AND** credential validation SHALL fail for the `openai` provider
- **AND** the system SHALL fall back to FTS-only mode

#### Scenario: Model explicitly cleared with API key present
- **WHEN** the embedding model is explicitly set to an empty string (e.g., via env var or config)
- **AND** `OPENAI_API_KEY` is set
- **THEN** the system SHALL restore `text-embedding-3-small` as the model

### Requirement: Credential Validation
The system SHALL validate that the required provider-specific credentials are available before attempting to create the embedding model. Each provider has specific required environment variables:

| Provider | Required Variables |
|----------|-------------------|
| `openai` | `OPENAI_API_KEY` |
| `vertex` | `GOOGLE_APPLICATION_CREDENTIALS` |
| `gemini` | `GOOGLE_API_KEY` |
| `aws` | (`BEDROCK_AWS_REGION` or `AWS_REGION`) and (`AWS_PROFILE` or `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`) |
| `microsoft` | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_INSTANCE_NAME`, `AZURE_OPENAI_API_DEPLOYMENT_NAME`, `AZURE_OPENAI_API_VERSION` |
| `sagemaker` | `AWS_REGION` and (`AWS_PROFILE` or `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`). Note: credential check is implemented but model creation is not; using this provider will result in an `UnsupportedProviderError`. |

When credentials are missing, the system SHALL log a warning and fall back to FTS-only mode rather than raising a hard error.

**Code reference:** `src/store/embeddings/EmbeddingFactory.ts:59-99`

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

### Requirement: Environment Value Normalization
The system SHALL normalize environment variable values by stripping surrounding quotes (both single and double) and trimming leading/trailing whitespace. This prevents common configuration errors where shell quoting artifacts leak into the value.

**Code reference:** `src/utils/env.ts:5-14`

#### Scenario: Double-quoted environment value
- **WHEN** `DOCS_MCP_EMBEDDING_MODEL` is set to `"text-embedding-3-small"` (with literal quotes)
- **THEN** the system SHALL normalize the value to `text-embedding-3-small`

#### Scenario: Single-quoted environment value
- **WHEN** `DOCS_MCP_EMBEDDING_MODEL` is set to `'gemini:embedding-001'` (with literal single quotes)
- **THEN** the system SHALL normalize the value to `gemini:embedding-001`

#### Scenario: Value with surrounding whitespace
- **WHEN** `DOCS_MCP_EMBEDDING_MODEL` is set to `  text-embedding-3-small  ` (with spaces)
- **THEN** the system SHALL trim the value to `text-embedding-3-small`

### Requirement: Known Dimensions Lookup
The system SHALL maintain a lookup table mapping well-known embedding model names to their vector dimensions. The lookup SHALL be case-insensitive. When a model is found in the lookup table, the system SHALL use the known dimensions directly without making an API call.

When a model is not found in the lookup table, the system SHALL generate a test embedding using the string `"test"` to detect the model's output dimensions. This detection SHALL have a configurable timeout (default 30 seconds, `embeddings.initTimeoutMs`). The detected dimensions SHALL be cached for the duration of the session.

**Code reference:** `src/store/embeddings/EmbeddingConfig.ts:70-260`, `src/store/DocumentStore.ts:508-537`

#### Scenario: Well-known model dimensions
- **WHEN** the embedding model is `text-embedding-3-small`
- **THEN** the system SHALL resolve the dimensions to 1536 without making any API call

#### Scenario: Unknown model dimension detection
- **WHEN** the embedding model is not in the known dimensions lookup table
- **THEN** the system SHALL generate a test embedding of `"test"` to detect the output dimensions
- **AND** the system SHALL cache the detected dimensions for the session

#### Scenario: Dimension detection timeout
- **WHEN** the embedding model is not in the known dimensions lookup table
- **AND** the test embedding request exceeds the initialization timeout
- **THEN** the system SHALL fail embedding initialization
- **AND** the system SHALL fall back to FTS-only mode
