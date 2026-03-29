## 1. Configuration & CLI Updates

- [ ] 1.1 Add `preserveHashes` boolean property to scraper configuration schema in `src/utils/config.ts` (default: false).
- [ ] 1.2 Add `--preserve-hashes` option to `scrape` command in `src/cli/commands/scrape.ts`.
- [ ] 1.3 Add `--preserve-hashes` option to `refresh` command in `src/cli/commands/refresh.ts`.
- [ ] 1.4 Ensure CLI commands map `--preserve-hashes` to `options.preserveHashes` correctly when building the `ScraperOptions`.

## 2. MCP Tool Updates

- [ ] 2.1 Extend the MCP `scrape_docs` tool input schema in `src/mcp/mcpServer.ts` to accept `preserveHashes?: boolean` with clear help text for hash-routed SPAs.
- [ ] 2.2 Update `ScrapeToolOptions` in `src/tools/ScrapeTool.ts` to include `preserveHashes?: boolean` and pass it through when enqueueing scrape jobs.
- [ ] 2.3 Add or update MCP and `ScrapeTool` tests to verify `preserveHashes` is accepted and propagated into `ScraperOptions`.

## 3. Core Scraper Strategy & Validation Updates

- [ ] 3.1 Update `ScraperOptions` interface in `src/scraper/types.ts` to include `preserveHashes?: boolean`.
- [ ] 3.2 Update `WebScraperStrategy` to respect `options.preserveHashes`. Pass `removeHash: !options.preserveHashes` via `urlNormalizerOptions` when normalizing URLs during queue processing.
- [ ] 3.3 Add validation to `ScraperService` or `PipelineManager` (or `WebScraperStrategy` initialization) to ensure that if `preserveHashes` is true, the `scrapeMode` is not explicitly set to `fetch` (throw a validation error or warn and upgrade to `playwright`).

## 4. Playwright Middleware Fixes

- [ ] 4.1 Modify `HtmlPlaywrightMiddleware.ts` to correctly match intercepted requests. Change `if (reqUrl === context.source)` to compare `reqUrl` against the hash-stripped version of `context.source` (e.g., `reqUrl === new URL(context.source).origin + new URL(context.source).pathname + new URL(context.source).search`).
- [ ] 4.2 Add or update tests in `HtmlPlaywrightMiddleware.test.ts` to verify the interceptor works properly with URLs containing hash routes.

## 5. Web UI Updates

- [ ] 5.1 Update the Web UI forms (e.g., the add library modal/view and refresh forms) to include a "Preserve Hash Routes" checkbox.
- [ ] 5.2 Update the corresponding route handlers (e.g., in `src/web/routes/...`) to parse the checkbox value from the form submission and correctly pass `preserveHashes: true` to the pipeline options.

## 6. Documentation & Final Testing

- [ ] 6.1 Write tests in `WebScraperStrategy.test.ts` to verify that setting `preserveHashes` queues URLs with varying hashes as distinct documents.
- [ ] 6.2 Document the `--preserve-hashes` flag, MCP `preserveHashes` field, and Web UI toggle and their specific use case (hash-routed SPAs) in `README.md`.
- [ ] 6.3 Update `docs/setup/configuration.md` and related docs to explain the `preserveHashes` config option across CLI, MCP, and Web UI.
