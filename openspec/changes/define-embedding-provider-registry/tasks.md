## 0. Prerequisite

- [ ] 0.1 Confirm `remove-sagemaker-provider` has landed. The **Construction Completeness** requirement cannot hold while a supported provider exists that cannot be constructed.
- [x] 0.2 Failure policy settled: report prominently, continue in full-text-only mode, never abort startup. Applied uniformly to absent credentials, rejected credentials, unavailable models, unreachable endpoints, and detection timeouts.

## 1. Registry

- [ ] 1.1 Add a provider registry module under `src/store/embeddings/` with one entry per supported provider, declaring `name`, `requiredEnv`, `credentialsMayBeAmbient(env)`, and `create(model, options)`.
- [ ] 1.2 Type the registry so that it must cover every member of `EmbeddingProvider` — a `Record<EmbeddingProvider, EmbeddingProviderDefinition>` makes a missing entry a compile error, which is the testable form of **Construction Completeness**.
- [ ] 1.3 Declare `credentialsMayBeAmbient` per provider: `openai` returns `Boolean(env.OPENAI_API_BASE)`; `vertex` and `aws` return true (ADC, instance and task roles, SSO, web identity); `gemini` and `microsoft` return false. Comment each with the reason, since the values are not guessable from the provider name.
- [ ] 1.4 Move each provider's construction from the `createEmbeddingModel` switch into its registry entry's `create`, preserving the existing options verbatim. Keep the `encodingFormat: "float"` comment — the spec now carries the requirement, but the comment explains the mechanism at the point of use.

## 2. Preflight

- [ ] 2.1 Implement the preflight rule from the spec: required env present → construct; absent but ambient-capable → construct; absent and not ambient-capable → report per the policy chosen in 0.2.
- [ ] 2.2 Delete `areCredentialsAvailable` and update its three call sites in `src/store/DocumentStore.ts` (`checkEmbeddingModelChange`, `initializeEmbeddings`, `resolveEffectiveEmbeddingDimension`) to the preflight rule.
- [ ] 2.3 Delete the five `MissingCredentialsError` throws inside `createEmbeddingModel`. They duplicate the preflight logic; the registry is now the only declaration of what a provider requires.
- [ ] 2.4 Decide the fate of `MissingCredentialsError` itself. If the preflight rule raises, it is the natural error to raise — keep it and construct it from the registry entry's `requiredEnv` rather than from per-provider literals.
- [ ] 2.5 Verify the warning text no longer claims "no credentials found" for a provider whose credentials may be ambient. The current message names the provider and tells the user to configure environment variables that may be irrelevant to their deployment.
- [ ] 2.6 Note the reach limit of the live check: `resolveEffectiveEmbeddingDimension` probes the provider only when the model's dimensions are unknown, so a known-dimension model — including the built-in default — contacts nothing at startup. For those configurations preflight is the only startup-time check, and rejected credentials surface at the first scrape rather than at boot. Decide whether the failure policy needs a startup probe for known-dimension models, or whether reporting at first use is acceptable.
- [ ] 2.7 Make the rejected-credential path non-fatal. `throwEmbeddingInitializationError` is typed `: never` and its `ModelConfigurationError` is re-thrown by `DocumentStore.initialize()`, aborting startup. Under the settled policy it reports and returns, leaving `isVectorSearchEnabled` false. Check whether `ModelConfigurationError` still has callers afterwards, and whether `initialize()`'s re-throw list still needs it.
- [ ] 2.8 Add the re-indexing consequence to the failure report: documents indexed while vector search is disabled are stored with `NULL` embeddings and need re-scraping once embeddings work. The current message says only "Only full-text search will be available."

## 3. Construction invariants

