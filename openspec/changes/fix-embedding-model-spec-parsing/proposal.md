## Why

Issue #484 reports that `second-state/jina-embeddings-v3-GGUF:Q4_K_M`, served by a local llama.cpp endpoint, silently disables vector search even though `OPENAI_API_KEY` and `OPENAI_API_BASE` are configured correctly. The `embedding-resolution` spec requires splitting a model specification on the first colon unconditionally, so `second-state/jina-embeddings-v3-GGUF` is read as the provider, credential validation finds no such provider, and the server falls back to FTS-only with a warning that names a model as a "provider".

The reported string is one instance of a broader defect. Any model name carrying a tag or quantization suffix hits the same path, including the standard Ollama and LM Studio naming form: `nomic-embed-text:latest`, `bge-m3:567m`, `mxbai-embed-large:335m-v1-fp16`. PR #485 proposed treating a slash in the leading segment as the signal that it is a model namespace, which fixes the reported string but leaves every unnamespaced `name:tag` broken.

The root cause is that the leading segment is trusted as a provider without ever being checked against the providers that actually exist.

## What Changes

- The leading segment of a model specification SHALL be treated as a provider only when it names a supported provider, matched case-insensitively and resolved to its canonical lowercase form. Every other specification — no colon, or an unrecognized leading segment — resolves to the `openai` provider with the entire specification kept as the model name.
- The supported-provider list becomes normative rather than descriptive: it determines which prefixes claim the provider slot. `EmbeddingProvider` is derived from that list so the two cannot drift apart, and a note in the spec plus a comment at the declaration record that adding a provider is potentially breaking for existing configurations.
- Known-dimension lookup gains namespace- and tag-stripped fallbacks, so a tagged variant of a known model resolves from the table instead of paying a startup detection round-trip. Exact matches are tried first, so identifiers that legitimately contain a colon still resolve to their own entry.
- The parsing rule is shared from `EmbeddingConfig` so `EmbeddingFactory` and `FixedDimensionEmbeddings` stop maintaining their own divergent copies, and the unchecked `as EmbeddingProvider` cast is removed.
- **BREAKING (behavioral, no API change)**: an unrecognized prefix such as `unknown:model` no longer raises `UnsupportedProviderError`. It is passed to the configured OpenAI-compatible endpoint as a model name, and a mistyped provider now surfaces as an endpoint-level error instead of a startup error. `UnsupportedProviderError` remains reachable via `sagemaker:*`, which passes credential validation but has no model-creation branch.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `embedding-resolution`: **Model Specification Parsing** is rewritten around a case-insensitive supported-provider check rather than an unconditional first-colon split. The three existing scenarios are preserved unchanged; seven scenarios are added covering tag suffixes, namespaced quantized names, non-canonical prefix casing, namespaced names under an explicit prefix, unrecognized prefixes, mistyped prefixes, and the `sagemaker` case with and without credentials.

## Impact

- **Code**:
  - [src/store/embeddings/EmbeddingConfig.ts:24-69](src/store/embeddings/EmbeddingConfig.ts:24) — add `SUPPORTED_PROVIDERS`, derive `EmbeddingProvider` from it, and add `splitModelSpec`; `parse()` delegates to it.
  - [src/store/embeddings/EmbeddingConfig.ts:370](src/store/embeddings/EmbeddingConfig.ts:370) — `findKnownDimension` tries namespace- and tag-stripped lookup keys after the exact match.
  - [src/store/embeddings/EmbeddingFactory.ts:132](src/store/embeddings/EmbeddingFactory.ts:132) — replace the local split with `splitModelSpec`; import `EmbeddingProvider` from `EmbeddingConfig` instead of redeclaring the union.
  - [src/store/embeddings/FixedDimensionEmbeddings.ts:26](src/store/embeddings/FixedDimensionEmbeddings.ts:26) — replace the local split with `splitModelSpec`.
- **APIs**: No changes to CLI flags, MCP tools, config shape, or the Web UI.
- **Docs**: [docs/guides/embedding-models.md](docs/guides/embedding-models.md) — add the bare tagged and namespaced forms to Supported Options, state that only the listed provider names claim a prefix, and switch the Ollama example off the `openai:` workaround.
- **Tests**: Table-driven coverage of both branches in `EmbeddingConfig.test.ts` and `EmbeddingFactory.test.ts`. Four existing tests encoded the old contract and change with it: `"should handle unknown providers as valid"`, `"should handle input with only colon"`, `"should handle input starting with colon"`, and `"should handle input ending with colon"`. The `UnsupportedProviderError` test in `EmbeddingFactory.test.ts` is replaced by one asserting the new fallthrough.
- **Backwards compatibility**: Every specification that resolved to a supported provider before resolves identically now — no provider name contains a colon or a slash, so no working configuration changes meaning. A prefix written in non-canonical case (`OpenAI:`, `AWS:`) previously degraded to FTS-only and now resolves to the provider it names, which is a fix rather than a regression. Configurations that previously degraded to FTS-only now initialize vector search; because no embedding metadata is written in FTS-only mode, those users take the first-run path rather than an `EmbeddingModelChangedError`.
- **Attribution**: The initial fix is PR #485 by @mikemikimike, cherry-picked onto this branch so authorship is preserved. Closes #484.
