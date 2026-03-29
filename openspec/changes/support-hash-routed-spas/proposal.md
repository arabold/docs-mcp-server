## Why

Currently, when scraping hash-routed Single Page Applications (SPAs) like `docs.xyops.io`, the scraper collapses all internal documentation pages into a single root page. This occurs because the `normalizeUrl` utility aggressively strips hash fragments by default, which is correct for traditional websites with anchor links but breaks navigation discovery for hash-routed SPAs. To support indexing these SPAs without relying on unpredictable heuristics or breaking existing behavior for traditional sites, we need an explicit, predictable opt-in mechanism to preserve hash routes during crawling.

## What Changes

- Add a new explicit configuration option (e.g., `--preserve-hashes` via CLI or `preserveHashes` in scraper config) to disable hash stripping during URL normalization for web crawling.
- When enabled, `normalizeUrl` within the web scraping strategy will retain URL hash fragments, treating them as distinct crawler identities.
- Enforce or strongly warn that the `playwright` (or `auto`) scrape mode must be used when preserving hashes, as the `fetch` mode cannot evaluate client-side hash routes.
- Update `HtmlPlaywrightMiddleware` to correctly handle page interception when hash fragments are present in the source URL, ensuring the SPA can boot up and navigate to the requested hash route.

## Capabilities

### New Capabilities
- `hash-routed-spa-support`: Explicit configuration and middleware handling to accurately crawl, deduplicate, and render hash-routed Single Page Applications.

### Modified Capabilities
- (None)

## Impact

- **CLI/Config**: Introduces a new `--preserve-hashes` argument to scraper commands and a `preserveHashes` boolean property to the internal scraper configuration.
- **WebScraperStrategy**: Updates how URL normalization is invoked, explicitly passing `removeHash: false` when the feature is enabled.
- **HtmlPlaywrightMiddleware**: Updates request interception logic (`reqUrl === context.source`) to account for browsers stripping hash fragments from network requests.
- **Documentation**: Requires updates to `README.md` and configuration docs explaining how to index hash-routed SPAs.
- **Backwards Compatibility**: No impact on default behavior. Traditional sites and existing crawls remain unaffected.
