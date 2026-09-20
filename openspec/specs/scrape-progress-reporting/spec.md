# scrape-progress-reporting Specification

## Purpose
Defines the four counters a scrape job reports and the invariant relating them, so a progress fraction converges on 100% for a crawl that finished and stays short for one that did not, and so each dequeued item is accounted for exactly once under a named outcome.

## Requirements

### Requirement: Progress counter definitions

A scrape job SHALL report four counters, each with a distinct meaning:

- `totalDiscovered` — the number of distinct URLs admitted to the crawl queue over the life of the job, unbounded by `maxPages`.
- `totalPages` — the number of items the job expects to process: the number of distinct URLs admitted to the crawl queue, clamped at the point where the crawl will stop. This is the denominator of the progress fraction. It is **not** the configured `maxPages` value.
- `pagesScraped` — the number of queued items that have been dequeued and reached an outcome. This is the numerator of the progress fraction.
- `pagesIndexed` — the number of processed items that produced stored content. This is **not** part of the progress fraction.

#### Scenario: Denominator is not the configured limit
- **GIVEN** a scrape configured with `maxPages: 1000`
- **AND** the crawl discovers and queues 320 URLs in total
- **WHEN** the crawl completes
- **THEN** `totalPages` is 320
- **AND** `totalPages` is not 1000

#### Scenario: Discovery exceeds the clamp
- **GIVEN** a scrape configured with `maxPages: 1000`
- **AND** the crawl admits 2158 distinct URLs to the queue
- **WHEN** progress is reported
- **THEN** `totalDiscovered` is 2158
- **AND** `totalPages` is 1000

#### Scenario: Indexed is a subset of processed
- **GIVEN** a crawl in which some pages return 404 and some resources are skipped as unprocessable
- **WHEN** the crawl completes
- **THEN** `pagesIndexed` is less than or equal to `pagesScraped`
- **AND** `pagesIndexed` counts only items that produced stored content

### Requirement: Progress invariant

`pagesScraped` SHALL equal `totalPages` when a crawl terminates having drained its queue, and SHALL equal the effective `maxPages` when a crawl terminates because that limit was reached. `pagesScraped` SHALL NOT exceed `totalPages` at any point.

Every item admitted to the queue SHALL eventually be dequeued and reach exactly one outcome, and each such outcome SHALL advance `pagesScraped` by exactly one. No queued item may be discarded without being counted.

`totalPages` SHALL be computed as `min(urlsEnqueued, maxPages + processedWithoutContent)`, where `processedWithoutContent` is the number of items processed so far that did not produce stored content. The clamp SHALL be applied when the counter is initialised as well as when it is incremented, so that an initial queue larger than the limit cannot produce a denominator the numerator can never reach.

The invariant applies to normal termination only. A crawl ended by cancellation, by the child-page failure-rate abort, or by an error raised at depth 0 SHALL terminate with `pagesScraped` below `totalPages`, and SHALL NOT be adjusted to appear complete.

#### Scenario: Completed crawl reaches its denominator
- **GIVEN** a crawl that queues 320 URLs and exhausts the queue
- **WHEN** the crawl completes
- **THEN** `pagesScraped` is 320
- **AND** `totalPages` is 320
- **AND** the reported progress percentage is 100

#### Scenario: Crawl halted by maxPages
- **GIVEN** a scrape configured with `maxPages: 50`
- **AND** a site with more than 50 reachable pages
- **AND** 6 dequeued items that produce no stored content
- **WHEN** the crawl halts on the limit
- **THEN** `pagesIndexed` is 50
- **AND** `pagesScraped` is 56
- **AND** `totalPages` is 56
- **AND** `totalDiscovered` is greater than 56

#### Scenario: Progress never exceeds its denominator
- **WHEN** any progress event is emitted during any crawl
- **THEN** `pagesScraped` is less than or equal to `totalPages`

#### Scenario: Initial queue larger than the page limit
- **GIVEN** a refresh whose initial queue contains 1500 stored pages
- **AND** an effective `maxPages` of 1000
- **AND** every processed item produces stored content
- **WHEN** the crawl runs to the limit
- **THEN** `totalPages` is 1000, not 1500
- **AND** `pagesScraped` reaches 1000
- **AND** the reported progress percentage is 100

#### Scenario: Cancelled crawl does not claim completion
- **GIVEN** a crawl cancelled partway through
- **WHEN** the job terminates
- **THEN** `pagesScraped` is less than `totalPages`
- **AND** neither counter is adjusted to make the fraction appear complete

### Requirement: Outcomes that advance the processed count

Each of the following outcomes SHALL advance `pagesScraped` by exactly one: content was stored; the resource was unchanged (`304`); the resource was absent (`404`); the resource was skipped as unprocessable; processing failed and the error was ignored under `ignoreErrors`. Only the first of these SHALL advance `pagesIndexed`.

Items that yield links without content — such as directory listings during local-file crawling — SHALL advance `pagesScraped` and SHALL NOT advance `pagesIndexed`.

