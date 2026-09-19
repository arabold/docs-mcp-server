## 0. Prerequisites

- [x] 0.1 `filter-unprocessable-content` landed in 10e5244; the delta is numbered against the 6-step list it established.
Settled on review, all recorded in `design.md`:

- `pagesScraped` means *processed*; a new `pagesIndexed` carries the content-producing count (Option A).
- All four counters are persisted, so this change carries one migration.
- `maxPages` bounds indexed pages, and the denominator stretches to keep the invariant.
- A refresh's `maxDepth` is floored by the depths of the pages it already holds.
- A clean-but-empty result is stored as an empty page with its etag; an extraction failure leaves the old content and withholds the etag.

## 1. Queue Ordering (audit complete, see design.md)

The ordering audit ran before drafting. Results: a normal crawl is provably breadth-first; refresh mode is not ordered by depth at all, because `getPagesByVersionId` has no `ORDER BY`. Today's dequeue-time drop is therefore itself a page-loss bug in refresh mode and in the llms.txt path, which this change fixes. These tasks capture what that leaves to do.

- [x] 1.1 Ordering guarantee documented next to the depth filter, including that it does not hold in refresh mode.
- [x] 1.2 Documented rather than asserted — the comment records that the property rests on the root being alone in the first batch.
- [x] 1.3 **Reversed on review — no floor is applied.** It was implemented, then removed, for two reasons. Its premise was wrong: `initialQueue` items bypass the enqueue-time depth filter entirely, which applies only to discovered links, so a stored page deeper than the current limit is processed either way. And it ratcheted: every QUEUED job persists its scraper options, refreshes included, so the floored value was written back, read by the next refresh and floored again, climbing on every cycle and never returning to what the user configured.

  What remains is a narrower gap: when stored options are missing or unparseable, `maxDepth` falls back to the config default, so *descendants* of deeper stored pages are not rediscovered. The root cause is `DocumentStore.getScraperOptions` discarding a usable options blob when `source_url` is null and swallowing a JSON parse failure into an empty object — which loses `scope`, `includePatterns`, `headers` and the rest, not just `maxDepth`. Fixing that is the deeper change and is deliberately left out of this one.

## 2. Depth Filtering At Enqueue

- [x] 2.1 Depth check added to the link mapper, ahead of `shouldProcessUrl`.
- [x] 2.2 Rejection does not touch `visited`; the reason is in a comment and pinned by test.
- [x] 2.3 Check lives in the link mapper only; `initialQueue` and `result.queueItems` bypass it.
- [x] 2.4 Dequeue-time drop removed.
- [x] 2.5 Rejection is silent.
- [x] 2.6 Predicate is `item.depth + 1 > maxDepth`.
- [x] 2.7 Covered, including the shallower-rediscovery regression guard.

## 3. Counter Semantics

- [x] 3.1 Every dequeued item advances `pageCount` exactly once via a single `report` helper.
- [x] 3.2 `pagesIndexed` advances only on the Stored outcome.
- [x] 3.3 `ScraperProgressEvent` carries `pagesIndexed` and `outcome`; all four counters re-documented.
- [x] 3.4 Loop and `remainingPages` now gate on `pagesIndexed`, so `maxPages: 100` yields 100 pages with content.
- [x] 3.5 Denominator is `min(urlsEnqueued, maxPages + processedWithoutContent)` via `processingBudget`/`retuneEffectiveTotal`.
- [x] 3.6 `maxPages` resolved before initialisation and both counters clamped there.
- [x] 3.7 `PageOutcome` added — stored, unchanged, absent, empty, skipped, failed — and every branch emits exactly one event.
- [x] 3.8 `PipelineWorker` branches per outcome; Unchanged and Empty no longer share a path.
- [x] 3.9 Covered by the new counter-semantics suite: drained crawl reaches its denominator; a maxPages-bound crawl indexes exactly maxPages with the denominator stretched; an oversized initial queue reports N/N; each outcome advances the right counters; a cancelled crawl is left below its denominator.

## 4. Carrying The Counters Outward

- [x] 4.1 `PipelineManager` carries `progressPagesIndexed` onto the job record.
- [x] 4.2 `pipeline/types.ts` and `store/types.ts` re-documented; nothing calls a queue-derived count a configured limit.
- [x] 4.3 Both MCP job tools expose `pagesIndexed`.
- [x] 4.4 Telemetry reads `job.scraperOptions?.maxPages` instead of `progressMaxPages`.

