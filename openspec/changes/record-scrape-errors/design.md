# Design

## Context

See `proposal.md` for the motivation and `specs/scrape-error-history/spec.md` for the contract. The current state that shapes this design:

- **A run has no database identity.** A job is an entry in `PipelineManager.jobMap` with a random ID. It disappears on "Clear completed" and on restart. Everything that outlives a run (status, progress, `error_message`) is stored on the `versions` row, and each new run overwrites it. Only one job runs per version at a time.
- **The scraper does not touch the store.** `BaseScraperStrategy` reports through a progress callback. `PipelineWorker` turns those events into store writes (`storeResult`, `recordEmptyPage`, `removeDeletedPage`).
- **The progress callback cannot carry failures.** `scrape-progress-reporting` gives the **failed** outcome a narrow meaning: an error that was ignored under `ignoreErrors`. Each outcome also advances `pagesScraped`, and an aborted run must end with `pagesScraped` below `totalPages`. The page that trips `abortOnFailureRate`, and a failing root, are never reported as an outcome, and emitting them as one would break that contract.
- **Failure accounting runs before reporting.** In `processQueueItem`, both the catch block and the `NOT_FOUND` branch call `recordChildPageFailure()` and `ensureFailureRateWithinThreshold()` before `report()`. A threshold abort therefore throws before the tripping page leaves any trace.
- **Readers and the writer can be in different processes.** In remote-worker mode the web server reads through `DocumentManagementClient` → data tRPC router → the worker's `DocumentManagementService`. `PipelineWorker` writes to its local `DocumentManagementService` directly.
- **Extraction failure is only partly detected.** `WebScraperStrategy` sets `pipelineFailed` when the pipeline raised errors and produced no text, but passes on no message. `LocalFileStrategy`, `GitHubRepoProcessor` and `GitHubWikiProcessor` return `content` with its `errors` array and never set `pipelineFailed`.

## Goals / Non-Goals

**Goals:**
- One write path for every recorded error, whichever strategy or failure branch produced it.
- No change to failure-rate accounting, progress counters or outcome semantics.
- A failure to write history never fails or slows the run in a way the user can see.

