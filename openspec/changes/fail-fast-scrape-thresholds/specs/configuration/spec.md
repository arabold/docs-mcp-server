## ADDED Requirements

### Requirement: Scrape Failure Rate Threshold Configuration
The configuration system SHALL expose `scraper.abortOnFailureRate` as the child-page failure-rate threshold used to abort unhealthy scrape targets. The value SHALL be a floating-point fraction in the inclusive range `[0.0, 1.0]`, where `0.0` means any completed child-page failure above the minimum sample triggers an abort and `1.0` means the scraper never aborts based on failure rate alone.

#### Scenario: Config file sets scrape failure rate threshold
- **WHEN** the configuration file sets `scraper.abortOnFailureRate` to a numeric value in the inclusive range `[0.0, 1.0]`
- **THEN** the scraper SHALL interpret that value as the maximum allowed fraction of terminally failed child pages among completed child-page attempts

#### Scenario: Environment variable overrides scrape failure rate threshold
- **WHEN** the environment variable `DOCS_MCP_SCRAPER_ABORT_ON_FAILURE_RATE` is set
- **THEN** the environment variable value SHALL override config file and default values for `scraper.abortOnFailureRate`

#### Scenario: Default scrape failure rate threshold is one half
- **WHEN** no explicit configuration for `scraper.abortOnFailureRate` is provided
- **THEN** the loaded configuration SHALL set `scraper.abortOnFailureRate` to `0.5`

### Requirement: Updated Default HTTP Retry Configuration
The configuration system SHALL default `scraper.fetcher.maxRetries` to `3`.

#### Scenario: Default fetch retry count is three
- **WHEN** no explicit configuration for `scraper.fetcher.maxRetries` is provided
- **THEN** the loaded configuration SHALL set `scraper.fetcher.maxRetries` to `3`

#### Scenario: Explicit fetch retry override still wins
- **WHEN** the user provides an explicit value for `scraper.fetcher.maxRetries`
- **THEN** the loaded configuration SHALL use the explicit value instead of the default
