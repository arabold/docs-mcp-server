## Context

Embeddings power the server's semantic vector search. Providers so far (`openai`, `gemini`, `vertex`, `aws`, `microsoft`) are all hosted APIs: they need credentials and send chunk text off-host. Some users cannot or will not do that (air-gapped, regulated, privacy-sensitive, or simply cost-averse) and want fully local embeddings.

Transformers.js (`@huggingface/transformers`) can run sentence-transformer models locally on the ONNX runtime. The blocker is size: `@huggingface/transformers` plus `onnxruntime-node` (which bundles native binaries for win32 + linux + darwin) and `onnxruntime-web` totals **~370 MB** installed. Adding that to the base package would roughly 10× the install for the majority of users who use hosted APIs and never touch local embeddings.

The project ships to npm (`@arabold/docs-mcp-server`, currently a single package) and to a Docker image, and releases via semantic-release with a manual-dispatch fallback. It targets Node 22 (ESM), builds with Vite/Rollup (SSR config externalizes `dependencies`), and uses npm as the package manager.

## Goals / Non-Goals

**Goals:**
- Offer a fully local, offline `transformers:` embedding provider — no credentials, no network at inference time.
- Keep the default install of `@arabold/docs-mcp-server` free of the ~370 MB ONNX runtime.
- Make enabling local embeddings a single explicit action (`npm i -g @arabold/docs-mcp-server-transformers`) with a clear error when it's missing.
- Keep all integration logic in the main repo (testable, reviewable here); the external package carries only the dependency.
- Guarantee a version-compatible companion is always available on npm and pre-installed in Docker.
- Avoid any behavior or footprint change for existing non-`transformers` users.

**Non-Goals:**
- A general plugin/extension system. This is a single, purpose-built companion, not a registry of providers.
- Bundling/vendoring the ONNX runtime into the main package or the npm tarball in any form.
- GPU support beyond exposing the existing `webgpu` device toggle.
- Pre-downloading models (they download on first use, like Playwright browsers already do).

## Decisions

### 1. Companion package that re-exports, loaded by name via dynamic import
The heavy dependency lives in a separate package, `@arabold/docs-mcp-server-transformers` (`packages/transformers/`), whose entire job is `export { pipeline, env } from "@huggingface/transformers"`. The main server imports **the companion by name**, never `@huggingface/transformers` directly.

- *Why re-export instead of importing transformers directly with it marked optional?* Module resolution is deterministic: the server resolves the companion as a sibling package, and the companion resolves `@huggingface/transformers` from its own dependency subtree, regardless of how npm hoists things. The server never needs to know transformers' resolution path.
- *Why a companion at all vs. `optionalDependencies`?* `optionalDependencies` are still installed by default; they only add install-failure resilience, not size savings. They would not keep the runtime out of the base install.
- *Alternative considered — runtime auto-install (`npm i` on demand):* rejected as fragile (no network in air-gapped installs, permission issues for global installs, surprising side effects).

### 2. Lazy dynamic import with a literal specifier
`transformersLoader.ts` does `import("@arabold/docs-mcp-server-transformers")` only on first use, caching the promise. The specifier is a **string literal** so Rollup can externalize it (a variable specifier cannot be externalized) and the import survives bundling as a real runtime `import()`. The companion is added to `vite.config.ts`'s `external` list explicitly because it is a `devDependency`, not a runtime `dependency`, so it isn't covered by the automatic `Object.keys(dependencies)` externalization.

### 3. Structural types instead of importing transformers' types
The loader declares minimal structural types (`FeatureExtractionPipeline`, `TransformersModule`, etc.) and `TransformersJSEmbeddings.ts` imports those from the loader (a local file). The main package therefore never imports `@huggingface/transformers` even at the type level, so `tsc` and the bundler never pull it in. The companion is only required to be installed at runtime, and only when local embeddings are actually used.

### 4. Reuse `main`'s generic dimension resolution; no transformers-specific store logic
Recent work (#431) resolves vector dimensions generically: known models via a lookup table, unknown models via a one-shot `embedQuery("test").length` probe before the vector table is created. `TransformersJSEmbeddings.embedQuery` returns a plain `number[]`, so this path handles it with no `DocumentStore` changes. We deliberately do **not** add a `transformers`-specific branch to the store. We only correct the known dimension for `BAAI/bge-small-en-v1.5` (512 → 384, its real hidden size).

### 5. Provider requires no credentials; companion presence checked lazily
`areCredentialsAvailable("transformers")` returns `true` (local models need none). The companion's availability is verified when the model is first loaded, not at credential-check or startup time. For known-dimension models this means a missing companion surfaces at first embed rather than at init — an accepted trade-off (documented below).

### 6. Lockstep versioning, published by the release pipeline
The companion is versioned and published in lockstep with the main package. Implementation: a second `@semantic-release/npm` instance with `pkgRoot: packages/transformers` (and the same in the manual path) publishes the companion at the release version; `prepack` builds its `dist` first; `publishConfig.access: public` covers the first publish. The main package's `devDependency` on the companion is the wildcard `"*"` so lockstep version bumps never break npm-workspace linking in dev/CI/Docker.

- *Why lockstep vs. independent versioning?* It gives users a trivial compatibility rule ("install the same version of both") and guarantees that every server release has a matching companion on npm.

### 7. Docker bakes the companion in
The image installs the whole workspace (`npm ci`) and copies `packages/` into the runtime stage so the workspace symlink resolves. `TRANSFORMERS_CACHE=/models` with a `/models` volume caches downloaded models across runs.

## Risks / Trade-offs

- **Late failure for known models** → For models in the dimension lookup table, a missing companion isn't detected at init (no probe runs), so the error appears at first actual embed. Mitigated by a clear, actionable `TransformersCompanionMissingError`. A future refinement could do a cheap existence check (e.g. `import.meta.resolve`) at init.
- **Misclassifying load errors as "companion missing"** → A broken file inside an installed companion could be mistaken for the package being absent. Mitigated: `isCompanionMissingError` only matches `ERR_MODULE_NOT_FOUND`/`MODULE_NOT_FOUND` whose message quotes the bare package specifier (`'@arabold/...'`), not an internal file path; everything else is rethrown unchanged.
- **`npx` isolation** → `npx @arabold/docs-mcp-server` will not see a globally-installed companion (separate trees). Mitigated by documenting `npm i -g <both>` or `npx -p <both>`.
- **CI/dev now pulls ~370 MB** → `npm ci` installs the companion's transformers dependency for the workspace. This is necessary to build/test the companion and is acceptable (it affects CI, not end users). End-user install size is unchanged.
- **Two-package release complexity** → A second publish step adds release surface. Mitigated by the wildcard devDependency (no version-sync script needed) and `prepack` guaranteeing `dist` is built before publish.

## Migration Plan

- Purely additive; no data migration. Existing databases and non-`transformers` configs are unaffected.
- Rollback: revert the change. Because the companion is a `devDependency` and loaded lazily, removing it has no effect on any other provider. Users who installed the companion can simply uninstall it.

## Open Questions

- None blocking. Possible future refinements: an init-time companion existence check to convert late failures to early ones, and an optional Docker variant without the companion for size-sensitive deployments.