#### Scenario: Stored content advances both counters
- **WHEN** a page is fetched and its pipeline produces content
- **THEN** `pagesScraped` increases by one
- **AND** `pagesIndexed` increases by one

#### Scenario: Not-modified advances only the processed count
- **GIVEN** a refresh operation for a page with a stored ETag
- **WHEN** the server responds `304 Not Modified`
- **THEN** `pagesScraped` increases by one
- **AND** `pagesIndexed` does not increase

#### Scenario: Not-found advances only the processed count
- **WHEN** a queued URL responds `404 Not Found`
- **THEN** `pagesScraped` increases by one
- **AND** `pagesIndexed` does not increase

#### Scenario: Skipped content advances only the processed count
- **WHEN** a queued resource is skipped because no pipeline can process its content type
- **THEN** `pagesScraped` increases by one
- **AND** `pagesIndexed` does not increase

#### Scenario: Ignored failure advances only the processed count
- **GIVEN** `ignoreErrors` is enabled
- **WHEN** a child page fails to fetch and the error is ignored
- **THEN** `pagesScraped` increases by one
- **AND** `pagesIndexed` does not increase

#### Scenario: Directory item advances only the processed count
- **GIVEN** a local-file crawl of a directory containing three files
- **WHEN** the crawl completes
- **THEN** the directory item and all three files advance `pagesScraped`, giving 4
- **AND** only the three files advance `pagesIndexed`, giving 3
- **AND** `totalPages` is 4, so the progress fraction reads 4 of 4

### Requirement: Counters move at defined points

`totalDiscovered` and `totalPages` SHALL advance when a URL is admitted to the queue, after all discovered-link filters have passed. `pagesScraped` and `pagesIndexed` SHALL advance when a dequeued item reaches its outcome. No counter SHALL advance for a URL rejected by a discovered-link filter.

#### Scenario: Filtered links never reach any counter
- **WHEN** a discovered link is rejected by the scope, pattern, archive-extension, unprocessable-extension, or depth filter
- **THEN** no counter advances for that link

#### Scenario: Queue admission advances the totals
- **WHEN** a discovered link passes every filter and is added to the queue
- **THEN** `totalDiscovered` increases by one
- **AND** `totalPages` increases by one unless it has already reached the effective `maxPages`

### Requirement: Progress reporting is documented accurately in code

The TSDoc for each counter on `ScraperProgressEvent` SHALL state the meaning defined by this specification. Field names and documentation in the layers that carry these values onward — the pipeline job record, the persisted progress columns, the MCP job tools, and telemetry — SHALL NOT describe a queue-derived count as a configured limit.

#### Scenario: Denominator TSDoc matches behaviour
- **WHEN** the TSDoc for `ScraperProgressEvent.totalPages` is read
- **THEN** it describes URLs admitted to the queue, clamped at `maxPages`
- **AND** it does not describe the configured `maxPages` option

#### Scenario: Telemetry reports configuration, not discovery
- **WHEN** telemetry reports a configured page limit for a scrape job
- **THEN** the reported value is the resolved `maxPages` configuration value
- **AND** it is not derived from any progress counter

### Requirement: The reported counters are persisted

`pagesScraped`, `totalPages` and `pagesIndexed` SHALL be persisted on the job
record so that their values survive a process restart and remain available after
a job completes. None of the three SHALL be live-only, and none SHALL have its
post-completion value reconstructed from a different source with its own
definition.

`totalDiscovered` is deliberately not persisted. It describes work the crawl
declined to queue rather than work it did, and it is only distinguishable from
`totalPages` while a limit is clamping an in-flight crawl. A restarted job
re-derives it from its own run.

Rows written before the content-producing counter existed SHALL carry a null value for it, not zero, and consumers SHALL render null as unknown. A caller that omits the value SHALL leave any stored value untouched rather than clearing it.

#### Scenario: Counters survive a restart
- **GIVEN** a completed scrape job
- **WHEN** the process restarts and the job record is read back
- **THEN** `pagesScraped`, `totalPages` and `pagesIndexed` report the values they held at completion

#### Scenario: Omitting the indexed count preserves it
- **GIVEN** a stored job record carrying a content-producing count
- **WHEN** a progress update is written without that value
- **THEN** the stored value is unchanged

#### Scenario: Historical rows report unknown, not zero
- **GIVEN** a job record written by a release prior to this change
- **WHEN** the record is read
- **THEN** the content-producing counter is null
- **AND** consumers render it as unknown rather than as zero

#### Scenario: Re-indexing populates the historical row
- **GIVEN** a library version whose stored job record predates this change
- **WHEN** the version is scraped or refreshed again
- **THEN** the record is written with its persisted counters populated
- **AND** the content-producing counter no longer reads as unknown

### Requirement: The page limit bounds indexed pages

The effective `maxPages` SHALL bound `pagesIndexed`, not `pagesScraped`. A crawl SHALL continue while its queue is non-empty and fewer than `maxPages` pages have produced stored content. Items that are processed without producing content — unchanged pages, deleted pages, resources skipped as unprocessable, directory listings, and ignored failures — SHALL NOT consume the budget.

