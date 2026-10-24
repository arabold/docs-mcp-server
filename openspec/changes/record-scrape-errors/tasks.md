# Tasks

## 1. Storage

- [ ] 1.1 Add `db/migrations/019-add-scrape-errors.sql` (renumber if another migration lands first) with the `scrape_errors` table (`ON DELETE CASCADE` on `version_id`) and `idx_scrape_errors_version_id`, using `@migration-step` markers. Verify that a fresh in-memory database migrates and the table and index exist.
- [ ] 1.2 Add `ScrapeErrorKind`, `ScrapeErrorEvent` and `ScrapeErrorCallback` to `src/scraper/types.ts`, and `ScrapeErrorRecord` and `ScrapeErrorSummary` to `src/store/types.ts`, with TSDoc. Verify with `npm run typecheck`.
- [ ] 1.3 Implement `addScrapeError`, `clearScrapeErrors`, `getScrapeErrorSummary` and `listScrapeErrors` in `DocumentStore`:
  - Store the message with control characters stripped and truncated to 1000 characters.
  - Build the summary with grouped counts plus samples from `ROW_NUMBER()`, limited to 3, ordered by count descending and then by kind.
  - List in `id` order with a total count.
  - Return empty results for an unknown version.
  - Verify in `DocumentStore.test.ts`: summary grouping and ordering, samples limited to their own group, paging returns every row once, clearing one version leaves another untouched.
- [ ] 1.4 Make `removeVersion` delete the version's `scrape_errors` rows before the `versions` row. Verify in `DocumentStore.test.ts` that removing a version with history succeeds and leaves no rows.
- [ ] 1.5 Expose the reads end to end:
  - Add normalising wrappers to `DocumentManagementService`: writes take `(library, version)`, reads take `VersionRef`.
  - Add `getScrapeErrorSummary` and `listScrapeErrors` to `IDocumentManagement`, `DocumentManagementClient` and the data tRPC router. `limit` accepts 1 to 200 (default 50), and `offset` accepts 0 or more.
  - Verify with a router or client round-trip test that follows the existing `getVersionStats` coverage pattern.

## 2. Scraper

- [ ] 2.1 Add `classifyScrapeError()` in `src/scraper/utils/classifyScrapeError.ts` following the mapping table in `design.md`, including `code` lookup on `cause`. Verify with a table-driven `classifyScrapeError.test.ts` that covers every row, plus a plain `Error` and a non-`Error` value mapping to `other`.
- [ ] 2.2 Add the optional `onPageError` parameter to `ScraperStrategy.scrape()` and `ScraperService.scrape()`, and forward it in `WebScraperStrategy`, `GitHubScraperStrategy`, `NpmScraperStrategy` and `PyPiScraperStrategy`. Verify with `npm run typecheck`, and with a test in `ScraperService.test.ts` (or the nearest existing suite) showing the callback reaches the strategy.
- [ ] 2.3 Add `pipelineErrorMessage` to `ProcessItemResult` and set it in `WebScraperStrategy` beside `pipelineFailed`, using the first pipeline error's message. Verify in `WebScraperStrategy.test.ts` that an errored, empty extraction carries the message.
- [ ] 2.4 In `BaseScraperStrategy.processQueueItem`, report page errors through `onPageError` as laid out in the design's call flow:
  - Catch block: report before the root rethrow and the `crawl.abortError` check, and skip `CancellationError` and `FailureThresholdExceededError`.
  - `NOT_FOUND` branch: report only when the 404 is not a refresh deletion.
  - Empty-result branch: report an extraction error when `pipelineFailed` is true or `content.errors` is non-empty.
  - Leave `report()` and the failure accounting in their current order.
  - Verify in `BaseScraperStrategy.test.ts`:
    - thrown errors and 404s are reported with their category and status
    - refresh deletions and skipped content are not reported
    - an errored local-file-style empty result is reported as an extraction error, and a clean empty result is not
    - an llms.txt seed 404 is reported without changing the failure rate
    - the page that trips `abortOnFailureRate` is reported before the scrape rejects
    - progress events and counters are identical to a run without `onPageError`
