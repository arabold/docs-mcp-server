## Why

The scraper currently combines a high default HTTP retry count with a crawl policy that ignores non-root page failures by default, which can make unhealthy targets look more successful than they are and waste time on permanently broken sites. We need a simpler fail-fast policy so scrape jobs stop earlier when a target is broadly unhealthy while still tolerating a small number of transient page failures.

## What Changes

- Reduce the default HTTP fetch retry count from 6 retries to 3 retries.
- Add a target-level scrape failure-rate threshold that aborts a crawl when too many child pages fail after a minimum number of attempted pages.
- Keep root page failures as immediate job failures.
- Exclude expected refresh deletions (`404`/`NOT_FOUND`) from the failure-rate threshold so refresh cleanup does not trip the breaker.
- Surface the new threshold through configuration with a default `scraper.abortOnFailureRate` of `0.5`.
- Add specification scenarios covering retry defaults, threshold evaluation, ignored deletion cases, and root-page fail-fast behavior.

## Capabilities

### New Capabilities
- `scrape-failure-policy`: Defines retry defaults and fail-fast target abort behavior for unhealthy scrape targets.

### Modified Capabilities
- `configuration`: Add configuration support for the scrape failure-rate threshold and updated default fetch retry count.

## Impact

- Affected code: `src/utils/config.ts`, `src/scraper/fetcher/HttpFetcher.ts`, `src/scraper/strategies/BaseScraperStrategy.ts`, `src/tools/ScrapeTool.ts`, and related tests.
- Affected behavior: scrape jobs will stop earlier on broadly failing targets and will spend less time retrying transient fetch failures.
- Affected interfaces: configuration defaults and config schema for scraper settings.
