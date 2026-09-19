## MODIFIED Requirements

### Requirement: Model Specification Parsing
The system SHALL resolve the provider of an embedding model specification by matching the segment preceding the first colon against the set of supported providers. The match SHALL be case-insensitive, and the resolved provider SHALL be its canonical lowercase form.

When that segment names a supported provider, the system SHALL split on the first colon only, using the segment as the provider and the remainder as the model name. This ensures provider model identifiers containing colons (e.g. `aws:amazon.titan-embed-text-v2:0`) are handled correctly.

In every other case — no colon present, or a leading segment that does not name a supported provider — the system SHALL use the `openai` provider and treat the entire specification as the model name. This ensures model names carrying a tag or quantization suffix (e.g. `nomic-embed-text:latest`, `second-state/jina-embeddings-v3-GGUF:Q4_K_M`) reach OpenAI-compatible endpoints intact rather than being misread as an unsupported provider and silently degraded to FTS-only mode.

Every supported provider SHALL have a model-creation branch. The system SHALL NOT offer a provider prefix it cannot construct a client for.

**Supported providers:** `openai`, `vertex`, `gemini`, `aws`, `microsoft`.

**Note:** This list is normative, not descriptive — it determines which prefixes claim the provider slot, so editing it changes how existing configuration strings parse. Adding a provider SHALL be treated as potentially breaking for existing configurations: a model literally named `<new-provider>:<tag>` served by an OpenAI-compatible endpoint would begin resolving to the new provider instead of `openai`. Removing a provider is breaking in the same way, in reverse. Provider additions and removals SHALL be called out in release notes.

**Code reference:** `src/store/embeddings/EmbeddingConfig.ts:24-69` (`SUPPORTED_PROVIDERS`, the `EmbeddingProvider` type derived from it, `splitModelSpec`), `src/store/embeddings/EmbeddingConfig.ts:408` (`parse`)

#### Scenario: Model string without provider prefix
- **WHEN** the model specification is `text-embedding-3-small` (no colon)
- **THEN** the system SHALL use `openai` as the provider and `text-embedding-3-small` as the model name

#### Scenario: Model string with provider prefix
- **WHEN** the model specification is `gemini:embedding-001`
- **THEN** the system SHALL use `gemini` as the provider and `embedding-001` as the model name

#### Scenario: Model string with multiple colons
- **WHEN** the model specification is `aws:amazon.titan-embed-text-v2:0`
- **THEN** the system SHALL split on the first colon only, using `aws` as the provider and `amazon.titan-embed-text-v2:0` as the model name

#### Scenario: Model name with a tag or quantization suffix
- **WHEN** the model specification is `nomic-embed-text:latest`
- **AND** `nomic-embed-text` does not name a supported provider
- **THEN** the system SHALL use `openai` as the provider and `nomic-embed-text:latest` as the model name
- **AND** credential validation SHALL apply the `openai` requirements rather than reporting an unsupported provider

#### Scenario: Provider prefix in non-canonical case
- **WHEN** the model specification is `OpenAI:text-embedding-3-small`
- **THEN** the system SHALL use `openai` as the provider and `text-embedding-3-small` as the model name

#### Scenario: Namespaced model name with a quantization suffix
- **WHEN** the model specification is `second-state/jina-embeddings-v3-GGUF:Q4_K_M`
- **THEN** the system SHALL use `openai` as the provider and `second-state/jina-embeddings-v3-GGUF:Q4_K_M` as the model name

#### Scenario: Namespaced model name under an explicit provider prefix
- **WHEN** the model specification is `openai:jeffh/intfloat-multilingual-e5-large-instruct:f16`
- **THEN** the system SHALL use `openai` as the provider and `jeffh/intfloat-multilingual-e5-large-instruct:f16` as the model name

#### Scenario: Unrecognized leading segment
- **WHEN** the model specification is `unknown:model`
- **THEN** the system SHALL use `openai` as the provider and `unknown:model` as the model name
- **AND** the system SHALL NOT raise `UnsupportedProviderError`

#### Scenario: Mistyped provider prefix with OpenAI credentials present
- **WHEN** the model specification is `vertx:text-embedding-004`, mistyping `vertex`
- **AND** `OPENAI_API_KEY` is set
- **THEN** the system SHALL resolve the specification to the `openai` provider with model name `vertx:text-embedding-004`
- **AND** the mistake SHALL surface as an error from the configured OpenAI-compatible endpoint rather than at startup

#### Scenario: Withdrawn provider name
- **WHEN** the model specification is `sagemaker:my-endpoint`
- **AND** `sagemaker` is no longer a supported provider
- **THEN** the system SHALL use `openai` as the provider and `sagemaker:my-endpoint` as the model name
- **AND** the system SHALL NOT raise `UnsupportedProviderError`

#### Scenario: Every supported provider constructs a client
- **WHEN** a model specification names any provider in the supported-provider list
- **AND** that provider's credential requirements are satisfied
- **THEN** the system SHALL construct an embedding client for it
- **AND** the system SHALL NOT raise `UnsupportedProviderError`

### Requirement: Credential Validation
The system SHALL validate that the required provider-specific credentials are available before attempting to create the embedding model. Each provider has specific required environment variables:

| Provider | Required Variables |
|----------|-------------------|
| `openai` | `OPENAI_API_KEY` |
| `vertex` | `GOOGLE_APPLICATION_CREDENTIALS` |
| `gemini` | `GOOGLE_API_KEY` |
| `aws` | (`BEDROCK_AWS_REGION` or `AWS_REGION`) and (`AWS_PROFILE` or `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`) |
| `microsoft` | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_INSTANCE_NAME`, `AZURE_OPENAI_API_DEPLOYMENT_NAME`, `AZURE_OPENAI_API_VERSION` |

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