- [ ] 2.5 Re-run the full `BaseScraperStrategy.test.ts`, `scrape-progress-e2e.test.ts` and `unprocessable-content-e2e.test.ts` and confirm they pass unchanged. That shows the reorder did not move any counter or outcome.

## 3. Pipeline

- [ ] 3.1 In `PipelineWorker.executeJob`:
  - Call `clearScrapeErrors` first, for scrape and refresh alike.
  - Create a per-run `recordPageError` closure that writes through `addScrapeError`, catches and logs store failures with `❌`, and drops events once a `runSettled` flag is set in `finally`.
  - Pass the closure to `scraperService.scrape`.
  - Verify in `PipelineWorker.test.ts`: history is cleared at start (including refresh), reported errors are written, a store failure while writing does not fail the job, and an event arriving after the scrape settles is dropped.
- [ ] 3.2 Record an **indexing** error from the catch blocks of `storeResult` and `recordEmptyPage`, in addition to the existing `onJobError` call. Verify in `PipelineWorker.test.ts` that a rejected `addScrapeResult` produces one indexing entry for that URL.

## 4. Web UI

- [ ] 4.1 Add the `useScrapeErrorSummary` and `useListScrapeErrors` hooks to `api/hooks.ts`. In `useLiveInvalidation`, invalidate both on `LIBRARY_CHANGE`. Verify with `npm run typecheck`.
- [ ] 4.2 Add the presentational component `components/ScrapeErrorSummary.tsx`: one row per group showing count, category and status, plus wrapped sample URLs. It renders `null` for an empty summary. Use ternaries for conditionals per `AGENTS.md`. Verify visually in task 4.5.
- [ ] 4.3 In `Jobs.tsx`, mark a failed job as superseded when the list holds a newer job for the same library and version, and pass `showErrorSummary` to `FailedJobCard`. That card queries and renders the summary under the error line. Also add `overflow-wrap: anywhere` to `.jobc__error`. Verify visually in task 4.5.
- [ ] 4.4 Add `library-detail/ScrapeErrorsPanel.tsx` and mount it in `LibraryDetail.tsx`:
  - Show it for `FAILED` or `COMPLETED` versions whose summary total is above 0, with the error palette for failed and the warning palette for completed.
  - "Show all N" expands a paged list with "Load more".
  - Add the `.scrape-errors*` styles to `components.css`.
  - Verify visually in task 4.5.
- [ ] 4.5 Run the dev server and scrape a mock or real site that produces 404s and 403s. Check:
  - the failed card shows grouped counts and samples
  - the library detail panel shows the summary, and the full list pages correctly
  - long URLs wrap at mobile width
  - starting a retry clears the panel and hides the summary on the old failed card
  - both themes render
  - Capture a screenshot.

## 5. End-to-End And Docs

- [ ] 5.1 Add `test/scrape-error-history-e2e.test.ts` (nock plus an in-memory store, following `scrape-progress-e2e.test.ts`). Cover:
  - a crawl with mixed 404 and 403 children that aborts on the threshold, where the summary holds both groups with correct counts, and the not-found count equals the number of failed 404 pages counted in the abort message
  - a crawl that completes under the threshold and still has a history
  - a second run of the same version that starts with an empty history
  - a refresh where a stored page now answers 404, with no entry recorded
  - Verify with `npx vitest run test/scrape-error-history-e2e.test.ts`, with the suite well under the 30s CI limit.
- [ ] 5.2 Add the new suite to the test inventory table in `AGENTS.md`. Add a short section to `ARCHITECTURE.md` on where page errors are recorded, which layer writes them, and how long they live. Verify by reading both.
- [ ] 5.3 Run `npm run lint`, `npm run typecheck` (with a cold cache: delete `.tsbuildinfo` first) and `npm test`, and confirm all pass.
