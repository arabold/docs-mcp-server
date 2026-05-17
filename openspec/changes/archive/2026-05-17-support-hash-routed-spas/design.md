## Context

Currently, the crawler's `normalizeUrl` utility removes URL hash fragments by default. This is correct for 99% of web crawling scenarios, as hashes usually indicate jump links (anchors) within the same page. However, for Single Page Applications (SPAs) that use hash-based routing (e.g., `docs.xyops.io/#Docs/api`), this behavior causes all internal links to collapse into the root URL, resulting in only the main shell being indexed.

Attempting to "guess" whether a site is a hash-routed SPA is unpredictable and risky. Therefore, an explicit opt-in mechanism is required to preserve hashes during crawling.

## Goals / Non-Goals

**Goals:**
- Provide a CLI flag (`--preserve-hashes`) and config option (`preserveHashes`) to disable hash stripping.
- Expose the same option consistently through MCP `scrape_docs` so external clients can request hash-routed scraping.
- Ensure URLs with hashes are treated as distinct documents in the database and crawler queue when the flag is enabled.
- Ensure `HtmlPlaywrightMiddleware` correctly intercepts and serves the initial page shell, even when the requested URL contains a hash fragment.
- Expose the `preserveHashes` setting in the Web UI for both adding and refreshing libraries.
- Ensure refresh jobs persist and reuse `preserveHashes`, while still allowing users to override stored scraper options through supported entrypoints.
- Enforce one consistent runtime behavior when `preserveHashes` is combined with `scrapeMode=fetch`, since pure `fetch` cannot execute client-side routing.

**Non-Goals:**
- Automatically detecting hash-routed SPAs.
- Changing the default behavior of `normalizeUrl`.
- Supporting hash routing in `fetch` scrape mode.

## Decisions

1. **Explicit Opt-in Flag (`preserveHashes`)**:
   - *Decision*: Add a `preserveHashes` boolean to `ScraperOptions` and expose it through every user-facing scrape entrypoint: CLI, Web UI, and MCP `scrape_docs`.
   - *Rationale*: Safe, predictable, and doesn't break the vast majority of sites that use traditional anchor links.
   - *Alternative Considered*: "Auto" detection based on DOM analysis or URL patterns (e.g., `#/`). Rejected because heuristics are brittle and often lead to false positives (indexing duplicate pages for normal anchor links).

2. **Middleware Interception Fix**:
   - *Decision*: In `HtmlPlaywrightMiddleware`, when checking if `reqUrl === context.source` for the initial page fulfill, strip the hash from `context.source` before comparison.
   - *Rationale*: Browsers (and thus Playwright's network stack) do not send hash fragments to the server. If `context.source` is `http://site/#/route`, the `reqUrl` intercepted by Playwright will be `http://site/`. We must compare the origin + pathname + search components to successfully fulfill the initial document request.

3. **Crawl Identity in Base Strategy**:
   - *Decision*: Apply `preserveHashes` to the shared crawl identity layer in `BaseScraperStrategy`, where root URL normalization, `visited` deduplication, and refresh `initialQueue` handling occur.
   - *Rationale*: `WebScraperStrategy.processItem()` is too late for queue identity. Preserving hashes only there would still allow `#/a` and `#/b` to collapse before processing.

4. **Scrape Mode Enforcement**:
   - *Decision*: If `preserveHashes` is enabled and `scrapeMode` is explicitly set to `fetch`, the system SHALL upgrade the job to `playwright` and log a warning consistently across CLI, Web UI, and MCP entrypoints.
   - *Rationale*: A pure HTTP fetch cannot resolve a hash route (the server just returns the empty SPA shell). Silent no-op behavior or entrypoint-specific validation errors would make the feature inconsistent.

5. **Refresh Propagation**:
   - *Decision*: Treat `preserveHashes` as stored scraper state for a version and ensure refresh jobs reuse it by default, while allowing explicit refresh entrypoints to override and persist the setting when changed.
   - *Rationale*: Refresh currently rebuilds jobs from stored scraper options. Without explicitly carrying `preserveHashes` through that path, a refresh toggle would be documented but ineffective.

6. **Web UI Integration**:
   - *Decision*: Expose a checkbox for "Preserve Hash Routes" in the Web UI.
   - *Rationale*: Users must be able to specify this option without resorting to the CLI. The checkbox state will be passed via the form submission to the API endpoints and onto the pipeline for both scrape and refresh flows.

7. **MCP Tool Integration**:
   - *Decision*: Add `preserveHashes` to the MCP `scrape_docs` input schema and pass it through `ScrapeTool` into the pipeline job options.
   - *Rationale*: MCP is a first-class public scraping interface. Omitting the option there would make the feature inconsistent and unavailable to automated clients that do not use the CLI or Web UI.

## Risks / Trade-offs

- **[Risk] User Confusion**: Users might enable `--preserve-hashes` on a traditional site, causing every anchor link to be indexed as a separate duplicate page.
  - *Mitigation*: Clearly document that this flag is exclusively for hash-routed SPAs.
- **[Risk] Playwright Interception Mismatch**: The updated URL comparison in `HtmlPlaywrightMiddleware` might inadvertently fulfill sub-resource requests if not scoped correctly.
  - *Mitigation*: Use strict URL parsing (e.g., `new URL(context.source)`) to ensure only the exact base path of the initial document is fulfilled from the pre-fetched content.
- **[Risk] Entry-point Drift**: One user-facing surface could expose different behavior or defaults than another.
  - *Mitigation*: Treat `preserveHashes` as a shared `ScraperOptions` field, add propagation tests for CLI, Web UI, and MCP, and document the same behavior in all interfaces.
- **[Risk] Refresh Drift**: A version could be scraped with preserved hashes but later refreshed without them, collapsing previously distinct pages.
  - *Mitigation*: Persist `preserveHashes` in stored scraper options, reuse it for refresh jobs, and add explicit override tests for refresh entrypoints.