**Non-Goals:**
- Persisting job history or giving runs a database identity (option B in the review of #521).
- Exposing the history through MCP tools or the CLI. The store API makes that a later, additive change.
- Suggesting exclude patterns from the history. That would be an obvious follow-up in the UI.
- Changing how `LocalFileStrategy` or the GitHub processors handle `pipelineFailed` for validator storage. This change only reads their `content.errors` to decide whether to record an error.

## Decisions

### Key the history by version and replace it when a run starts

The table references `versions(id)`. `PipelineWorker.executeJob()` clears the version's rows before anything else, for scrape and refresh alike.

- **Why:** this matches how every other piece of run state is already persisted. The history then lives exactly as long as the `error_message` it explains, survives restarts, and needs no run entity.
- **Alternative:** a `scrape_runs` table with errors cascading from it. Rejected: it introduces a third home for job state beside `versions` and `jobMap`. "Clear completed" would also delete details while the library page still shows the error.

### Report page errors through a separate callback, not the progress event

`ScraperStrategy.scrape()` gains an optional fourth parameter, `onPageError`.

- **Why:** the progress event's outcomes are defined by `scrape-progress-reporting`, and adding a "failed but not ignored" outcome would redefine **failed** and move counters on an aborted run. A separate channel leaves that spec untouched and can fire at the exact point the failure is known.
- **Alternatives:**
  - A `failure` field on the progress event. Rejected: the threshold-tripping page and a failing root emit no event to attach it to.
  - Carrying the details on `FailureThresholdExceededError`. Rejected: that covers only aborted runs, and the issue is just as real for runs that complete with failures.

### Report before accounting

In the catch block and the `NOT_FOUND` branch, `onPageError` is awaited before the root check, `recordChildPageFailure()` and `ensureFailureRateWithinThreshold()`.

- This is the only reordering. `report()` keeps its current position, so counters and outcomes are unchanged.

### Record exactly the page's own failure, using the same predicates

- **A not-found is recorded when `!isRefreshDeletion(item, result)`.** A refresh 404 is never recorded, even when an identity fallback is queued, because it is the representation that disappeared, not a page error.
- **A thrown error is recorded unless it is `CancellationError` or `FailureThresholdExceededError`.** Neither is a page's own failure.
- **Errors from items still running when the crawl aborts are still recorded.** Recording happens before the `crawl.abortError` check, so these errors, which today are swallowed, are recorded while the run is still live (see the straggler guard below).
- **An extraction failure is recorded when the item produced no text and either `result.pipelineFailed` is true or `result.content?.errors` is non-empty.** This covers all four processors without changing their return contracts beyond one optional field.

### Indexing failures are recorded by the worker

`storeResult()` and `recordEmptyPage()` already catch store and embedding failures and call `onJobError`. They additionally record an **indexing** error.

- **Why:** the scraper cannot see these failures, and the worker already owns that catch. The same worker-local writer is used, so the clear and the straggler guard apply to them too.

### Categories come from the error type, not the message

`classifyScrapeError()` maps typed errors to a category and a status. Message parsing is not used.

| Error | Category | Status |
|---|---|---|
| `HttpStatusError` with 404 | `not_found` | 404 |
| `HttpStatusError`, `RedirectError` | `http` | its `statusCode` |
| `ChallengeError` | `challenge` | its `statusCode` |
| `TlsCertificateError` | `tls` | null |
| `AccessPolicyError` | `access_policy` | null |
| `code` (on the error or its `cause`) `ECONNABORTED` / `ETIMEDOUT`, or `name === "TimeoutError"` (Playwright) | `timeout` | null |
| `code` `ENOTFOUND` / `ECONNREFUSED` / `ECONNRESET` / `EAI_AGAIN` / `EHOSTUNREACH` | `network` | null |
| anything else | `other` | null |

A `NOT_FOUND` fetch result is `not_found` / 404 without going through the classifier.

### Summary computed in SQL

- Counts use `GROUP BY kind, status_code`.
- Sample URLs use `ROW_NUMBER() OVER (PARTITION BY kind, status_code ORDER BY id)`, keeping rows with `rn <= 3`. The bundled SQLite supports window functions.
- Groups are sorted by count, largest first, then by kind. The tie-break keeps the order stable.
- The sample bound is 3. The UI shows every sample, and 3 is enough to spot a URL pattern.

## Program Design

### Files

```
db/migrations/
+ 019-add-scrape-errors.sql           # scrape_errors table + version index (017 is taken by #517, 018 by the embedding blobs)
src/scraper/
~ types.ts                            # ScrapeErrorKind, ScrapeErrorEvent, ScrapeErrorCallback; scrape() gains onPageError
~ ScraperService.ts                   # forwards onPageError
  strategies/
~   BaseScraperStrategy.ts            # reports page errors before failure accounting; ProcessItemResult.pipelineErrorMessage
~   WebScraperStrategy.ts             # forwards onPageError; sets pipelineErrorMessage beside pipelineFailed
~   GitHubScraperStrategy.ts          # forwards onPageError
~   NpmScraperStrategy.ts             # forwards onPageError
~   PyPiScraperStrategy.ts            # forwards onPageError
  utils/
+   classifyScrapeError.ts            # error → { kind, statusCode }
src/pipeline/
~ PipelineWorker.ts                   # clears history at run start, writes page and indexing errors, drops stragglers
src/store/
~ types.ts                            # ScrapeErrorRecord, ScrapeErrorSummary
~ DocumentStore.ts                    # statements + add/clear/summary/list; removeVersion deletes history
~ DocumentManagementService.ts        # normalising wrappers
~ DocumentManagementClient.ts         # summary/list over tRPC
  trpc/
~   interfaces.ts                     # IDocumentManagement gains summary/list (reads only)
~   router.ts                         # getScrapeErrorSummary, listScrapeErrors
src/web/client/
  api/
~   hooks.ts                          # useScrapeErrorSummary, useListScrapeErrors
  hooks/
~   useLiveInvalidation.ts            # invalidates both on LIBRARY_CHANGE
  components/
+   ScrapeErrorSummary.tsx            # grouped counts + samples; shared by both views
  pages/
~   Jobs.tsx                          # works out which failed jobs are superseded
    jobs/
~     FailedJobCard.tsx               # renders the summary unless superseded
~   LibraryDetail.tsx                 # mounts ScrapeErrorsPanel
    library-detail/
+     ScrapeErrorsPanel.tsx           # summary + expandable paged list
  styles/
~   components.css                    # summary/list styles; break-word on .jobc__error
test/
+ scrape-error-history-e2e.test.ts
~ AGENTS.md                           # test inventory row
~ ARCHITECTURE.md                     # where page errors are recorded and how long they live
```

### Schema

```sql
CREATE TABLE IF NOT EXISTS scrape_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  depth INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status_code INTEGER,
  message TEXT NOT NULL,
  occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scrape_errors_version_id ON scrape_errors(version_id);
```

- **`ON DELETE CASCADE` plus an explicit delete.** `removeVersion` also deletes `scrape_errors` explicitly before the `versions` row, matching how it handles `pages` and `documents`, so connections without `foreign_keys = ON` don't leave orphans.
  - The cascade exists for rollback. An older build knows nothing about the table, and without the cascade its `removeVersion` would fail the foreign-key check on any version that has history.
- **Recording order is `id` order.**

### Types

```ts
// src/scraper/types.ts
export enum ScrapeErrorKind {
  NotFound = "not_found", Http = "http", Challenge = "challenge", Tls = "tls",
  AccessPolicy = "access_policy", Timeout = "timeout", Network = "network",
  Extraction = "extraction", Indexing = "indexing", Other = "other",
}
export interface ScrapeErrorEvent {
  url: string;              // the item's URL as dequeued, not the canonical identity
  depth: number;
  kind: ScrapeErrorKind;
  statusCode: number | null;
  message: string;
}
export type ScrapeErrorCallback = (error: ScrapeErrorEvent) => Promise<void>;

// ScraperStrategy.scrape / ScraperService.scrape
scrape(options, progressCallback, signal?: AbortSignal, onPageError?: ScrapeErrorCallback): Promise<void>;

// src/store/types.ts
export interface ScrapeErrorRecord extends ScrapeErrorEvent { id: number; occurredAt: Date; }
export interface ScrapeErrorSummary {
  total: number;
  groups: Array<{ kind: ScrapeErrorKind; statusCode: number | null; count: number; sampleUrls: string[] }>;
}
```

`url` is the URL that failed. A failed item never got a canonical identity, and the user needs the address the crawler actually requested in order to write an exclude pattern.

### Signatures and error contracts

```ts
// src/scraper/utils/classifyScrapeError.ts
export function classifyScrapeError(error: unknown): { kind: ScrapeErrorKind; statusCode: number | null };
// Total: never throws. Unknown inputs map to Other.

// DocumentStore
addScrapeError(library: string, version: string, error: ScrapeErrorEvent): Promise<void>;
// Throws StoreError on a database failure. A missing version is a no-op with logger.warn.
clearScrapeErrors(library: string, version: string): Promise<void>;
getScrapeErrorSummary(library: string, version: string): Promise<ScrapeErrorSummary>;
listScrapeErrors(library: string, version: string, page: { limit: number; offset: number }):
  Promise<{ items: ScrapeErrorRecord[]; total: number }>;
// Reads return empty results for an unknown version and never throw a not-found error.

// DocumentManagementService: writes mirror the store's (library, version) form,
// because the worker calls them like addEmptyPage. Reads take VersionRef like getVersionStats.
getScrapeErrorSummary(ref: VersionRef): Promise<ScrapeErrorSummary>;
listScrapeErrors(ref: VersionRef, page: { limit: number; offset: number }): Promise<{ items: ScrapeErrorRecord[]; total: number }>;
```

- **Router input:** `listScrapeErrors` accepts `limit` from 1 to 200 (default 50) and `offset` of 0 or more.
- **Stored message:** control characters are stripped and the result is truncated to 1000 characters. URLs are kept: this is the user's own data, and the telemetry sanitizer, which redacts URLs, is the wrong tool here.

### Call flow

```
PipelineWorker.executeJob()
+   store.clearScrapeErrors(library, version)         # first; scrape and refresh alike
    store.removeAllDocuments(...)                     # unchanged: skipped for refresh / clean=false
    scraperService.scrape(options, onProgress, signal, recordPageError)
      BaseScraperStrategy.processQueueItem() → per item, sliding window
        processItem() throws
+         onPageError(classify(error))                # skipped for Cancellation/FailureThresholdExceeded
          if requested root → rethrow                 # unchanged
          if crawl.abortError → rethrow               # unchanged; error already recorded above
          recordChildPageFailure()
          ensureFailureRateWithinThreshold()          # may throw; the page is already recorded
          report(Failed)                              # unchanged, ignoreErrors only
        processItem() → NOT_FOUND
+         if !isRefreshDeletion → onPageError(not_found, 404)
          root check / recordChildPageFailure / threshold / report(Absent)   # unchanged order
        processItem() → SUCCESS, no text
+         if pipelineFailed || content.errors.length → onPageError(extraction)
          report(Empty)                               # unchanged
      onProgress → PipelineWorker.storeResult() / recordEmptyPage() catch
+       recordPageError(indexing, docError.message)   # in addition to onJobError
    finally
+     runSettled = true                               # recordPageError becomes a no-op
```

**Invariants:**
- `recordPageError` is a closure created per `executeJob` call. It catches and logs (`❌`) every store failure, so it never throws into the strategy. A history write can never abort a crawl.
- After `runSettled`, the closure drops events. The crawl loop's `Promise.race` rejects on the first throw and leaves the other running items going. Without this guard, a sibling that fails late could write into the history of a run started by an immediate retry.
- The clear happens before the scrape starts and after the version row exists. `updateJobStatus(RUNNING)` has already called `ensureLibraryAndVersion`.

### Web UI

- **`ScrapeErrorSummary`** is presentational. It takes a `ScrapeErrorSummary` and renders one row per group: `83× not found · 404`, then the sample URLs, each wrapped with `overflow-wrap: anywhere`. It renders `null` when `total` is 0.
- **`Jobs.tsx`** marks a failed job as superseded when the list holds a job for the same library and version (`version ?? ""`) with a later `createdAt`. It passes `showErrorSummary={!superseded}`. `FailedJobCard` queries `useScrapeErrorSummary({ library, version }, showErrorSummary)`.
- **`ScrapeErrorsPanel`** renders when the active version's status is `FAILED` or `COMPLETED` and `summary.total > 0`. It sits above the existing "Scraping failed" banner position in `detail-col`. "Show all N" expands a list that pages with `useListScrapeErrors` (limit 50, "Load more").
- **`useLiveInvalidation`** invalidates `getScrapeErrorSummary` and `listScrapeErrors` on `LIBRARY_CHANGE`. `updateJobStatus` emits that event on every status change, including the run starting (which is when the history is cleared) and the run ending.
- **CSS:** add `overflow-wrap: anywhere` to `.jobc__error`, and new `.scrape-errors*` rules that reuse the `--err` / `--warn` tokens. A completed run with errors uses the warning palette, and a failed run uses the error palette.

## Risks / Trade-offs

- **A large crawl that completes with many failures writes many rows** (one per failed page). → Failed pages are bounded by processed items, which `maxPages` already bounds. Each row is one small insert on the worker's own connection. No cap is applied because the user asked for every error. Revisit only if measurements show insert cost matters.
- **An extra awaited call on the failure path.** → It is a single synchronous `better-sqlite3` insert behind an `await`. It runs only on failures, not on the success path.
- **The history of an interrupted run is cleared by its recovery run.** → Recovery is a new run by definition (`enqueueRefreshJob`). This matches how `error_message` and progress already behave.
- **A superseded failed card is decided from the in-memory job list.** → After "Clear completed", or a restart, older failed cards are gone anyway, so the only case is a failed card next to a newer job. That case is exactly what the check covers.
- **An existing test that relies on failure accounting running before any await in the catch block could become flaky.** → The reorder adds one await before `recordChildPageFailure()`. Tests that count `processItem` calls after an abort are reviewed as part of the `BaseScraperStrategy` task.

## Migration Plan

- Migration `019` is additive: a new table and an index. Existing versions start with an empty history and gain one on their next run. No backfill is possible or needed.
- **Rollback:** older builds never read or write the table, and the cascade lets their `removeVersion` delete versions that have history. A stale history can remain after a rollback, because older builds don't clear it when a run starts. It reappears only if the newer build is reinstalled, and its next run of that version clears it.
