## Context

The store currently has several dimension concepts that can diverge: configured `embeddings.vectorDimension`, known model dimensions, detected model dimensions, SQLite `documents_vec` DDL, and persisted metadata. Fixed-output models are well served by known dimensions, but OpenAI-compatible providers can expose aliases, custom models, or Matryoshka/resizable models whose actual output dimension depends on provider configuration.

Choosing the largest supported dimension for resizable models is safe for compatibility but expensive. Vectors are stored as float arrays, so storage and index work scale roughly linearly with dimension count. For example, an 8192d vector uses about 8x the raw float storage of a 1024d vector before SQLite/index overhead.

## Goals / Non-Goals

**Goals:**
- Use the provider's actual output dimension by default for unknown or variable-dimension models.
- Preserve explicit `embeddings.vectorDimension` as an opt-in override.
- Keep stable known-dimension lookup for common fixed-output models.
- Ensure vector table DDL, metadata, change detection, padding, and validation use one resolved effective dimension.
- Avoid hardcoding one arbitrary dimension for models that advertise multiple valid outputs.

**Non-Goals:**
- Adding provider-specific APIs to request alternate dimensions.
- Automatically selecting the largest or best-performing dimension for variable-dimension models.
- Backfilling or re-embedding existing documents after a dimension change.
- Changing embedding model selection or credentials behavior.

## Decisions

1. **Resolve one effective dimension before vector table creation**
   - The store resolves an effective dimension before metadata comparison, `documents_vec` creation, prepared statements, and embedding metadata persistence.
   - Rationale: all persistence and validation surfaces must agree on a single dimension.
   - Alternative considered: allow `initializeEmbeddings()` to detect dimensions after table creation. Rejected because the table can already be created with the wrong dimension.

2. **Runtime detection is the default for unknown and variable-dimension models**
   - Unknown models and known variable-dimension models perform a startup probe by embedding `"test"` and measuring the returned vector length.
   - Rationale: OpenAI-compatible providers are the authority on their actual output shape, especially when a model supports multiple dimensions.
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

## Risks / Trade-offs

- **Startup probe can fail for unknown or variable-dimension models** -> Surface the same initialization error path used for other embedding startup failures; fixed known models avoid probing.
- **Auto-detected dimension changes when provider configuration changes** -> Metadata comparison detects the resolved dimension change before reusing old vectors.
- **Explicit override smaller than non-MRL output would truncate incorrectly** -> Raise `DimensionError` unless the embedding wrapper explicitly allows MRL truncation.
- **Large provider output can increase storage unexpectedly** -> Log the resolved dimension and document explicit overrides for users who want smaller provider-configured outputs.
- **Known variable-dimension model registry can become stale** -> Unknown models still probe; add aliases to the runtime-detected set when a known model advertises multiple dimensions.
