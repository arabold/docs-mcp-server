## MODIFIED Requirements

### Requirement: Model Specification Parsing
The system SHALL resolve the provider of an embedding model specification by matching the segment preceding the first colon against the set of supported providers. The match SHALL be case-insensitive, and the resolved provider SHALL be its canonical lowercase form.

When that segment names a supported provider, the system SHALL split on the first colon only, using the segment as the provider and the remainder as the model name. This ensures provider model identifiers containing colons (e.g. `aws:amazon.titan-embed-text-v2:0`) are handled correctly.

In every other case — no colon present, or a leading segment that does not name a supported provider — the system SHALL use the `openai` provider and treat the entire specification as the model name. This ensures model names carrying a tag or quantization suffix (e.g. `nomic-embed-text:latest`, `second-state/jina-embeddings-v3-GGUF:Q4_K_M`) reach OpenAI-compatible endpoints intact rather than being misread as an unsupported provider and silently degraded to FTS-only mode.

A specification whose leading segment names a supported provider resolves to that provider even when no model-creation branch exists for it; see the `sagemaker` note under Credential Validation.

**Supported providers:** `openai`, `vertex`, `gemini`, `aws`, `microsoft`, `sagemaker`.

**Note:** This list is normative, not descriptive — it determines which prefixes claim the provider slot, so editing it changes how existing configuration strings parse. Adding a provider SHALL be treated as potentially breaking for existing configurations: a model literally named `<new-provider>:<tag>` served by an OpenAI-compatible endpoint would begin resolving to the new provider instead of `openai`. Provider additions SHALL be called out in release notes.

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

#### Scenario: Supported provider without a model-creation branch
- **WHEN** the model specification is `sagemaker:my-endpoint`
- **AND** the `sagemaker` credential requirements are satisfied
- **THEN** the system SHALL use `sagemaker` as the provider and `my-endpoint` as the model name
- **AND** model creation SHALL raise `UnsupportedProviderError`

#### Scenario: Supported provider without a model-creation branch and without credentials
- **WHEN** the model specification is `sagemaker:my-endpoint`
- **AND** the `sagemaker` credential requirements are not satisfied
- **THEN** the system SHALL use `sagemaker` as the provider and `my-endpoint` as the model name
- **AND** credential validation SHALL fail before model creation is attempted
- **AND** the system SHALL fall back to FTS-only mode without raising `UnsupportedProviderError`
