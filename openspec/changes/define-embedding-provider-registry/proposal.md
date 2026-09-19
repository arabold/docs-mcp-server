## Why

Provider handling is the one stage of the embedding lifecycle with no specification. Parsing, dimension determination, identity persistence, and generation each have requirements; the step between them — turning a resolved provider into a working client — is roughly 140 lines of `createEmbeddingModel` governed by nothing.

That gap has already produced defects:

- **`encodingFormat: "float"`** exists only as a code comment. Without it the OpenAI SDK requests base64 and unconditionally decodes the response, so OpenAI-compatible providers that return JSON floats (Mistral, LM Studio, Ollama) yield a silently corrupted vector a quarter the expected length with every element zero. Nothing tests it. Deleting the line leaves the suite green while search quality collapses.
- **Credential detection contradicts itself inside one file.** `areCredentialsAvailable` refuses to start when AWS keys are absent from the environment, while the Bedrock branch twenty lines below comments "let SDK resolve via profile/other means." Instance roles, ECS task roles, SSO, and GCP Application Default Credentials all satisfy the provider and fail the gate, so those deployments degrade silently to FTS-only.
- **The failure policy is inverted relative to intent.** Omitting `OPENAI_API_KEY` entirely is caught by the static gate and degrades quietly; supplying a *wrong* key passes the gate and fails loudly at the live call. The case most worth raising is the quiet one.
- **The same credential logic is written twice**, once in `areCredentialsAvailable` and once as five `MissingCredentialsError` throws inside the factory.
- **Local setups are told to invent a credential.** The embedding models guide instructs Ollama users to set `OPENAI_API_KEY="ollama"`, a placeholder whose only purpose is to satisfy the static gate.

The static gate was the right design when it was written (2025-09-20): nothing contacted the provider at startup, so a guess from environment variables was the only way to fail early. Since `32dead5` (2026-06-06) a startup whose model has unknown dimensions performs a real `embedQuery("test")`, and its error handling distinguishes authentication failures, missing models, and connection failures with better messages than the guess can produce.

That live check does not cover every configuration. `resolveEffectiveEmbeddingDimension` probes only when the model's dimensions are unknown, so a known-dimension model — including the built-in default — still contacts nothing at startup. Preflight therefore remains the only startup-time check for exactly the configurations most users run, which is why it needs to be correct rather than removed.

## What Changes

- Introduce a **provider registry**: one declaration per supported provider carrying its required environment variables, whether its credentials can arrive from ambient sources (IAM roles, ADC), and how to construct its client. The registry becomes the single place a provider is described.
- Replace `areCredentialsAvailable` and the five in-factory `MissingCredentialsError` throws with **one preflight rule** reading the registry: if required configuration is absent and that provider's credentials cannot be ambient, the configuration is conclusively unusable and the system reports it. Otherwise construction proceeds and the live dimension-detection call is the arbiter.
- `openai` declares ambient credentials as conditional on `OPENAI_API_BASE`. A custom endpoint may legitimately require no authentication; the absence of a key is conclusive only when the target is `api.openai.com`.
- Add the new `embedding-provider-integration` capability specifying the registry, the preflight rule, and the construction invariants whose violation is silently wrong — float encoding, the Azure deployment-name mapping, Gemini's MRL truncation wrapper, `OPENAI_API_BASE` redirection, and AWS region precedence. Tuning values (batch sizes, timeouts) are described but not required, so they can change without a spec delta.
- Move **Credential Validation** out of `embedding-resolution` into the new capability. Resolution owns turning a string into a provider and model; the new capability owns everything about making that provider work.
- Drop the `OPENAI_API_KEY="ollama"` placeholder from the embedding models guide, which is no longer needed once a custom base URL suppresses the conclusive-failure rule.
- Pin the properties that make the built-in default model usable on a fresh install — resolves to `openai`, dimensions known without a provider request, dimensions within the default vector dimension — so the default can be changed safely but not carelessly. Today `text-embedding-3-small` (1536) and the default vector dimension (1536) agree with nothing enforcing it.
- Apply one failure policy to every reason embeddings cannot be used, replacing today's split where absent credentials degrade quietly and rejected credentials abort startup. See **Failure policy** below.

## Capabilities

### New Capabilities
- `embedding-provider-integration`: Defines the provider registry, the credential preflight rule that distinguishes conclusive misconfiguration from credentials that may arrive at call time, the per-provider client construction invariants, and the requirement that every supported provider can be constructed.

### Modified Capabilities
- `embedding-resolution`: **Credential Validation** is removed; it is superseded by the preflight requirement in `embedding-provider-integration`. **Default Model Validity** is added, pinning the properties a built-in default must have rather than only its value. The remaining requirements are unchanged.

## Impact

- **Code**:
  - `src/store/embeddings/` — new provider registry module holding one entry per provider.
  - [src/store/embeddings/EmbeddingFactory.ts](src/store/embeddings/EmbeddingFactory.ts) — `createEmbeddingModel` becomes a registry lookup plus the entry's own construction; `areCredentialsAvailable` is replaced by the preflight rule.
  - [src/store/DocumentStore.ts:642](src/store/DocumentStore.ts:642) — the three `areCredentialsAvailable` call sites move to the preflight rule.
- **APIs**: No changes to CLI flags, MCP tools, config shape, or the Web UI.
- **Docs**: `docs/guides/embedding-models.md` — drop the placeholder-key instruction for local providers, and state which providers accept ambient credentials.
- **Tests**: Cover each construction invariant; cover the preflight rule in both directions per provider (absent-and-conclusive raises, absent-and-ambient proceeds); assert every registry entry constructs a client.
- **Backwards compatibility**: Three observable changes. Deployments relying on ambient AWS or GCP credentials gain vector search where they previously ran FTS-only. Local setups no longer need a placeholder `OPENAI_API_KEY` when `OPENAI_API_BASE` is set. Rejected credentials no longer abort startup — see **Failure policy** below.
- **Depends on**: `remove-sagemaker-provider`. A registry whose central requirement is "every supported provider constructs a client" cannot be written while a provider exists that cannot.

## Failure policy

When embeddings are configured but cannot be used, the system reports the failure prominently and continues in full-text-only mode. It does not refuse to start: full-text search remains available for every indexed document, and aborting startup would deny it.

This applies uniformly to every reason — credentials conclusively absent, credentials rejected, model unavailable, endpoint unreachable, dimension detection timing out. Today those are split: absent credentials warn and degrade, while rejected credentials raise `ModelConfigurationError`, which `DocumentStore.initialize()` re-throws and which aborts startup. **Making the policy uniform means the rejected-credential path stops being fatal.** A server whose API key expired will now start in full-text-only mode with a prominent error rather than refusing to boot.

The report must also state a consequence that today's warning omits: documents indexed while vector search is disabled are stored with `NULL` embeddings and require re-indexing once embeddings work again. Degraded operation is not free, and the operator needs to know that before scraping continues.

`EmbeddingModelChangedError` is out of scope for this policy. It signals that stored vectors would be invalidated, not that embeddings are unavailable, and its confirmation flow in `embedding-model-change-safety` is unchanged.
