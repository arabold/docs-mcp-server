# Design: fix embedding model spec parsing

## Context

A model specification is a single string from `DOCS_MCP_EMBEDDING_MODEL`, `app.embeddingModel`, or `--embedding-model`. It has to carry two different things in one field: an optional provider selector, and a model name that the provider's own ecosystem may have named with colons and slashes already.

Three components parsed that string independently, with three slightly different implementations:

| Site | Rule |
|---|---|
| `EmbeddingConfig.parse` | split on first colon; no colon means `openai` |
| `createEmbeddingModel` | `split(":")`, rejoin the tail; empty tail means `openai` |
| `FixedDimensionEmbeddings` | `split(":")`, take `[0]` and `[1]`; the tail past a second colon is dropped |

All three shared the same defect: the leading segment was accepted as a provider without checking that the provider exists. Downstream, `areCredentialsAvailable` returns `false` from its `default` branch for anything unrecognized, so the failure is not an error but a silent degradation to FTS-only, reported as "No credentials found for `<model name>` embedding provider."

## Decision

Resolve the provider by membership in the supported-provider set, not by string shape. One exported helper, `splitModelSpec`, is the single definition; the other two sites call it. Membership is matched case-insensitively and resolved to the canonical lowercase name, so `OpenAI:` and `AWS:` reach the providers they name instead of becoming model names — the rest of the module already lowercases before lookup, and a prefix that differs only in case is a spelling of the provider, not a different one.

```
  spec = "second-state/jina-embeddings-v3-GGUF:Q4_K_M"
              │
              ▼
      indexOf(":") === -1 ?  ──yes──▶  { openai, <whole spec> }
              │
              no
              ▼
      prefix ∈ SUPPORTED_PROVIDERS ?
              │
        ┌─────┴─────┐
       yes          no
        │            │
        ▼            ▼
  { prefix,     { openai,
    tail }        <whole spec> }
```

### Why not the slash heuristic

PR #485 keyed on a `/` in the leading segment, reading it as a HuggingFace-style namespace. That recognizes the string in the issue but not the shape that causes it. The failing input is `<anything-not-a-provider>:<anything>`, and the most common real instance of that shape — Ollama's and LM Studio's `nomic-embed-text:latest` — has no slash. The heuristic also grows a second definition of "what a model name looks like" that has to be kept in agreement with the provider list, whereas checking the provider list directly cannot drift from it.

### Why this is not a compatibility break for working configurations

The new rule only reinterprets a specification when the leading segment is *not* a supported provider. No supported provider's name contains a colon or a slash, so every specification that resolved to a real provider before resolves identically now. The specifications whose meaning changes are exactly the ones that were already broken.

The upgrade path is also clean in the database. A configuration that previously resolved to a bogus provider never completed `initializeEmbeddings()`, so no `embedding_model` metadata was written. On upgrade those users hit the first-run path, not `EmbeddingModelChangedError`.

## Trade-off: UnsupportedProviderError becomes unreachable from typos

Under the old rule, `openi:text-embedding-3-small` produced a clear startup error naming an unsupported provider. Under the new rule it becomes a model named `openi:text-embedding-3-small` sent to the configured OpenAI-compatible endpoint, which fails there instead.

This is accepted. The old error is precisely what users with correctly configured local endpoints were hitting, and it was wrong far more often than it was right: a provider list of six names against an open-ended space of model names means an unrecognized prefix is overwhelmingly more likely to be a model name than a typo. A startup error cannot distinguish the two, so the parser should favor the common case and let the endpoint report what it does not recognize.

`UnsupportedProviderError` is retained and still reachable. `sagemaker` is in the provider union and in `areCredentialsAvailable`, but `createEmbeddingModel` has no `sagemaker` branch, so `sagemaker:my-endpoint` passes credential validation and lands in the `default` case. The error's handling in `src/cli/main.ts` and `src/store/DocumentStore.ts` stays live, and the `default` branch additionally guards a provider added to the union without a matching factory branch.

## The provider list is now load-bearing

Before this change the provider list was descriptive — it recorded which `switch` cases existed. It is now normative: it decides which prefixes claim the provider slot, so editing it changes how existing configuration strings parse.

The concrete hazard: if `cohere` is added as a provider, a user running a model literally named `cohere:embed-v4` against an OpenAI-compatible gateway silently flips from `openai` to `cohere`, and a working configuration breaks on upgrade.

This is recorded as a note on the parsing requirement and as a comment at the `SUPPORTED_PROVIDERS` declaration rather than as a separate requirement — it constrains how maintainers change the list, not how the system behaves at runtime. Provider additions should be called out in release notes.

Prose alone would not have caught the other half of the hazard: a provider added to the `EmbeddingProvider` union but missing from the set would silently reintroduce the #484 failure for that provider, with no compiler or test signal. So the union is derived from the array (`const SUPPORTED_PROVIDERS = [...] as const` and `type EmbeddingProvider = (typeof SUPPORTED_PROVIDERS)[number]`) rather than written twice. The list is now the only place a provider name appears, and the note governs what is left — the compatibility consequence of editing it.

## Alternatives considered

**Keep the first-colon split and add an escape hatch** (e.g. requiring `openai:` for any model name containing a colon). Rejected: it makes the common local-model case the one that needs special syntax, and every existing working config with a bare `name:tag` would still need editing.

**Infer from `OPENAI_API_BASE` being set.** Rejected: couples parsing to unrelated configuration, and a user can legitimately set a custom base URL while still using a `gemini:` model elsewhere in their setup.

**Validate the prefix and hard-error on an unknown one** rather than falling through to `openai`. Rejected for the reason above — it reinstates exactly the failure mode in #484 for every model name that happens to contain a colon.
