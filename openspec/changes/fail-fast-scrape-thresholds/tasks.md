## 1. Configuration Defaults

- [x] 1.1 Update the scraper default configuration to set `scraper.fetcher.maxRetries` to `3`.
- [x] 1.2 Extend the scraper config schema and typing to support `scraper.abortOnFailureRate`.
- [x] 1.3 Add or update configuration tests for the new default retry count and `scraper.abortOnFailureRate` override behavior.

## 2. Crawl Failure Policy

- [x] 2.1 Add child-page attempt and failure counters to `BaseScraperStrategy` without changing root-page failure semantics.
- [x] 2.2 Implement the internal minimum sample-size check before evaluating the child-page failure-rate threshold.
- [x] 2.3 Abort the crawl with a scraper error when the configured child-page failure rate is exceeded.
- [x] 2.4 Exclude refresh deletions (`FetchStatus.NOT_FOUND`) from child-page failure-rate accounting.

## 3. Retry Behavior

- [x] 3.1 Update `HttpFetcher`-level tests to verify the new default retry budget and retained permanent-failure behavior.
- [x] 3.2 Ensure per-request retry overrides still work independently of the new default.

## 4. Strategy and Tool Integration

- [x] 4.1 Ensure the new threshold applies during normal scrape jobs even when `ignoreErrors` remains enabled for isolated child-page failures.
- [x] 4.2 Verify scrape progress and terminal error behavior remain correct when the threshold aborts a crawl.

## 5. Verification

- [x] 5.1 Add strategy tests covering root-page fail-fast behavior, below-threshold continuation, above-threshold aborts, and refresh deletion exclusions.
- [x] 5.2 Run targeted tests for config, fetcher, and scraper strategy behavior.
- [x] 5.3 Run the project lint and typecheck commands and address any failures.
