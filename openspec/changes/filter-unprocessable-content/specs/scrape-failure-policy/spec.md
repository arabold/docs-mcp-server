## ADDED Requirements

### Requirement: Skipped Content Does Not Count As Failure

A resource rejected by the queue-time or fetch-time unprocessable-content gates SHALL NOT be counted as a completed child-page attempt and SHALL NOT be counted as a failed child page. Skips SHALL therefore have no effect on the failure rate compared against `scraper.abortOnFailureRate`.

Without this exclusion, a site whose pages link predominantly to images would drive the observed failure rate past the threshold and abort a scrape in which every page that was read succeeded.

#### Scenario: Image-heavy site does not trip the failure threshold
- **GIVEN** `scraper.abortOnFailureRate` is at its default of 0.5
- **AND** a crawl in which 900 discovered resources are skipped as unprocessable and 100 pages are fetched successfully
- **WHEN** the failure rate is evaluated
- **THEN** the observed failure rate is 0
- **AND** the scrape continues

#### Scenario: Genuine failures still count alongside skips
- **GIVEN** a crawl in which resources are skipped as unprocessable
- **AND** child pages also fail with fetch errors
- **WHEN** the failure rate is evaluated
- **THEN** only the fetch errors contribute to both the numerator and the denominator
- **AND** the skips are absent from both

#### Scenario: Root URL skipped as unprocessable
- **GIVEN** a user supplies a start URL that responds with a content type no pipeline can process
- **WHEN** the depth-0 resource is skipped by the fetch-time gate
- **THEN** the scrape fails with a clear error naming the unprocessable content type
- **AND** the failure is not silent
