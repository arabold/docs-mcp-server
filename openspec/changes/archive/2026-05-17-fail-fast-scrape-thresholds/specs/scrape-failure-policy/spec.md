## ADDED Requirements

### Requirement: Bounded HTTP Fetch Retries
The scraper SHALL default HTTP fetch retries to 3 retries per page request, in addition to the initial attempt.

#### Scenario: Default retry budget uses four total attempts
- **WHEN** an HTTP page fetch repeatedly fails with a retryable error and no per-request override is provided
- **THEN** the fetcher SHALL stop after the initial attempt plus 3 retries

#### Scenario: Permanent HTTP failures do not use retry budget
- **WHEN** an HTTP page fetch fails with a non-retryable permanent error
- **THEN** the fetcher SHALL fail the page without consuming additional retries

### Requirement: Root Page Failures Abort Immediately
The scraper SHALL fail the scrape job immediately when the root page cannot be processed successfully during a normal scrape. During refresh, a tracked root page that returns `NOT_FOUND` SHALL be treated as a deletion instead of a hard failure.

#### Scenario: Root page fetch failure aborts the job
- **WHEN** the initial root page fails during fetch or processing
- **THEN** the scrape job SHALL terminate with an error

#### Scenario: Root page failure bypasses child failure threshold logic
- **WHEN** the initial root page fails before any child pages are attempted
- **THEN** the scraper SHALL abort immediately rather than evaluating the child-page failure threshold

#### Scenario: Root page not found during refresh is treated as deletion
- **WHEN** a refresh crawl re-processes a tracked root page and that page returns `NOT_FOUND`
- **THEN** the scraper SHALL report the root page as deleted
- **AND** the scrape SHALL continue applying refresh deletion handling instead of failing the job

### Requirement: Child Page Failure Rate Aborts Unhealthy Targets
The scraper SHALL track completed child-page attempts and terminal child-page failures, and SHALL abort the crawl when, after a minimum evaluation sample of 10 completed child-page attempts has been reached, the observed child-page failure rate exceeds the configured threshold. Completed child-page attempts SHALL include successful child-page completions and terminal child-page failures, and SHALL exclude refresh deletions and in-flight attempts.

#### Scenario: Isolated child-page failures do not abort before minimum sample
- **WHEN** a crawl encounters child-page failures before 10 completed child-page attempts have been reached
- **THEN** the scraper SHALL continue crawling using normal `ignoreErrors` behavior

#### Scenario: Failure rate above threshold aborts the crawl
- **WHEN** 10 completed child-page attempts have been reached and the observed child-page failure rate exceeds the configured threshold
- **THEN** the scraper SHALL terminate the crawl with an error indicating that the target exceeded the allowed failure rate

#### Scenario: Failure rate at or below threshold continues the crawl
- **WHEN** 10 completed child-page attempts have been reached and the observed child-page failure rate is at or below the configured threshold
- **THEN** the scraper SHALL continue crawling remaining in-scope pages

### Requirement: Refresh Deletions Do Not Count As Failures
The scraper SHALL exclude expected page deletions detected during refresh from child-page failure-rate accounting.

#### Scenario: Refresh deletion does not increase failure rate
- **WHEN** a refresh crawl encounters a child page that returns `NOT_FOUND`
- **THEN** the scraper SHALL mark the page as deleted without incrementing the child-page failure counter

#### Scenario: Refresh cleanup alone cannot trip the threshold
- **WHEN** a refresh crawl processes multiple deleted child pages and no terminal child-page processing failures occur
- **THEN** the scraper SHALL not abort due to the child-page failure threshold

#### Scenario: Non-refresh not found counts as a terminal page failure
- **WHEN** a normal crawl encounters a non-root page that returns `NOT_FOUND`
- **THEN** the scraper SHALL treat that page as a terminal page failure for failure-rate accounting
- **AND** the page SHALL not be treated as a refresh deletion
