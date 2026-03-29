## ADDED Requirements

### Requirement: Explicit Hash Route Preservation
The system SHALL provide a configuration option and CLI flag (`--preserve-hashes` / `preserveHashes`) and SHALL expose the same capability through the MCP `scrape_docs` tool to disable the stripping of hash fragments from URLs during web crawling. This allows Single Page Applications (SPAs) that utilize hash-based client-side routing to be correctly identified, queued, and indexed as distinct pages.

#### Scenario: User enables hash preservation for an SPA
- **WHEN** the user provides the `--preserve-hashes` CLI flag or enables `preserveHashes` in the configuration
- **THEN** the scraper's URL normalization step SHALL NOT strip the `#` fragment from discovered URLs, queuing each hash route as a separate entity

#### Scenario: MCP client enables hash preservation for an SPA
- **WHEN** an MCP client calls `scrape_docs` with `preserveHashes: true`
- **THEN** the MCP tool SHALL pass `preserveHashes: true` through to the scraping pipeline as part of the `ScraperOptions`

### Requirement: Playwright Rendering for Hash Routes
The system SHALL enforce the use of `playwright` rendering when `preserveHashes` is enabled, because the `fetch` mode cannot evaluate client-side hash routing.

#### Scenario: User attempts to use fetch mode with preserve hashes
- **WHEN** `preserveHashes` is true AND `scrapeMode` is explicitly set to `fetch`
- **THEN** the system SHALL upgrade the effective scrape mode to `playwright` and SHALL log a warning that `fetch` mode is incompatible with preserved hash routes

### Requirement: Accurate Page Interception in Playwright
When `preserveHashes` is enabled and Playwright intercepts the initial page load, it SHALL fulfill the request using the pre-fetched content, successfully matching the `reqUrl` (which lacks the hash fragment due to browser networking rules) against the base path of the original `context.source`.

#### Scenario: Playwright intercepts a hash-routed URL
- **WHEN** `HtmlPlaywrightMiddleware` intercepts a request for a URL that originally contained a hash (e.g., `http://example.com/#/docs`)
- **THEN** it SHALL successfully fulfill the `http://example.com/` request with the pre-fetched content, allowing the SPA to boot and the client-side router to evaluate the `#/docs` fragment

### Requirement: Hash-Aware Crawl Identity
When `preserveHashes` is enabled, the system SHALL preserve hash fragments in crawl identity at the queue and deduplication layer so that hash-routed pages are discovered, queued, refreshed, and stored as distinct pages.

#### Scenario: Distinct hash routes are queued separately
- **WHEN** the crawler discovers `https://example.com/#/guide` and `https://example.com/#/api` during the same job with `preserveHashes` enabled
- **THEN** the queue and `visited` deduplication logic SHALL treat them as distinct URLs and SHALL process both pages

#### Scenario: Refresh preserves existing hash-routed pages
- **WHEN** a version was originally scraped with `preserveHashes: true` and a refresh job is enqueued without changing that option
- **THEN** the refresh job SHALL reuse the stored `preserveHashes: true` setting and SHALL rebuild its `initialQueue` without collapsing stored hash-routed page URLs

### Requirement: Web UI Configuration
The system SHALL expose the `preserveHashes` option in the Web UI, allowing users to explicitly enable it when adding a new library or refreshing an existing one.

#### Scenario: User configures hash preservation via Web UI
- **WHEN** the user checks the "Preserve Hash Routes" option in the Web UI and submits the form
- **THEN** the `preserveHashes` setting SHALL be passed to the scraping pipeline as part of the `ScraperOptions`
