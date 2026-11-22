# Spec Delta

## Purpose

Records every page-level error a scrape run encounters and shows it with the version it belongs to. A user can then see why pages failed, including why a run aborted, without reading server logs.

## ADDED Requirements

### Requirement: Every Page Error Of A Run Is Recorded

A scrape run SHALL record one error entry for each page that fails during the run. Each entry SHALL carry the page URL, the crawl depth, the error message, the time it occurred, and exactly one category from: **not found**, **HTTP error**, **bot challenge**, **TLS certificate**, **access policy**, **timeout**, **network**, **extraction**, **indexing**, **other**. An entry SHALL carry the HTTP status code whenever the server answered with one.

The following SHALL be recorded:
- a fetch that fails for any reason
- a page not found, except a refresh deletion
- a page whose content extraction raised errors and produced no content
- a page whose content could not be stored or indexed

The following SHALL NOT be recorded, because they are not errors:
- refresh deletions
- resources skipped as unprocessable
- unchanged pages
- pages that extracted cleanly to empty content

Recording SHALL NOT depend on `ignoreErrors`. It SHALL NOT depend on whether the error counts toward `scraper.abortOnFailureRate`. The error of the page that pushes the failure rate past the threshold SHALL be recorded before the run aborts. Recording an error SHALL NOT change the failure-rate accounting or any progress counter.

#### Scenario: A page not found during a normal crawl is recorded
- **WHEN** a normal crawl fetches a child page that answers `404`
- **THEN** the run's history contains an entry for that URL with category **not found** and status `404`

#### Scenario: A blocked page is recorded with its status
- **WHEN** a child page answers `403` and the fetch fails
- **THEN** the run's history contains an entry for that URL with category **HTTP error** and status `403`

#### Scenario: The page that aborts the run is recorded
- **GIVEN** `scraper.abortOnFailureRate` is `0.5`
- **AND** a crawl in which most child pages answer `404`
- **WHEN** the run aborts because the failure rate exceeds the threshold
- **THEN** the history contains an entry for every failed page counted in the abort message, including the page whose failure crossed the threshold

#### Scenario: An error that does not count toward the failure rate is still recorded
- **WHEN** a URL taken from an llms.txt index answers `404`
- **THEN** the history contains an entry for that URL
- **AND** the failure rate is unchanged

#### Scenario: Refresh deletions and skipped content are not recorded
- **GIVEN** a refresh in which one stored page now answers `404` and one discovered link serves an unprocessable content type
- **WHEN** the refresh completes
- **THEN** the history contains no entry for either URL

#### Scenario: Extraction failure is recorded and a clean empty page is not
- **GIVEN** one page whose content extraction raises an error and yields no content
- **AND** another page that extracts cleanly and yields no content
- **WHEN** the run completes
- **THEN** the history contains an entry with category **extraction** for the first page only

#### Scenario: Indexing failure is recorded
- **WHEN** a page's content is fetched and extracted but cannot be indexed, for example because the embedding provider rejects it
- **THEN** the history contains an entry for that URL with category **indexing**

### Requirement: History Belongs To The Version's Latest Run

The recorded history SHALL belong to the library version that was scraped, and SHALL describe only that version's most recent run. Starting a new run for the version, whether a scrape or a refresh, SHALL discard the previous history before any page is processed. Removing the version SHALL remove its history. The history SHALL survive a server restart. Once a run ends, whether it completed, failed or was cancelled, its history SHALL stay unchanged until the version's next run starts.

#### Scenario: A new run replaces the previous history
- **GIVEN** a version whose last run recorded errors
- **WHEN** a new scrape or refresh of that version starts
- **THEN** the history is empty until the new run records its own errors

#### Scenario: History of other versions is untouched
- **WHEN** a run starts for one version of a library
- **THEN** the history of every other version is unchanged

#### Scenario: Removing a version removes its history
- **WHEN** a version is removed
- **THEN** no history for it remains

#### Scenario: History survives a restart
- **GIVEN** a version whose last run failed with recorded errors
- **WHEN** the server restarts
- **THEN** the same history is available for that version

### Requirement: History Is Available As A Summary And As A Full List

The system SHALL provide, for any version, a summary of its history and a paged list of every entry.

The summary SHALL report:
- the total number of entries
- one group per distinct pair of category and HTTP status
- for each group, its entry count and a bounded number of sample URLs

Groups SHALL be ordered by entry count, largest first.

The list SHALL return entries in the order they were recorded, together with the total entry count, so a caller can page through all of them.

A version with no recorded errors SHALL yield an empty summary and an empty list, not an error.

#### Scenario: Summary groups errors by category and status
- **GIVEN** a run that recorded 83 entries with status `404` and 4 entries with status `403`
- **WHEN** the summary is requested
- **THEN** it reports a total of 87
- **AND** a **not found** / `404` group with count 83 listed before an **HTTP error** / `403` group with count 4
- **AND** each group carries sample URLs from its own entries only

#### Scenario: The list pages through every entry
- **GIVEN** a run that recorded more entries than one page holds
- **WHEN** the list is requested page by page
- **THEN** every entry is returned exactly once, in recording order

#### Scenario: A version without errors
- **WHEN** the summary or the list is requested for a version whose latest run recorded nothing
- **THEN** the result is empty

### Requirement: Web UI Shows The Error Summary

The web interface SHALL show the history summary wherever it reports the outcome of a version's latest run:
- A failed job SHALL show the summary together with its error message, unless a newer run of the same version has since started.
- The library detail view SHALL show the summary for a version whose latest run failed or completed with recorded errors, and SHALL let the user expand it to the full list.
- When the latest run recorded no errors, no error summary SHALL be shown.

Each group SHALL be shown with its category, its HTTP status when present, its count and its sample URLs. A long URL SHALL wrap within the view rather than overflow it.

#### Scenario: A failed job explains its failures
- **GIVEN** a job that aborted after child pages returned `404`
- **WHEN** the user views the job list
- **THEN** the failed job shows its error message followed by a `404` group with its count and sample URLs

#### Scenario: A completed run with errors is visible
- **GIVEN** a version whose latest run completed while some pages failed
- **WHEN** the user opens that version in the library detail view
- **THEN** the view shows the error summary
- **AND** the user can expand it to see every recorded entry

#### Scenario: A superseded failed job does not borrow the newer run's history
- **GIVEN** a failed job for a version that has since been scraped again
- **WHEN** the user views the job list
- **THEN** the old failed job shows its error message without an error summary
