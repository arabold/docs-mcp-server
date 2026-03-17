## ADDED Requirements

### Requirement: Scraper Strategy Instance Isolation

The `ScraperRegistry` SHALL create a new strategy instance for each call to `getStrategy()`, ensuring that parallel scrape operations have completely independent state.

#### Scenario: Independent instances for same URL pattern
- **GIVEN** two scrape jobs targeting URLs that match the same strategy type
- **WHEN** `ScraperRegistry.getStrategy()` is called for each job
- **THEN** two distinct strategy instances are returned
- **AND** modifications to one instance do not affect the other

#### Scenario: Parallel scrapes maintain independent counters
- **GIVEN** two scrape jobs running in parallel
- **WHEN** both jobs process pages concurrently
- **THEN** each job maintains its own `pageCount`, `totalDiscovered`, and `effectiveTotal` values
- **AND** progress callbacks report accurate counts per job (e.g., never "page 125/112")

#### Scenario: Parallel scrapes maintain independent visited sets
- **GIVEN** two scrape jobs running in parallel with overlapping URL patterns
- **WHEN** job A processes a URL
- **THEN** job B's `visited` set is not affected
- **AND** job B can still process the same URL if it discovers it

### Requirement: Per-Scrape Strategy Cleanup

The `ScraperService` SHALL clean up each strategy instance immediately after the scrape operation completes, regardless of success or failure.

#### Scenario: Cleanup after successful scrape
- **GIVEN** a scrape operation that completes successfully
- **WHEN** the scrape finishes
- **THEN** the strategy's `cleanup()` method is called
- **AND** browser instances, temp files, and other resources are released

#### Scenario: Cleanup after failed scrape
- **GIVEN** a scrape operation that fails with an error
- **WHEN** the error is thrown
- **THEN** the strategy's `cleanup()` method is still called
- **AND** browser instances, temp files, and other resources are released

#### Scenario: Cleanup after cancelled scrape
- **GIVEN** a scrape operation that is cancelled via abort signal
- **WHEN** the cancellation occurs
- **THEN** the strategy's `cleanup()` method is called
- **AND** browser instances, temp files, and other resources are released

## REMOVED Requirements

### Requirement: ScraperRegistry Cleanup Method

**Reason**: With the factory pattern, no strategy instances are cached in the registry. Cleanup responsibility has moved to per-scrape cleanup in `ScraperService`.

**Migration**: Remove all calls to `ScraperRegistry.cleanup()`. Cleanup is now automatic after each scrape.

### Requirement: ScraperService Cleanup Method

**Reason**: With per-scrape cleanup in the `scrape()` method's finally block, there is no need for a separate cleanup method. Each strategy is cleaned up immediately after use.

**Migration**: Remove all calls to `ScraperService.cleanup()`. Remove the cleanup call from `PipelineManager.stop()`.
