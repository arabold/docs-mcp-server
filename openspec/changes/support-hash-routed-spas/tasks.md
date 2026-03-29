## 1. Configuration & CLI Updates

- [ ] 1.1 Add `preserveHashes` boolean property to scraper configuration schema in `src/utils/config.ts` (default: false).
- [ ] 1.2 Add `--preserve-hashes` option to `scrape` command in `src/cli/commands/scrape.ts`.
- [ ] 1.3 Add `--preserve-hashes` option to `refresh` command in `src/cli/commands/refresh.ts`.
- [ ] 1.4 Ensure CLI commands map `--preserve-hashes` to `options.preserveHashes` correctly when building the `ScraperOptions`.

## 2. Core Scraper Strategy & Validation Updates

- [ ] 2.1 Update `ScraperOptions` interface in `src/scraper/types.ts` to include `preserveHashes?: boolean`.
- [ ] 2.2 Update `WebScraperStrategy` to respect `options.preserveHashes`. Pass `removeHash: !options.preserveHashes` via `urlNormalizerOptions` when normalizing URLs during queue processing.
- [ ] 2.3 Add validation to `ScraperService` or `PipelineManager` (or `WebScraperStrategy` initialization) to ensure that if `preserveHashes` is true, the `scrapeMode` is not explicitly set to `fetch` (throw a validation error or warn and upgrade to `playwright`).

## 3. Playwright Middleware Fixes

- [ ] 3.1 Modify `HtmlPlaywrightMiddleware.ts` to correctly match intercepted requests. Change `if (reqUrl === context.source)` to compare `reqUrl` against the hash-stripped version of `context.source` (e.g., `reqUrl === new URL(context.source).origin + new URL(context.source).pathname + new URL(context.source).search`).
- [ ] 3.2 Add or update tests in `HtmlPlaywrightMiddleware.test.ts` to verify the interceptor works properly with URLs containing hash routes.

## 4. Documentation & Final Testing

- [ ] 4.1 Write tests in `WebScraperStrategy.test.ts` to verify that setting `preserveHashes` queues URLs with varying hashes as distinct documents.
- [ ] 4.2 Document the `--preserve-hashes` flag and its specific use case (Hash-routed SPAs) in `README.md`.
- [ ] 4.3 Update `docs/setup/configuration.md` and related docs to explain the `preserveHashes` config option.
