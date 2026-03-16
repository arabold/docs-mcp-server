# Change: Fix Parallel Scrape Job State Isolation

## Why

When multiple scrape jobs run in parallel, they share the same strategy instance from `ScraperRegistry`. This causes counters (`pageCount`, `totalDiscovered`, `effectiveTotal`) and the `visited` URL set to be shared and corrupted across jobs, resulting in incorrect progress logs (e.g., "Scraping page 125/112") and potential data integrity issues. This bug is documented in GitHub issue #316.

## What Changes

- **BREAKING**: Convert `ScraperRegistry` from caching pattern to factory pattern
- **BREAKING**: Remove `ScraperRegistry.cleanup()` method (no longer needed)
- Add per-scrape cleanup in `ScraperService.scrape()` to clean up strategy after each operation
- Remove `ScraperService.cleanup()` method (cleanup now happens per-scrape)
- Update `PipelineManager.stop()` to remove the now-unnecessary cleanup call
- Update all tests that reference the removed cleanup methods

## Impact

- Affected specs: None existing (new spec for scraper isolation)
- Affected code:
  - `src/scraper/ScraperRegistry.ts` - Factory pattern refactor
  - `src/scraper/ScraperService.ts` - Per-scrape cleanup, remove service cleanup
  - `src/scraper/ScraperRegistry.test.ts` - Update tests, add isolation tests
  - `src/scraper/ScraperService.test.ts` - Remove cleanup tests
  - `src/pipeline/PipelineManager.ts` - Remove cleanup call in stop()
  - `src/pipeline/PipelineManager.test.ts` - Remove cleanup tests
- Related issue: GitHub #316