- [ ] 3.1 Assert float encoding is requested for OpenAI-compatible clients. This is the invariant with no current test and the one whose removal is silent.
- [ ] 3.2 Assert the Azure deployment mapping: `microsoft:my-deployment` targets deployment `my-deployment`.
- [ ] 3.3 Assert Gemini is wrapped with truncation allowed and that no other provider is.
- [ ] 3.4 Assert `OPENAI_API_BASE` redirects the constructed client.
- [ ] 3.5 Assert `BEDROCK_AWS_REGION` takes precedence over `AWS_REGION`.
- [ ] 3.6 Assert every registry entry constructs a client without raising `UnsupportedProviderError`, given satisfied credentials.
- [ ] 3.7 Do not assert batch sizes, timeouts, or newline stripping. They are tuning parameters and the spec deliberately leaves them unspecified.

## 4. Preflight tests

- [ ] 4.1 Per provider, both directions: required env present → constructs; required env absent → behaves per that provider's `credentialsMayBeAmbient`.
- [ ] 4.2 `aws` with no `AWS_PROFILE` and no key pair proceeds to construction rather than degrading — the instance-role case that fails today.
- [ ] 4.3 `vertex` with no `GOOGLE_APPLICATION_CREDENTIALS` proceeds to construction — the ADC case that fails today.
- [ ] 4.4 `openai` with no key and no `OPENAI_API_BASE` is reported as conclusively unusable.
- [ ] 4.5 `openai` with no key but with `OPENAI_API_BASE` set proceeds to construction with no warning — the local-model case that currently requires a placeholder key.

## 4b. Default model validity

- [ ] 4b.1 Add a test asserting the built-in default embedding model has known dimensions: `getKnownDimensions(DEFAULT_CONFIG.app.embeddingModel)` is not null. This is what keeps a fresh, offline first start from needing a live probe before it can create the vector table.
- [ ] 4b.2 Add a test asserting those dimensions do not exceed `DEFAULT_CONFIG.embeddings.vectorDimension`. Today both are 1536 and nothing enforces the match; a default of `text-embedding-3-large` (3072) would make every fresh install throw `DimensionError` at startup.
- [ ] 4b.3 Add a test asserting the default specification resolves to the `openai` provider.
- [ ] 4b.4 Remove the duplicate default. `EmbeddingConfig.parse()` falls back to a hardcoded `"text-embedding-3-small"` literal that is independent of `DEFAULT_CONFIG.app.embeddingModel`; changing the configured default would leave this copy behind. Import the single definition or drop the fallback.

## 5. Documentation

- [ ] 5.1 In `docs/guides/embedding-models.md`, remove the `OPENAI_API_KEY="ollama"` placeholder from the Ollama example and any equivalent in the LM Studio example. Explain that a custom endpoint needs a key only if the endpoint itself requires one.
- [ ] 5.2 In the same guide, state which providers accept ambient credentials, so users on EC2, ECS, Cloud Run, or GKE know they need not set explicit variables.
- [ ] 5.3 Check `README.md` and `ARCHITECTURE.md` for statements about credential requirements that this change invalidates.
- [ ] 5.4 Document that a failed embedding configuration degrades to full-text-only rather than blocking startup, and that documents indexed during that window need re-scraping.

## 6. Spec delta

- [ ] 6.1 Apply the new `embedding-provider-integration` capability in `openspec/changes/define-embedding-provider-registry/specs/embedding-provider-integration/spec.md`.
- [ ] 6.2 Apply the `embedding-resolution` removal of **Credential Validation** in `openspec/changes/define-embedding-provider-registry/specs/embedding-resolution/spec.md`.
- [x] 6.3 The failure policy is stated as its own requirement, **Embedding Failure Policy**, rather than deferred in a note.

## 7. Release

- [ ] 7.1 Note that deployments using ambient AWS or GCP credentials gain vector search where they previously ran full-text-only. This is a fix, but it changes startup behavior and begins making embedding API calls where none were made before.
- [ ] 7.2 Note the local-model simplification: a placeholder `OPENAI_API_KEY` is no longer required when `OPENAI_API_BASE` is set.
- [ ] 7.3 Note that a rejected API key no longer aborts startup. Installations that relied on a hard failure to catch expired credentials will now start degraded, with a prominent error instead of a crash.
