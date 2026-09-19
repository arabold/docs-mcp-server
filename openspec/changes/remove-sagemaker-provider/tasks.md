## 1. Remove the provider

- [x] 1.1 Remove `"sagemaker"` from the `SUPPORTED_PROVIDERS` array in `src/store/embeddings/EmbeddingConfig.ts`. The `EmbeddingProvider` union narrows automatically because it is derived from the array.
- [x] 1.2 Remove the `case "sagemaker"` branch from `areCredentialsAvailable` in `src/store/embeddings/EmbeddingFactory.ts`.
- [x] 1.3 Remove `sagemaker` from the provider list in the `UnsupportedProviderError` message in `src/store/embeddings/EmbeddingFactory.ts`, which currently advertises it as supported.
- [x] 1.4 Remove the `- sagemaker: AWS SageMaker hosted models` line from the `parse()` docstring in `src/store/embeddings/EmbeddingConfig.ts`.

## 2. Compile-time exhaustiveness

- [x] 2.1 Replace the `default` branch of the `createEmbeddingModel` switch with a `never` assertion (`const _exhaustive: never = provider;`) that still throws `UnsupportedProviderError`, so a provider added to `SUPPORTED_PROVIDERS` without a creation branch fails `npm run typecheck` rather than a user's startup. Remove the comment added by `fix-embedding-model-spec-parsing` that describes the branch as reachable via `sagemaker:*`.
- [x] 2.2 Reconciled: `fix-embedding-model-spec-parsing`'s design now carries a **Superseded by `remove-sagemaker-provider`** note on its `default`-branch paragraph, stating that its reasoning describes the state at that commit and that the runtime guard becomes a compile-time one here.
- [x] 2.3 Decided: leave `areCredentialsAvailable`'s `default` branch untouched. It is in the same position as the factory's, but `define-embedding-provider-registry` deletes the function outright in favour of the registry-driven preflight rule, so reshaping it now would be churn that conflicts with that change. Noted there instead: `return false` is a quiet default that reads as "no credentials", which is why the registry replaces the function rather than patching it.

## 3. Known-dimension entries

- [x] 3.1 Relabel the `// SageMaker models (hosted on AWS SageMaker)` comment group in `src/store/embeddings/EmbeddingConfig.ts`. The three entries (`intfloat/multilingual-e5-large`, `multilingual-e5-large`, `text-embedding-multilingual-e5-large`) are ordinary open-weight model names servable from any OpenAI-compatible endpoint — keep them, and describe them as such.

## 4. Tests

- [x] 4.1 Remove `"sagemaker"` from the `validProviders` list in `src/store/embeddings/EmbeddingConfig.test.ts`.
- [x] 4.2 Delete the `"should throw UnsupportedProviderError for a provider without a creation branch"` test in `src/store/embeddings/EmbeddingFactory.test.ts`. Its subject no longer exists.
- [x] 4.3 Add the durable replacement: a table-driven test asserting that every member of `SUPPORTED_PROVIDERS`, given its credentials, constructs a client without throwing `UnsupportedProviderError`. This is the testable form of "every supported provider has a creation branch" and prevents a repeat of the half-added provider.
- [x] 4.4 Add a test that `sagemaker:my-endpoint` now resolves to the `openai` provider with the full string as the model name.
- [x] 4.5 Confirmed: `npm test` 1950 passed / 132 files, `npm run typecheck` clean, `npm run lint` clean.

## 5. Documentation

- [x] 5.1 In `docs/guides/embedding-models.md`, remove `sagemaker` from the list of names that claim a provider prefix. Confirm no configuration example or environment-variable table row references it.
- [x] 5.2 Confirmed: `README.md` has no `sagemaker` reference and no provider enumeration — its only provider mention links to the embedding models guide. No change needed.
- [x] 5.3 Confirmed: `ARCHITECTURE.md` has no `sagemaker` reference and no embedding-provider enumeration. No change needed.
- [x] 5.4 Swept. Remaining hits are all intentional: this change's own artifacts, the deliberate `sagemaker:my-endpoint` regression test, `fix-embedding-model-spec-parsing`'s artifacts describing the pre-removal state, and `openspec/specs/embedding-resolution/spec.md`, which the delta updates at archive time. No production code references remain.

## 6. Spec delta

- [x] 6.1 Apply the `embedding-resolution` delta in `openspec/changes/remove-sagemaker-provider/specs/embedding-resolution/spec.md`, modifying **Model Specification Parsing** (drop the provider from the list, drop the two scenarios describing a provider without a creation branch, drop the sentence pointing at the Credential Validation note) and **Credential Validation** (drop the `sagemaker` table row).
- [x] 6.2 Confirmed: this delta's **Model Specification Parsing** text is the post-`fix-` requirement minus `sagemaker`, so the two compose when archived in order. Both changes must ship together; `fix-`'s delta lists six providers, matching its own commit, and this one reduces the list to five.

## 7. Release

- [ ] 7.1 Note the behavioral break in the PR description: `sagemaker:<endpoint>` no longer raises `UnsupportedProviderError` and instead resolves as an OpenAI-compatible model name. Record that no working configuration is affected, because the provider never constructed a client.
- [ ] 7.2 State in the release notes that SageMaker was never implemented and is being withdrawn rather than removed from a working state, so the entry is not read as a regression.
