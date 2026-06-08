# Tasks

> Note: This change was implemented before the OpenSpec proposal was written, to capture the rationale and contract retroactively. All tasks below are already complete on the branch and are checked off to reflect the implemented state.

## 1. Companion package

- [x] 1.1 Create `packages/transformers/` npm workspace package `@arabold/docs-mcp-server-transformers` (version in lockstep with main) with `package.json`, `tsconfig.json`, and `README.md`
- [x] 1.2 Implement `src/index.ts` re-exporting `pipeline`, `env`, and the `FeatureExtractionPipeline` type from `@huggingface/transformers`
- [x] 1.3 Declare `@huggingface/transformers` as the companion's only runtime dependency; add `prepack` build and `publishConfig.access: public`

## 2. Workspace and bundling wiring

- [x] 2.1 Add `workspaces: ["packages/*"]` and a wildcard `devDependency` on the companion to the root `package.json`
- [x] 2.2 Make the root `build` script compile the companion before building the server
- [x] 2.3 Externalize the companion in `vite.config.ts` so the dynamic import is preserved and never bundled

## 3. Loader and embeddings provider

- [x] 3.1 Implement `src/store/embeddings/transformersLoader.ts`: lazy literal-string dynamic import with caching, minimal structural types, `TransformersCompanionMissingError`, and `isCompanionMissingError` (only matches the bare package specifier)
- [x] 3.2 Implement `src/store/embeddings/TransformersJSEmbeddings.ts` on top of the loader (lint-clean; sets `env.cacheDir` from `TRANSFORMERS_CACHE` before first use; empty-batch early return)

## 4. Provider plumbing and dimension fix

- [x] 4.1 Add `transformers` to the `EmbeddingProvider` union in `EmbeddingFactory.ts` and `EmbeddingConfig.ts`, and to the `UnsupportedProviderError` message
- [x] 4.2 Make `areCredentialsAvailable("transformers")` return true and add the `createEmbeddingModel` case (reads `TRANSFORMERS_DEVICE`)
- [x] 4.3 Correct the `BAAI/bge-small-en-v1.5` known dimension from 512 to 384
- [x] 4.4 Confirm no `transformers`-specific branch is added to `DocumentStore` (generic dimension resolution handles it)

## 5. Tests

- [x] 5.1 `transformersLoader.test.ts`: error mapping (`isCompanionMissingError`) including the broken-internal-file case, and `TransformersCompanionMissingError` shape
- [x] 5.2 `TransformersJSEmbeddings.test.ts`: query/batch embedding, empty batch, dimension detection, single init, newline stripping, cache dir, device selection (loader mocked)
- [x] 5.3 Extend `EmbeddingFactory.test.ts` (transformers provider, no credentials) and `EmbeddingConfig.test.ts` (parse + 384 dimension)

## 6. Distribution: release and Docker

- [x] 6.1 Add a second `@semantic-release/npm` (`pkgRoot: packages/transformers`) and include the companion `package.json` in the git-commit assets in `.releaserc.json`
- [x] 6.2 Add companion bump + `npm publish --workspace` to the manual-release path in `.github/workflows/release.yml`
- [x] 6.3 Update `Dockerfile` to install the workspace, copy `packages/` into the runtime stage, and configure `TRANSFORMERS_CACHE=/models` with a `/models` volume
- [x] 6.4 Confirm `ci.yml`/`eval.yml` need no changes (verified via clean `npm ci` + build)

## 7. Docs and verification

- [x] 7.1 Document the local/offline provider and companion install in `docs/guides/embedding-models.md`, `README.md`
- [x] 7.2 Verify: typecheck, lint, targeted tests, full build (companion externalized, ONNX not bundled), and a companion-resolution smoke test
