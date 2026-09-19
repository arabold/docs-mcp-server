# Design: embedding provider registry

## Context

Everything a provider needs is currently spread across four places that must be kept in agreement by hand:

```
  EmbeddingConfig.ts     SUPPORTED_PROVIDERS       the name exists
  EmbeddingFactory.ts    areCredentialsAvailable   what env vars it needs
  EmbeddingFactory.ts    createEmbeddingModel      how to build it
  EmbeddingFactory.ts    MissingCredentialsError   what env vars it needs (again)
```

Adding a provider means editing four sites; forgetting one fails differently each time. Forgetting the creation branch throws at startup — that was `sagemaker` for a year. Forgetting the credential branch returns `false` from a `default` case, which reads as "no credentials" and degrades to FTS-only with no error at all.

## Decision

One declaration per provider, read by everything else.

```ts
interface EmbeddingProviderDefinition {
  name: EmbeddingProvider;

  /** Environment variables this provider reads. Used for messages and docs. */
  requiredEnv: readonly string[];

  /**
   * Whether credentials can reach the SDK without appearing in requiredEnv —
   * instance roles, ECS task roles, SSO, GCP Application Default Credentials,
   * or an endpoint that requires no authentication at all.
   *
   * When true, absence of requiredEnv proves nothing and construction proceeds.
   * When false, absence is conclusive: the configuration cannot work.
   */
  credentialsMayBeAmbient(env: NodeJS.ProcessEnv): boolean;

  create(model: string, options: ProviderCreateOptions): Embeddings;
}
```

`credentialsMayBeAmbient` is a predicate rather than a boolean because `openai` is not a constant:

```ts
// Ollama, LM Studio, llama.cpp and other OpenAI-compatible servers frequently
// require no authentication. A key is only provably required when the target
// is api.openai.com.
credentialsMayBeAmbient: (env) => Boolean(env.OPENAI_API_BASE),
```

The rest are constants: `vertex` and `aws` are `true` (ADC, instance and task roles, SSO, web identity); `gemini` and `microsoft` are `false` (API-key products with no ambient path).

### The preflight rule

```
   required env all present?
        │
     ┌──┴──┐
    yes    no
     │      │
     │      └──▶ credentialsMayBeAmbient(env)?
     │                    │
     │              ┌─────┴─────┐
     │             yes          no
     │              │            │
     ▼              ▼            ▼
   build       build anyway   conclusive misconfiguration
                the live       (see the open policy decision)
                call decides
```

One rule, five providers, no switch. The registry answers the only question a static check can answer honestly — *"is this configuration provably unusable?"* — and defers everything else to the live `embedQuery("test")` that dimension detection already performs, whose error handling in `DocumentStore.throwEmbeddingInitializationError` already separates authentication failures, missing models, and connection failures.

### Why the static gate is no longer the right shape

It was correct when written. `areCredentialsAvailable` arrived on 2025-09-20; dimension detection's live startup call arrived on 2026-06-06. For nine months the only way to fail before the first document was scraped was to guess from the environment. Since then there has been a layer that knows, and it produces better messages than the guess.

What remains for a static check is the narrow case where the guess cannot be wrong: a provider that has no ambient credential path, with its credentials absent. That is what the registry encodes.

## What is specified and what is not

Per the project's preference for specifications that prevent mistakes rather than pin values, construction requirements are split by whether violating them is *silently* wrong.

**Specified (SHALL).** Each of these, if removed, produces incorrect behavior with no error, and each is assertable against the constructed client:

| Invariant | Failure if removed |
|---|---|
| Float encoding requested for OpenAI-compatible clients | vectors silently a quarter length, all zeros |
| Azure maps the model name to the deployment name | requests to a nonexistent deployment |
| Gemini, and only Gemini, is wrapped with truncation allowed | either lost MRL truncation or wrongly truncated non-MRL vectors |
| `OPENAI_API_BASE` redirects the client when set | requests silently go to api.openai.com |
| `BEDROCK_AWS_REGION` takes precedence over `AWS_REGION` | wrong region, confusing failure |
| Every supported provider constructs a client | a half-added provider, which is how `sagemaker` survived a year |

**Not specified (described only).** These will be tuned and should not require a spec delta: the OpenAI client's batch size, request timeouts, and newline stripping.

The last row of the specified table deserves note: it is a requirement about the *shape of the provider set* rather than any provider's details. It is four lines to test, and it converts "someone forgot a branch" from a defect users discover into one the suite catches.

## Alternatives considered

**Keep the switches, add a spec.** Rejected: specifying four hand-synchronized sites documents the coupling rather than removing it, and the `sagemaker` and ambient-credentials defects both came from those sites disagreeing.

**Drop preflight entirely and let the live call decide everything.** Tempting, since that call is the ground truth. Rejected because it loses the one case worth failing fast on — a user who names an API-key provider with no key gets a network round-trip and a 401 instead of an immediate, accurate message — and because a hanging endpoint costs `initTimeoutMs` before anything is reported.

**Make the registry data-only and keep construction in the switch.** Rejected: construction is the part that varies most per provider and the part with the invariants worth specifying. Splitting the declaration from the construction recreates the synchronization problem in smaller form.
