# Tasks: Fix Parallel Scrape Job State Isolation

## 1. Core Implementation

- [x] 1.1 Refactor `ScraperRegistry` to factory pattern
  - Store config instead of strategy instances
  - Create fresh strategy instance in `getStrategy()`
  - Remove `cleanup()` method
- [x] 1.2 Update `ScraperService` for per-scrape cleanup
  - Wrap `strategy.scrape()` in try/finally with cleanup
  - Remove `cleanup()` method
- [x] 1.3 Update `PipelineManager.stop()` to remove cleanup call
  - Remove `await this.scraperService.cleanup()` line

## 2. Test Updates

- [x] 2.1 Update `ScraperRegistry.test.ts`
  - Remove cleanup-related tests (cleanup method removed)
  - Add test: `getStrategy()` returns independent instances
  - Add test: parallel scrapes have isolated state
- [x] 2.2 Update `ScraperService.test.ts` (if exists)
  - Remove cleanup-related tests
  - Add test: strategy cleanup called after successful scrape
  - Add test: strategy cleanup called after failed scrape
- [x] 2.3 Update `PipelineManager.test.ts`
  - Remove cleanup-related tests in `describe("cleanup functionality")`
  - Keep `stop()` tests but remove cleanup expectations

## 3. Verification

- [x] 3.1 Run `npm run typecheck` to verify no type errors
- [x] 3.2 Run `npm run lint` to verify code style
- [x] 3.3 Run `npm test` to verify all tests pass
- [ ] 3.4 Manual verification: start two scrape jobs simultaneously and verify independent progress counts