`pagesIndexed` SHALL NOT exceed `maxPages`.

#### Scenario: Limit delivers the requested number of pages
- **GIVEN** a crawl configured with `maxPages: 100`
- **AND** a site where 30 of the dequeued items produce no stored content
- **WHEN** the crawl halts on the limit
- **THEN** `pagesIndexed` is 100
- **AND** `pagesScraped` is 130
- **AND** `totalPages` is 130, so the reported progress percentage is 100

#### Scenario: Non-content outcomes do not shorten the crawl
- **GIVEN** a crawl configured with `maxPages: 100`
- **WHEN** a dequeued resource is skipped as unprocessable
- **THEN** the remaining budget is unchanged
- **AND** the crawl continues until 100 pages have produced stored content or the queue is exhausted

#### Scenario: Queue exhausted before the limit
- **GIVEN** a crawl configured with `maxPages: 100`
- **AND** a site with only 50 reachable in-scope URLs
- **WHEN** the queue is exhausted
- **THEN** `pagesScraped` is 50
- **AND** `totalPages` is 50
- **AND** the reported progress percentage is 100

#### Scenario: Indexed count never exceeds the limit
- **WHEN** any crawl terminates
- **THEN** `pagesIndexed` is less than or equal to the effective `maxPages`

### Requirement: Every outcome emits a progress event naming that outcome

Each dequeued item SHALL emit exactly one progress event when it reaches its outcome, including outcomes that produce no content, so that the processed count is observable rather than advancing silently.

Each event SHALL name its outcome explicitly. Consumers SHALL NOT infer the outcome from the absence of a result, because a null result alone cannot distinguish a page that is unchanged from a page that is now empty. The outcomes are: **stored**, **unchanged**, **absent**, **empty**, **skipped**, and **failed**. `pagesIndexed` counts exactly the **stored** outcome.

#### Scenario: Unchanged and empty are distinguishable
- **GIVEN** one page that responds `304 Not Modified`
- **AND** another page that responds `200` with no extractable content
- **WHEN** both emit progress events
- **THEN** the first names the outcome **unchanged**
- **AND** the second names the outcome **empty**
- **AND** the two events are distinguishable without inspecting the result field

#### Scenario: Directory item emits an event
- **GIVEN** a local-file crawl encountering a directory that yields links but no content
- **WHEN** the directory item reaches its outcome
- **THEN** a progress event is emitted naming the outcome **empty**
- **AND** `pagesScraped` advances
- **AND** `pagesIndexed` does not advance

#### Scenario: Unprocessable resource emits an event
- **WHEN** a queued resource is skipped because no pipeline can process its content type
- **THEN** a progress event is emitted naming the outcome **skipped**
- **AND** `pagesScraped` advances

#### Scenario: Ignored failure emits an event
- **GIVEN** `ignoreErrors` is enabled
- **WHEN** a child page fails and the error is ignored
- **THEN** a progress event is emitted naming the outcome **failed**
- **AND** `pagesScraped` advances

### Requirement: An empty page is stored as empty unless the pipeline failed

When a resource is fetched successfully, its pipeline runs without error, and the result contains no extractable content, the system SHALL record the page as existing with no content. Any previously stored content for that page SHALL be replaced, and the response's `etag` and `last_modified` SHALL be stored, because the response is an accurate statement that the page is empty.

When the pipeline reports errors and produces no content, the system SHALL leave any previously stored content for that page unchanged and SHALL NOT store the response's `etag`. The page therefore keeps the validator from its last successful extraction, and the next refresh is conditional on that one rather than on the failed response's. Because the resource has moved on from the validator being sent, the server answers with content instead of `304 Not Modified`, and the extraction is retried. Storing the failed response's validator would instead earn a `304` and never retry, making a transient extraction failure permanent.

#### Scenario: Page that became genuinely empty
- **GIVEN** a stored page with previously indexed content
- **AND** a refresh in which the page responds `200` and its pipeline runs without error but extracts no text
- **WHEN** the outcome is recorded
- **THEN** the page still exists in the index with no content
- **AND** its previous content is no longer searchable
- **AND** its `etag` is updated to the value from this response

#### Scenario: Extraction failure does not empty the page
- **GIVEN** a stored page with previously indexed content
- **AND** a refresh in which the page responds `200` but its pipeline reports an error and extracts no text
- **WHEN** the outcome is recorded
- **THEN** the previously stored content is left unchanged
- **AND** the `etag` is not updated

#### Scenario: A withheld etag causes a retry on the next refresh
- **GIVEN** a page whose `etag` was withheld after an extraction failure
- **WHEN** the next refresh runs
- **THEN** the request carries the validator from the last successful extraction, not the failed response's
- **AND** the server answers with content rather than `304 Not Modified`
- **AND** a successful extraction restores its content

#### Scenario: An empty page persists across refreshes cheaply
- **GIVEN** a page recorded as empty with a stored `etag`
- **WHEN** the next refresh runs and the server responds `304 Not Modified`
- **THEN** the page remains recorded as empty
- **AND** no content is written
