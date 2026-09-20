## 1. Shared parsing rule

- [x] 1.1 In `src/store/embeddings/EmbeddingConfig.ts`, add the `SUPPORTED_PROVIDERS` array, derive the `EmbeddingProvider` union from it so the two cannot drift, and add the exported `splitModelSpec(spec)` helper that splits on the first colon only when the leading segment names a supported provider, and otherwise returns `openai` with the whole specification as the model name.
- [x] 1.2 Match the provider prefix case-insensitively and return its canonical lowercase form, so `OpenAI:text-embedding-3-small` resolves to the `openai` provider instead of becoming a model name.
- [x] 1.3 Delegate `EmbeddingConfig.parse` to `splitModelSpec`, removing the unchecked `as EmbeddingProvider` cast.
- [x] 1.4 Extend `findKnownDimension` to try the model name with its namespace and trailing tag removed, so a tagged variant of a known model (e.g. `nomic-ai/nomic-embed-text-v2-moe:latest`) resolves from the table instead of paying a startup detection round-trip. Exact matches are tried first so `amazon.titan-embed-text-v2:0` still resolves to its own entry.

## 2. Remove duplicate parsers

- [x] 2.1 In `src/store/embeddings/EmbeddingFactory.ts`, replace the local `split(":")` parsing with `splitModelSpec` and import `EmbeddingProvider` from `EmbeddingConfig` instead of redeclaring the union. Do not re-export the type — nothing outside these modules consumes it.
- [x] 2.2 In `src/store/embeddings/FixedDimensionEmbeddings.ts`, replace the local `split(":")` parsing with `splitModelSpec`. This also fixes the dropped tail past a second colon in the `DimensionError` message.
- [x] 2.3 Keep the `default` branch of the `createEmbeddingModel` switch, with a comment recording why. It is reachable via `sagemaker:*` and guards a provider added to the union without a matching factory branch.

## 3. Tests

- [x] 3.1 In `EmbeddingConfig.test.ts`, add table-driven coverage of both branches: specifications that keep an explicit provider prefix (`openai:`, `vertex:`, `gemini:`, `aws:…:0`, `microsoft:`, `openai:<namespace>/<model>:<tag>`), and specifications resolved wholly as OpenAI model names (namespaced, tag-suffixed, and unnamespaced quantized forms).
- [x] 3.2 In `EmbeddingConfig.test.ts`, update the four tests that encoded the old contract: `"should handle unknown providers as valid"`, `"should handle input with only colon"`, `"should handle input starting with colon"`, `"should handle input ending with colon"`.
- [x] 3.3 In `EmbeddingFactory.test.ts`, broaden the namespaced-model test into a table covering tag-suffixed names, and replace the `UnsupportedProviderError` test with one asserting that an unrecognized prefix yields an `OpenAIEmbeddings` instance whose `modelName` is the full specification.
- [x] 3.4 Cover the paths the spec pins but the suite missed: `sagemaker:my-endpoint` with AWS credentials reaching `UnsupportedProviderError`, a non-canonical-case provider prefix, a supported prefix with an empty tail (`openai:`), and the tagged/quantized dimension lookups.
- [x] 3.5 Confirm the full suite, typecheck, and lint pass.

## 4. Provider-list note

- [x] 4.1 Add a comment at the `SUPPORTED_PROVIDERS` declaration in `src/store/embeddings/EmbeddingConfig.ts` recording that the list is normative: adding a provider changes how existing specifications parse, and a model literally named `<new-provider>:<tag>` on an OpenAI-compatible endpoint would flip providers on upgrade.
- [x] 4.2 Add a comment at the `default` branch of the `createEmbeddingModel` switch in `src/store/embeddings/EmbeddingFactory.ts` recording that it is reachable via `sagemaker:*` and is the remaining guard for a provider added to the union without a factory branch, so it is not removed as dead code.

## 5. User documentation

- [x] 5.1 In `docs/guides/embedding-models.md`, add the bare tagged and namespaced forms to Supported Options, state that only the listed provider names claim a prefix (case-insensitively), and change the Ollama example from the `openai:` workaround to `nomic-embed-text:latest`.

## 6. Spec delta

- [x] 6.1 Apply the `embedding-resolution` delta in `openspec/changes/fix-embedding-model-spec-parsing/specs/embedding-resolution/spec.md`. The delta replaces the Model Specification Parsing requirement wholesale, including its `**Code reference:**` line, which was already stale on `main` (it pointed at `EmbeddingConfig.ts:290-317`).

## 7. Release

- [x] 7.1 Noted in PR #498 under **Behavioral changes**, item 1.
- [x] 7.2 Opened as PR #498, crediting @mikemikimike for the cherry-picked initial commit, closing #484 and superseding #485.
