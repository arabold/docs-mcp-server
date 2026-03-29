## 1. Configuration & CLI Updates

- [ ] 1.1 Add `preserveHashes` boolean property to scraper configuration schema in `src/utils/config.ts` (default: false).
- [ ] 1.2 Add `--preserve-hashes` option to `scrape` command in `src/cli/commands/scrape.ts`.
- [ ] 1.3 Add `--preserve-hashes` option to `refresh` command in `src/cli/commands/refresh.ts` and define whether it overrides stored scraper options for that version.
- [ ] 1.4 Ensure CLI scrape and refresh commands map `--preserve-hashes` to `options.preserveHashes` correctly when building or overriding `ScraperOptions`.

## 2. MCP Tool Updates

- [ ] 2.1 Extend the MCP `scrape_docs` tool input schema in `src/mcp/mcpServer.ts` to accept `preserveHashes?: boolean` with clear help text for hash-routed SPAs.
- [ ] 2.2 Update `ScrapeToolOptions` in `src/tools/ScrapeTool.ts` to include `preserveHashes?: boolean` and pass it through when enqueueing scrape jobs.
- [ ] 2.3 Add or update MCP and `ScrapeTool` tests to verify `preserveHashes` is accepted and propagated into `ScraperOptions`.

## 3. Core Scraper Strategy & Validation Updates

- [ ] 3.1 Update `ScraperOptions` interface in `src/scraper/types.ts` to include `preserveHashes?: boolean`.
- [ ] 3.2 Update `BaseScraperStrategy` crawl identity handling to respect `options.preserveHashes` for root URL normalization, `visited` deduplication, and refresh `initialQueue` processing.
- [ ] 3.3 Ensure `WebScraperStrategy` and related web-specific code use the same hash-preservation behavior for fetched/result URLs and stored page identities.
- [ ] 3.4 Add runtime enforcement so that if `preserveHashes` is true and `scrapeMode` is `fetch`, the effective mode is upgraded to `playwright` with a warning.
- [ ] 3.5 Extend refresh job construction in `PipelineManager`, `RefreshVersionTool`, and related pipeline interfaces so `preserveHashes` is stored, reused by default, and overridable when a refresh entrypoint explicitly changes it.

## 4. Playwright Middleware Fixes

- [ ] 4.1 Modify `HtmlPlaywrightMiddleware.ts` to correctly match intercepted requests. Change `if (reqUrl === context.source)` to compare `reqUrl` against the hash-stripped version of `context.source` (e.g., `reqUrl === new URL(context.source).origin + new URL(context.source).pathname + new URL(context.source).search`).
- [ ] 4.2 Add or update tests in `HtmlPlaywrightMiddleware.test.ts` to verify the interceptor works properly with URLs containing hash routes.

## 5. Web UI Updates

- [ ] 5.1 Update the Web UI forms (e.g., the add library modal/view and refresh forms) to include a "Preserve Hash Routes" checkbox.
- [ ] 5.2 Update the corresponding route handlers (e.g., in `src/web/routes/...`) to parse the checkbox value from the form submission and correctly pass `preserveHashes` into scrape and refresh pipeline options.

## 6. Documentation & Final Testing

- [ ] 6.1 Write tests in `BaseScraperStrategy.test.ts` and `WebScraperStrategy.test.ts` to verify that setting `preserveHashes` keeps distinct hash routes separate in discovery, deduplication, and storage.
- [ ] 6.2 Document the `--preserve-hashes` flag, MCP `preserveHashes` field, and Web UI toggle and their specific use case (hash-routed SPAs) in `README.md`.
- [ ] 6.3 Add refresh-focused tests covering stored-option reuse and explicit override behavior for `preserveHashes`.
- [ ] 6.4 Update `docs/setup/configuration.md` and related docs to explain the `preserveHashes` config option across CLI, MCP, Web UI, and refresh behavior.
