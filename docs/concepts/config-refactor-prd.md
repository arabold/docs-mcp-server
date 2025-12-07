# Config Resolution & Injection PRD (temporary)

## Goal

- Resolver/schema/YAML loader with precedence and grouped `AppConfig` slices lives in `config.ts`; compatibility alias removed.
- README documents override precedence and YAML example.
- CLI commands (default/worker/web/mcp/scrape/refresh/search/list/find-version/remove/fetch-url) resolve config once, set `app.storePath` from CLI/env, and pass `appConfig` into document management/pipeline setup; scraper CLI threads scraper limits via resolved config.
- Store layer constructors now accept `(eventBus, appConfig)` for `DocumentManagementService` and `(dbPath, appConfig)` for `DocumentStore`; store path and embedding model come solely from `appConfig.app`.
- Embedding factory respects runtime timeouts/vector dims; migrations retry settings are runtime-configurable via config.
- Pipeline and scraper fetchers/strategies receive injected config (concurrency, limits); MCP tool init/stdio flows carry resolved config; fetch-url CLI injects scraper config.
- Config naming clarified where multiple configs coexist (e.g., `pipelineConfig` vs `appConfig` across factories/services/CLI tests); tests updated to set `appConfig.app.storePath`/`embeddingModel` explicitly; E2E suites pass with embeddings disabled via empty model when needed.
- `config.ts` remains the single schema source (defaults, env/yaml metadata); all documented envs exposed via `AppConfig` slices (`app`, `auth`, `server`, `scraper`, `embeddings`, `store`, etc.).
- Full test suite currently passing after config refactor changes.
- Preserve current CLI flag names (backward compatibility).

Out of scope (for now): adding new CLI flags, changing provider secret handling, altering runtime behavior beyond config sourcing.

- Monitor future feature work to keep new consumers on injected config slices (no ad-hoc env reads).
- Keep tests adding new config-dependent code using resolved `appConfig` fixtures to avoid drift.

1. Defaults in `config.ts`
2. YAML file (if present)
3. Legacy env vars (HOST/PORT/DOCS_MCP_HOST/etc. and existing provider vars)
4. Generic env `DOCS_MCP_<KEY>` (for every exported constant)
5. CLI overrides passed into `loadConfig` (unchanged flag names)

## Resolver design

- Add `ConfigKey` and `ConfigSchema` in `config.ts` with: `defaultValue`, optional `legacyEnv[]`, `parser` (int, bool, string, durations), optional `yamlKey` mapping.
- Generic env key computed as `DOCS_MCP_${key}`.
- YAML loader: look for `DOCS_MCP_CONFIG` or `docs-mcp.config.yaml` in CWD; warn on unknown keys.
- Export `loadConfig(overrides?: Partial<Record<ConfigKey, unknown>>): AppConfig` and cache unless overrides provided.
- Provide grouped `AppConfig` slices: `server`, `scraper` (fetcher, timeouts), `splitter`, `embeddings`, `store` (db, search weights), `assembly`, `sandbox/parser` as needed.

## Injection pattern

- Resolve once in entrypoints (CLI/server bootstrap) and pass slices to constructors/factories.
- Consumers merge `configSlice` as base + per-instance options (no direct env reads in lower layers).
- Narrow slices to what each consumer needs (avoid passing whole config blindly).

## Consumer touchpoints (audit)

- CLI/server: `cli/commands/{default,mcp,web,worker,scrape}.ts`, `mcp/mcpServer.ts`, `services/mcpService.ts` (heartbeat), `AppServer` creation.
- Pipeline: `pipeline/PipelineFactory.ts`, `PipelineManager.ts` (concurrency, recovery defaults).
- Scraper: `scraper/strategies/BaseScraperStrategy.ts`, fetchers (`HttpFetcher`, `BrowserFetcher`), middleware (`HtmlPlaywrightMiddleware`), pipelines factory chunk sizes (`scraper/pipelines/PipelineFactory.ts`).
- Splitters: `splitter/JsonDocumentSplitter.ts` (+ tests), shared chunk size defaults.
- Store/embeddings: `store/DocumentStore.ts` (chunk sizes, batch sizes, search weights, vector dim), `store/types.ts` (vector dim), `store/embeddings/EmbeddingFactory.ts` (timeouts, dims), `store/applyMigrations.ts` (retries/delay).
- Assembly: `store/assembly/strategies/*.ts` (limits).
- Misc: sandbox timeouts, parser size limits.

## Phased plan

1. Resolver + types + YAML + README snippet (precedence, env pattern, YAML example).
2. Entry points: CLI/server boot calls `loadConfig` and threads slices through `createAppServerConfig`, pipelines, scraper tools.
3. Consumer refactor by area: pipeline → scraper → splitters → store/embeddings → assembly/misc; remove direct env/config imports in favor of injected slices.
4. Tests/docs: adjust constructors in tests; document usage and migration notes.

## Risks / considerations

- Need to maintain backward compatibility for existing envs and CLI flags.
- Avoid over-sharing config; prefer typed slices to prevent accidental misuse.
- YAML parsing errors should be clear; unknown keys warned not fatal.
- Keep secrets handling unchanged.

## Status

- Resolver/schema/YAML loader + `loadConfig` implemented in `config.ts` with precedence and grouped `AppConfig` slices; compatibility alias removed.
- README documents override precedence and YAML example.
- CLI commands (default/worker/web/mcp/scrape/refresh/search/list/find-version/remove/fetch-url) call `loadConfig` and pass `AppConfig` into document management/pipeline setup; scraper CLI threads scraper limits via resolved config.
- Store layer builds `DocumentStore`/`DocumentManagementService` with injected `appConfig`; embedding factory respects runtime timeouts/vector dims; migrations retry settings are runtime-configurable.
- Pipeline/pipeline clients receive injected config (concurrency from config); scraper fetchers and strategies require injected scraper config; MCP tool init/stdio flows carry resolved config; fetch-url CLI injects scraper config.
- Config naming clarified where multiple configs coexist (e.g., `pipelineConfig` vs `appConfig` across factories/services/CLI tests).
- `config.ts` remains the single schema source (defaults, env/yaml metadata); compatibility envs captured; all documented envs exposed via `AppConfig` slices (`app`, `auth`, `server`, `scraper`, `embeddings`, `store`, etc.).
- Suites passing after targeted renames; full-suite rerun still recommended after latest changes.

## Next actions

1. Run full test suite to confirm post-naming changes across CLI/service layers.
2. Align scraper/strategy/unit tests to use shared resolved-config fixtures (avoid ad-hoc `loadConfig()` where injection is intended).
3. Sweep remaining splitters/assembly helpers for direct env/config imports and replace with injected slices; rerun the suite.
