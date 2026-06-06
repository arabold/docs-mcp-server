## Why

Embedding providers increasingly expose OpenAI-compatible endpoints for custom, aliased, and variable-dimension models. A fixed default dimension or stale known-model entry can create vector tables that do not match the provider's actual output, corrupting semantic search or wasting storage.

## What Changes

- Resolve the effective vector dimension before vector table creation, model-change checks, and metadata persistence.
- Treat `embeddings.vectorDimension` as an explicit override when provided by user configuration, environment variables, or CLI arguments.
- Auto-detect the provider's actual output dimension for unknown models and known variable-dimension models only when no matching stored dimension exists.
- Treat the persisted `embedding_model` + `embedding_dimension` metadata as a lock so repeated startups do not make paid probe requests for the same model.
- Keep known-dimension lookup for stable fixed-output models to avoid unnecessary startup API calls.
- Avoid choosing the largest supported dimension for variable-dimension models by default, because vector storage and index cost grow with dimension width.
- Preserve explicit user overrides for deployments that intentionally pad or select a provider-specific dimension, with model or explicit dimension changes continuing through the existing model-change safety flow.

## Capabilities

### New Capabilities

### Modified Capabilities
- `embedding-resolution`: Dimension resolution must distinguish fixed known dimensions, locked stored dimensions, runtime-detected dimensions, and explicit overrides.
- `embedding-generation`: Vector normalization and table sizing must use the resolved effective dimension, not an unconditional configured default.
- `embedding-model-change-safety`: Model change detection and metadata must compare and persist the resolved effective dimension.

## Impact

- Affects embedding startup in `DocumentStore`, known-dimension lookup in `EmbeddingConfig`, and config source tracking for explicit dimension overrides.
- Affects SQLite `documents_vec` table creation and embedding metadata values.
- Adds regression coverage for unknown OpenAI-compatible models, variable-dimension models, stored-dimension reuse, and explicit dimension overrides.
- No dependency changes and no breaking configuration changes.
