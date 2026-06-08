## Why

Users who want semantic search without sending document content to a third-party API (air-gapped, privacy-sensitive, or cost-averse setups) currently have no offline embedding option. Transformers.js can run sentence-transformer models locally, but its ONNX runtime weighs ~370 MB across all platform binaries — far too heavy to add to every install of a tool whose default users rely on hosted APIs. We need offline embeddings available to those who want them without inflating the install footprint for everyone else.

## What Changes

- Add a new `transformers` embedding provider that generates embeddings locally and offline, with no API key or network access required.
- Externalize the heavy `@huggingface/transformers` dependency into an **optional companion package**, `@arabold/docs-mcp-server-transformers`, kept in this repo as an npm workspace. The main server depends on it only as a wildcard `devDependency`, so a default end-user install does **not** pull in the ONNX runtime.
- Load the companion lazily via a dynamic import the first time a `transformers:` model is used. When the companion is not installed, surface an actionable error telling the user to install it; never fail at startup or for non-transformers users.
- Keep the integration code (the embeddings class, provider wiring, loader) in the main repo; the companion is a thin re-exporter only.
- Publish the companion in lockstep with the main package from the release pipeline (semantic-release and manual paths) so a version-compatible companion always exists on npm.
- Bundle the companion into the official Docker image so `transformers:` models work out of the box there, caching models under `TRANSFORMERS_CACHE=/models`.
- Fix the known vector dimension for `BAAI/bge-small-en-v1.5` from 512 to its actual 384.

## Capabilities

### New Capabilities
- `local-embeddings`: Offline, local embedding generation via the optional Transformers.js companion package — provider behavior, lazy companion loading, missing-companion handling, device/cache configuration, and how the companion is distributed (workspace, lockstep release, Docker).

### Modified Capabilities
- `embedding-resolution`: The supported-provider list and credential-validation rules change — `transformers` becomes a fully supported provider (not parse-only) that requires no credentials, and the `BAAI/bge-small-en-v1.5` known-dimension entry is corrected to 384.

## Impact

- **New package:** `packages/transformers/` (`@arabold/docs-mcp-server-transformers`), an npm workspace re-exporting `@huggingface/transformers`.
- **New source:** `src/store/embeddings/transformersLoader.ts`, `src/store/embeddings/TransformersJSEmbeddings.ts`.
- **Modified source:** `EmbeddingFactory.ts` and `EmbeddingConfig.ts` (provider plumbing + dimension fix).
- **Build/dist:** `vite.config.ts` externalizes the companion; root `package.json` gains `workspaces` and a wildcard companion `devDependency`; the `build` script compiles the companion first.
- **Release/CI:** `.releaserc.json` and `.github/workflows/release.yml` publish the companion in lockstep. Existing `ci.yml`/`eval.yml` need no change (npm workspaces + build cover it).
- **Docker:** `Dockerfile` copies the companion and adds the `/models` cache volume.
- **Docs:** `docs/guides/embedding-models.md`, `README.md`.
- **No breaking changes** for existing users: no new runtime dependency in the default install, no behavior change for non-`transformers` providers.
