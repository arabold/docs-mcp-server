## Context

The store currently has several dimension concepts that can diverge: configured `embeddings.vectorDimension`, known model dimensions, detected model dimensions, SQLite `documents_vec` DDL, and persisted metadata. Fixed-output models are well served by known dimensions, but OpenAI-compatible providers can expose aliases, custom models, or Matryoshka/resizable models whose actual output dimension depends on provider configuration.

Choosing the largest supported dimension for resizable models is safe for compatibility but expensive. Vectors are stored as float arrays, so storage and index work scale roughly linearly with dimension count. For example, an 8192d vector uses about 8x the raw float storage of a 1024d vector before SQLite/index overhead.

Startup probes are also not free. Providers can bill for embedding calls, so an unknown or variable-dimension model should not require a paid probe every time the server boots after the database already has matching embedding metadata.

## Goals / Non-Goals

**Goals:**
- Use the provider's actual output dimension by default for unknown or variable-dimension models.
- Persist the first detected dimension and reuse it on later startups for the same model.
- Preserve explicit `embeddings.vectorDimension` as an opt-in override.
- Keep stable known-dimension lookup for common fixed-output models.
- Ensure vector table DDL, metadata, change detection, padding, and validation use one resolved effective dimension.
- Avoid hardcoding one arbitrary dimension for models that advertise multiple valid outputs.

**Non-Goals:**
- Adding provider-specific APIs to request alternate dimensions.
- Automatically selecting the largest or best-performing dimension for variable-dimension models.
- Backfilling or re-embedding existing documents after a dimension change.
- Changing embedding model selection or credentials behavior.
- Detecting provider-side dimension drift proactively on every startup after metadata is established.

## Decisions

1. **Resolve one effective dimension before vector table creation**
   - The store resolves an effective dimension before metadata comparison, `documents_vec` creation, prepared statements, and embedding metadata persistence.
   - Rationale: all persistence and validation surfaces must agree on a single dimension.
   - Alternative considered: allow `initializeEmbeddings()` to detect dimensions after table creation. Rejected because the table can already be created with the wrong dimension.

2. **Runtime detection establishes a stored dimension lock**
   - Unknown models and known variable-dimension models perform a startup probe by embedding `"test"` only when there is no stored metadata for the same configured model and no explicit dimension override.
   - The detected dimension is persisted as `embedding_dimension` and reused on later startups while `embedding_model` still matches.
   - Rationale: OpenAI-compatible providers are the authority on their actual first-run output shape, but repeated probe requests cost users money and can trigger accidental model-change flows when providers drift without a config change.
   - Alternative considered: probe on every startup and compare to stored metadata. Rejected because it charges users on every boot and treats provider-side drift as an automatic startup-time model change.
   - Alternative considered: hardcode the largest advertised dimension. Rejected because it wastes storage and can still mismatch providers configured to return smaller vectors.

3. **Known-dimension lookup remains for stable fixed-output models**
   - Stable models such as OpenAI, Vertex, Bedrock, Cohere, Voyage, and fixed Hugging Face models can use lookup dimensions without probing.
   - Rationale: avoids unnecessary startup API calls for models with unambiguous output dimensions.
   - Alternative considered: always probe all models. Rejected because it adds startup latency and can fail when credentials or network are temporarily unavailable.

4. **Explicit vector dimension overrides win**
   - If the user explicitly sets `embeddings.vectorDimension` through config, env, or CLI, the store uses that value and validates the model output against it.
   - Rationale: users may intentionally select a provider-specific reduced dimension or pad smaller vectors for an existing database.
   - Alternative considered: ignore user overrides for auto-detected models. Rejected because it removes an existing control surface.

5. **Resizable model entries bypass known-dimension lookup**
   - Models known to advertise multiple valid dimensions are treated as runtime-detected even if a historical value exists in the table.
   - Rationale: the list cannot represent all valid dimensions with one number.
   - Alternative considered: store arrays/ranges in the known dimensions map. Rejected for now because the vector table still needs one concrete runtime dimension and the probe already supplies it.

6. **Stored dimensions win over auto-probing until the user changes configuration**
   - If metadata contains the same `embedding_model` as the current configuration and no explicit dimension override has changed, the store uses the stored `embedding_dimension` as the effective database dimension without calling the provider.
   - Rationale: the database's vector table and stored embeddings are already tied to that dimension; preserving it avoids paid startup calls and avoids accidental invalidation.
   - Alternative considered: always prefer the current provider output over stored metadata. Rejected because this gives the provider, rather than the user, control over when existing embeddings become incompatible.

## Risks / Trade-offs

- **First-run startup probe can fail for unknown or variable-dimension models** -> Surface the same initialization error path used for other embedding startup failures; fixed known models and matching stored metadata avoid probing.
- **Provider output dimension changes after metadata is locked** -> Startup continues using the locked database dimension; subsequent embedding generation is validated against that dimension and users can intentionally change model or dimension config to trigger the existing model-change flow.
- **Explicit override smaller than non-MRL output would truncate incorrectly** -> Raise `DimensionError` unless the embedding wrapper explicitly allows MRL truncation.
- **Large provider output can increase storage unexpectedly** -> Log the resolved dimension and document explicit overrides for users who want smaller provider-configured outputs.
- **Known variable-dimension model registry can become stale** -> Unknown models still probe; add aliases to the runtime-detected set when a known model advertises multiple dimensions.
