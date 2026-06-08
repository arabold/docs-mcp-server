## ADDED Requirements

### Requirement: Local Offline Embedding Provider
The system SHALL provide a `transformers` embedding provider that generates embeddings locally using Transformers.js (the ONNX runtime), without any API key, credentials, or network access at inference time. A model is selected with the specification `transformers:<huggingface-model>` (default model `BAAI/bge-small-en-v1.5`). The provider SHALL support any sentence-transformers feature-extraction model available on Hugging Face.

The provider SHALL produce embeddings as plain numeric vectors compatible with the generic embedding and dimension-resolution pipeline: a single query yields one vector, and a batch of documents yields one vector per document.

**Code reference:** `src/store/embeddings/TransformersJSEmbeddings.ts`, `src/store/embeddings/EmbeddingFactory.ts:274`

#### Scenario: Selecting a local model
- **WHEN** the embedding model is `transformers:BAAI/bge-small-en-v1.5`
- **AND** the companion package is installed
- **THEN** the system SHALL create a local Transformers.js embedding model
- **AND** the system SHALL NOT require any provider credentials or network access to embed text

#### Scenario: Embedding a batch of documents
- **WHEN** the provider embeds an array of N documents
- **THEN** the system SHALL return N vectors, each of the model's dimension

#### Scenario: Empty document batch
- **WHEN** the provider is asked to embed an empty array of documents
- **THEN** the system SHALL return an empty array without loading the model

### Requirement: Optional Companion Package Distribution
The heavy `@huggingface/transformers` dependency SHALL be provided by a separate, optional companion package (`@arabold/docs-mcp-server-transformers`) rather than being a runtime dependency of the main server. A default installation of the main server SHALL NOT install the companion package or the ONNX runtime, keeping the base install small. The companion package SHALL exist as an npm workspace within this repository and SHALL only re-export the dependency surface the server needs.

#### Scenario: Default install excludes the heavy dependency
- **WHEN** a user installs `@arabold/docs-mcp-server` without the companion
- **THEN** the installation SHALL NOT include `@huggingface/transformers` or the ONNX runtime
- **AND** all non-`transformers` providers SHALL continue to function

#### Scenario: Enabling local embeddings
- **WHEN** a user installs `@arabold/docs-mcp-server-transformers` alongside the server in the same `node_modules` tree
- **THEN** the `transformers` provider SHALL be able to generate embeddings

### Requirement: Lazy Companion Loading and Missing-Companion Handling
The system SHALL load the companion package lazily — only when a `transformers:` model is first used — via a dynamic import, and SHALL cache the loaded module. Importing or type-checking the main server SHALL NOT pull in the companion or its dependencies.

When the companion package is not installed, the system SHALL raise an actionable error that instructs the user to install `@arabold/docs-mcp-server-transformers`. The system SHALL only treat the package itself being absent as a missing-companion condition; a load failure caused by a broken file inside an installed companion or a failing transitive dependency SHALL be propagated unchanged rather than reported as "companion missing".

**Code reference:** `src/store/embeddings/transformersLoader.ts`

#### Scenario: Companion not installed
- **WHEN** a `transformers:` model is used
- **AND** the companion package `@arabold/docs-mcp-server-transformers` is not installed
- **THEN** the system SHALL raise an error identifying the missing companion package
- **AND** the error message SHALL include installation instructions

#### Scenario: Non-transformers usage is unaffected by a missing companion
- **WHEN** the configured provider is not `transformers`
- **THEN** the system SHALL never attempt to load the companion package
- **AND** startup SHALL not fail due to the companion being absent

#### Scenario: Broken companion is not misreported as missing
- **WHEN** the companion package is installed but its load fails for a reason other than the package being absent (e.g., a missing internal file)
- **THEN** the system SHALL propagate the original error rather than instructing the user to install the companion

### Requirement: Local Embedding Device and Cache Configuration
The system SHALL allow the inference device for local embeddings to be selected via the `TRANSFORMERS_DEVICE` environment variable, defaulting to `cpu` and supporting `webgpu` for GPU acceleration on compatible hardware. The system SHALL allow the model cache location to be set via the `TRANSFORMERS_CACHE` environment variable; models SHALL be downloaded on first use and reused from the cache on subsequent runs.

**Code reference:** `src/store/embeddings/TransformersJSEmbeddings.ts`, `src/store/embeddings/EmbeddingFactory.ts:274`

#### Scenario: Default device
- **WHEN** `TRANSFORMERS_DEVICE` is not set
- **THEN** the system SHALL run local inference on the CPU

#### Scenario: GPU device selection
- **WHEN** `TRANSFORMERS_DEVICE` is set to `webgpu`
- **THEN** the system SHALL create the local pipeline targeting the `webgpu` device

#### Scenario: Model cache directory
- **WHEN** `TRANSFORMERS_CACHE` is set to a directory
- **THEN** the system SHALL download and cache models under that directory before the first inference

### Requirement: Companion Version Compatibility and Bundled Image
The companion package SHALL be published to npm in lockstep with the main server package, so that a version-compatible companion is always available for any released server version. The official Docker image SHALL include the companion package pre-installed so that `transformers:` models work without any additional installation, with a model cache directory configured.

#### Scenario: Companion published with each release
- **WHEN** a new version of `@arabold/docs-mcp-server` is released
- **THEN** the matching version of `@arabold/docs-mcp-server-transformers` SHALL be published to npm

#### Scenario: Docker image works offline out of the box
- **WHEN** the official Docker image runs with a `transformers:` model
- **THEN** local embeddings SHALL function without installing any additional package
