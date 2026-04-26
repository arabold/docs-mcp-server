## Why

Currently, when scraping hash-routed Single Page Applications (SPAs) like `docs.xyops.io`, the scraper collapses all internal documentation pages into a single root page. This occurs because the `normalizeUrl` utility aggressively strips hash fragments by default, which is correct for traditional websites with anchor links but breaks navigation discovery for hash-routed SPAs. To support indexing these SPAs without relying on unpredictable heuristics or breaking existing behavior for traditional sites, we need an explicit, predictable opt-in mechanism to preserve hash routes during crawling.

## What Changes

- Add a new explicit configuration option (e.g., `--preserve-hashes` via CLI, `preserveHashes` in scraper config, and a `preserveHashes` field in MCP `scrape_docs`) to disable hash stripping during URL normalization for web crawling.
- When enabled, `normalizeUrl` within the web scraping strategy will retain URL hash fragments, treating them as distinct crawler identities.
- Require `preserveHashes` to run with `playwright`-compatible scraping by upgrading `scrapeMode=fetch` to `playwright` in a consistent way across CLI, Web UI, and MCP.
- Update `HtmlPlaywrightMiddleware` to correctly handle page interception when hash fragments are present in the source URL, ensuring the SPA can boot up and navigate to the requested hash route.
- Expose the `preserveHashes` option in the Web UI so users can enable it when adding or refreshing a library via the browser.
- Expose the `preserveHashes` option through the MCP `scrape_docs` tool so non-CLI clients can request hash-routed SPA crawling as well.
- Ensure refresh operations persist and reuse the `preserveHashes` setting so re-indexing an existing version behaves the same as the original scrape unless the user explicitly changes it.

## Capabilities

### New Capabilities
- `hash-routed-spa-support`: Explicit configuration and middleware handling to accurately crawl, deduplicate, and render hash-routed Single Page Applications.

### Modified Capabilities
- (None)

## Impact

- **CLI/Config/MCP**: Introduces a new `--preserve-hashes` argument to scraper commands, a `preserveHashes` boolean property to the internal scraper configuration, and a matching field on the MCP `scrape_docs` tool.
- **WebScraperStrategy**: Updates how URL normalization is invoked, explicitly passing `removeHash: false` when the feature is enabled.
- **BaseScraperStrategy**: Updates crawl queue identity and visited-set deduplication so preserved hashes affect discovery, queuing, and refresh initial queues.
- **HtmlPlaywrightMiddleware**: Updates request interception logic (`reqUrl === context.source`) to account for browsers stripping hash fragments from network requests.
- **Web UI**: Updates the add and refresh library components and their respective route handlers to expose and process the new toggle.
- **Documentation**: Requires updates to `README.md` and configuration docs explaining how to index hash-routed SPAs.
- **Backwards Compatibility**: No impact on default behavior. Traditional sites and existing crawls remain unaffected.