## 5. Empty Pages

- [x] 5.1 Clean-but-empty results store an empty page with their validators.
- [x] 5.2 On pipeline error the previous content is left alone and the etag withheld.
- [x] 5.3 `addEmptyPage` writes the page row directly, bypassing the chunk guard in `addDocuments`.
- [x] 5.4 Refresh path deletes the old page before recording the empty one.
- [x] 5.5 Covered: clean-empty carries its validators; a failed pipeline withholds them; a container records no page at all.

## 6. Persistence And Migration

- [x] 6.1 Migration `015-add-progress-pages-indexed.sql` adds the column.
- [x] 6.2 Defaults to NULL, not 0.
- [x] 6.3 Consumers render null as unknown.
- [x] 6.4 Covered by the migration defaulting to NULL and consumers rendering null as unknown; the column is written on every progress update.

## 7. Jobs UI

- [x] 7.1 `jobPageCounts` returns processed/expected/indexed/discovered.
- [x] 7.2 `JobCard` shows the indexed count; the bar is processed over expected.
- [x] 7.3 `discovered` shown only when it exceeds the denominator.
- [x] 7.4 Clamp retained. With the invariant holding it is now defensive rather than load-bearing, and `scraper-isolation` still forbids reporting over 100%.
- [x] 7.5 `FailedJobCard` updated; `Overview`/`Jobs` verified.

## 8. Test Fixtures

- [x] 8.1 Rewritten to assert all counters: 4 processed, 4 expected, 3 indexed, with the directory reported as Empty.
- [x] 8.2 Exact-equality event assertion updated.
- [x] 8.3 Per-status tests retained as the basis of the outcome scenarios.
- [x] 8.4 Fixtures updated across pipeline, tools and events suites.
- [x] 8.5 `effectiveTotal` field name unchanged, so those tests still apply.

## 9. New Counter Coverage

The existing suite asserts counters only in simple, consistent cases. These are the gaps, and they are where the defect hid.

- [x] 9.1 A URL linked from two pages is counted once.
- [x] 9.2 Over-depth links never reach the denominator.
- [x] 9.3 A maxPages-bound crawl reports all four counters consistently, with discovered exceeding the rest.
- [x] 9.4 Mixed 200/304/404 outcomes each advance the processed count; only 200s index.
- [x] 9.5 Content, skips and ignored failures together satisfy the invariant.
- [x] 9.6 An initial queue larger than maxPages reports N/N.
- [x] 9.7 Dropped with the floor (see 1.3). Refresh coverage is the GitHub strategy test in 9.10, which exercises a depth-heterogeneous initial queue.
- [x] 9.12 maxPages delivers its full count of indexed pages despite non-content items.
- [x] 9.8 maxDepth 0 queues nothing beyond the root.
- [x] 9.9 llms.txt depth-0 seeds survive; guarded by the seed test in the skipped-items suite.
- [x] 9.10 Added a refresh-with-counters test to `GitHubScraperStrategy.test.ts`, which had no depth, page-limit, initial-queue or counter coverage at all. It exercises the depth-heterogeneous queue (flat depth-1 blobs plus a depth-3 wiki page) and asserts the invariant.
- [x] 9.11 Every assertion checks all four counters together.

## 10. Documentation

- [x] 10.1 `docs/concepts/pipeline-architecture.md` now defines the counters and the outcome taxonomy.
- [x] 10.2 `ARCHITECTURE.md` gained a "Scrape progress counters" subsection.

## 11. Verification

- [x] 11.1 Reference crawl: pagesScraped 1012 = totalPages 1012 (100%), pagesIndexed 806, totalDiscovered 1012. Outcomes: 806 stored, 141 skipped, 53 absent, 11 empty, 1 failed.
- [x] 11.2 Indexed document set unchanged — zero lost, zero gained against the baseline.
- [x] 11.3 Both cases covered by test: a drained queue and a maxPages-bound crawl each satisfy the invariant.
- [x] 11.4 Refresh e2e suite passes, including the new-file/modified-file/deleted-file scenario.
- [x] 11.5 `npm run lint` and `npm run typecheck` clean; 2046/2046 tests pass across 134 files.
