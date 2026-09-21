## Why

`sagemaker` has been an advertised embedding provider since `83bc1ac` (2025-09-20) and has never worked. That commit added it to the provider union, to `areCredentialsAvailable`, and to the `UnsupportedProviderError` message's own list of supported providers — but never to `createEmbeddingModel`. Selecting it passes credential validation and then throws. No implementation has ever existed in the repository's history.

Finishing it is not a small gap. `@langchain/aws` exports exactly one embeddings class, `BedrockEmbeddings`; neither `@aws-sdk/client-sagemaker-runtime` nor `@langchain/community` is a dependency. Beyond the missing plumbing, a SageMaker endpoint has no standard request/response schema — the payload shape depends on the container that was deployed — so a model specification of the form `sagemaker:<endpoint>` is structurally unable to configure one. Supporting it properly requires designing a content-handler configuration surface, which is a separate piece of work.

Leaving a provider in the list that cannot be constructed has three costs: users are told it is supported and discover otherwise at startup, the `embedding-resolution` spec has to carry requirements describing a provider that always fails, and it blocks a clean specification of provider handling.

## What Changes

- Remove `sagemaker` from `SUPPORTED_PROVIDERS`, from `areCredentialsAvailable`, from the `UnsupportedProviderError` message, from the embedding models guide, and from the `embedding-resolution` spec.
- Every remaining supported provider has a model-creation branch, so the `createEmbeddingModel` switch becomes exhaustive. Replace its `default` branch with a compile-time exhaustiveness assertion (`const _exhaustive: never = provider`) so a provider added to the union without a matching branch fails `npm run typecheck` instead of failing at a user's startup.
- Keep the three known-dimension entries currently labelled `// SageMaker models` (`intfloat/multilingual-e5-large` and its aliases). They are ordinary model names servable by any OpenAI-compatible endpoint; only the comment is wrong. Relabel it.
- **BREAKING (behavioral, no API change)**: a `sagemaker:<endpoint>` specification no longer raises `UnsupportedProviderError`. Since `sagemaker` is no longer a recognized prefix, the whole string resolves as an OpenAI-compatible model name and is sent to the configured endpoint. No working configuration is affected, because no configuration using this provider could work.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `embedding-resolution`: **Model Specification Parsing** drops `sagemaker` from the supported-provider list and loses the two scenarios describing a provider without a model-creation branch. **Credential Validation** drops the `sagemaker` row and its "model creation is not implemented" note.

## Impact

- **Code**:
  - [src/store/embeddings/EmbeddingConfig.ts:30](src/store/embeddings/EmbeddingConfig.ts:30) — remove the `SUPPORTED_PROVIDERS` entry; `EmbeddingProvider` narrows automatically because it is derived from the array.
  - [src/store/embeddings/EmbeddingConfig.ts:148](src/store/embeddings/EmbeddingConfig.ts:148) — relabel the `// SageMaker models` comment; keep the entries.
  - [src/store/embeddings/EmbeddingConfig.ts:403](src/store/embeddings/EmbeddingConfig.ts:403) — remove `sagemaker` from the `parse()` docstring's provider list.
  - [src/store/embeddings/EmbeddingFactory.ts:23](src/store/embeddings/EmbeddingFactory.ts:23) — remove `sagemaker` from the `UnsupportedProviderError` message.
  - [src/store/embeddings/EmbeddingFactory.ts:76](src/store/embeddings/EmbeddingFactory.ts:76) — remove the `case "sagemaker"` credential branch.
  - [src/store/embeddings/EmbeddingFactory.ts:260](src/store/embeddings/EmbeddingFactory.ts:260) — replace the `default` branch with a `never` exhaustiveness assertion.
- **APIs**: No changes to CLI flags, MCP tools, config shape, or the Web UI.
- **Docs**: [docs/guides/embedding-models.md](docs/guides/embedding-models.md) — remove `sagemaker` from the provider list. `README.md` needs no change; it links to the guide rather than enumerating providers.
- **Tests**: Remove the `sagemaker` case from the `validProviders` list and delete the test asserting `sagemaker:my-endpoint` reaches `UnsupportedProviderError`. Add a test that every supported provider constructs a client, which is the durable replacement for the deleted one.
- **Backwards compatibility**: Behavior changes only for `sagemaker:*` specifications, which could not function before. Those installations ran in FTS-only mode or failed at startup, so no embedding metadata was written for them and no `EmbeddingModelChangedError` results.
- **Open decision**: whether `UnsupportedProviderError` and its handling in [src/cli/main.ts:144](src/cli/main.ts:144) and [src/store/DocumentStore.ts:997](src/store/DocumentStore.ts:997) are removed along with the runtime branch. Recommendation: keep the class and throw it from the exhaustiveness assertion, so the compile-time guard has a runtime companion if a future refactor reintroduces an untyped path. Removing it is churn for no user-visible gain.
