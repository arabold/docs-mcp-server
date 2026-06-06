## 1. Dimension Resolution

- [x] 1.1 Track whether `embeddings.vectorDimension` was explicitly supplied by user config, environment variables, or CLI arguments.
- [x] 1.2 Update known-dimension lookup to distinguish fixed-output known models from known variable-dimension models.
- [x] 1.3 Add aliases for current fixed-output provider model names that unambiguously resolve to known dimensions.
- [x] 1.4 Add a runtime-detected model set for known variable-dimension models such as Stella/Jasper entries.

## 2. Store Initialization

- [x] 2.1 Resolve the effective database dimension before vector table creation, metadata comparison, and statement preparation.
- [x] 2.2 Use known fixed dimensions without startup probing when no explicit override is configured.
- [x] 2.3 Probe unknown and variable-dimension models with a test embedding when no explicit override is configured.
- [x] 2.4 Persist the resolved effective dimension in embedding metadata after successful initialization.

## 3. Vector Validation

- [x] 3.1 Create `documents_vec` with the resolved effective dimension.
- [x] 3.2 Normalize generated embeddings against the resolved effective dimension.
- [x] 3.3 Preserve zero-padding for vectors smaller than the resolved dimension.
- [x] 3.4 Reject oversized non-MRL vectors instead of silently truncating them.
- [x] 3.5 Preserve explicit vector dimension overrides as authoritative opt-in behavior.

## 4. Safety and Documentation

- [x] 4.1 Compare stored embedding metadata against the current resolved effective dimension during model-change checks.
- [x] 4.2 Document runtime dimension probing and explicit override behavior in the embedding model guide.
- [x] 4.3 Add regression tests for unknown models, explicit overrides, non-MRL truncation rejection, and variable-dimension model probing.
- [x] 4.4 Run targeted tests, typecheck, lint, and build verification.

## 5. Stored Dimension Lock

- [x] 5.1 Reuse stored `embedding_dimension` without provider probing when stored `embedding_model` matches the current configured model and no explicit vector dimension override changed.
- [x] 5.2 Probe unknown and variable-dimension models only on first successful initialization or after an intentional model/dimension change.
- [x] 5.3 Update regression tests to prove matching stored metadata skips the startup probe for unknown and variable-dimension models.
- [x] 5.4 Update documentation to explain that detected dimensions are locked in database metadata until the user changes model or vector dimension configuration.
