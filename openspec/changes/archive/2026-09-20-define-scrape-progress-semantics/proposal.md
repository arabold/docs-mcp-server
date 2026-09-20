## Why

Issue #490 reports that scraping `https://www.brendangregg.com` "writes that there are 800+ pages to add, but adds only 436". The progress fraction never reaches its own denominator, and no document in the repository says what either number means.

The counters diverged by accident, and the history is specific:

| When | Commit | What happened |
|---|---|---|
| Aug 2 2025 | `86dfd63`, `ca05250` | The denominator stopped being `maxPages` and became "URLs enqueued, clamped at maxPages". Deliberate. The now-deleted `ProgressBar.tsx` stated the intent plainly: "The progress reflects actual queue-based progress: processed vs. discovered pages." |
| Oct 27 2025 | `93a6ee3` | The TSDoc for `totalPages` was rewritten to say "Maximum number of pages to scrape (from maxPages option)". This is false, and it was collateral damage inside a commit about ETag refresh. |
| Nov 10 2025 | `b82dc27` | The numerator was narrowed to "has content, or has a DB pageId", inside a commit about depth-column migrations. The denominator was untouched and the interaction was never acknowledged. |

So the numerator counts pages that produced content while the denominator counts URLs that entered the queue. The fraction compares two different populations and structurally cannot complete.

A second, separate defect compounds it. The `item.depth > maxDepth` guard drops over-depth items when they are *dequeued*, but they were already counted when they were *enqueued*. In the measured crawl this inflated the denominator by 264. That guard (`e01d31e`) predates `effectiveTotal` entirely, from a time when the denominator was `maxPages` and dropping a dequeued item had no effect on the ratio. Nobody revisited it. There is no commit message, spec, doc, or comment anywhere that mentions it.

The only normative statement about these counters in the whole specification set is in `scraper-isolation`: progress must never report "page 125/112". That constrains the relationship without defining either term, and it forbids the fraction exceeding 100% while today's bug is the same invariant broken in the other direction.

The wrong TSDoc has also propagated into naming across four layers — `progressMaxPages` in `PipelineManager` and the store schema, `maxPages` in the web `jobPageCounts()` helper, and `/** Maximum number of pages to process. */` in `pipeline/types.ts`. Telemetry reports `maxPagesConfigured: job.progressMaxPages`, which labels a discovery count as a configured limit.

## What Changes

- **Define all counters in a new capability spec.** This is empty space, not a rewrite: there is nothing to supersede.

- **Restore the progress invariant.** The numerator counts items *processed* — every item taken off the queue and given an outcome, whatever that outcome was. The denominator counts items *enqueued*, clamped at the point where the crawl will stop. When the queue drains, the two meet, and the bar reaches 100% without anything special-casing the end of the crawl.

- **Make `maxPages` mean indexed pages.** `maxPages: 100` should deliver 100 indexed pages, not stop at 100 dequeued items of which some produced nothing. The crawl gates on the indexed count, and the denominator stretches by the number of processed-without-content items so the fraction still completes.

- **Floor a refresh's depth limit by the pages it already holds.** Stored `scraper_options` can be missing or unparseable, in which case `maxDepth` silently falls back to the config default and a version crawled with `-d 5` finds its own depth-5 pages out of bounds. Taking the maximum stored page depth removes the possibility, using data `PipelineManager` already has in hand.

- **Move the depth check to enqueue time.** A link exceeding `maxDepth` is never queued and never counted, rather than being counted and then silently dropped. Depth becomes a filter like scope and patterns, applied on the same side of the counter as every other filter.

- **Add `pagesIndexed` for pages that produced stored content** — the number users actually mean by "436 added". It is not part of the progress fraction. `pagesScraped` reverts to its original meaning of *processed*, which is what pairs with the denominator. All four counters are persisted on the job record, so the change carries one migration.

- **Correct the documentation and the naming that followed it.** Fix the `totalPages` TSDoc, fix the telemetry field that reports discovery as configuration, and rename or re-document the `progressMaxPages` chain.

- **Surface the new counter in the Jobs UI.** `JobCard` currently shows `N / M pages`, `X discovered`, and `depth d / maxDepth`. With a filling progress bar, `806 / 806 pages` adds nothing that the bar does not already convey, while "436 indexed" is the number a user wants. The new counter likely replaces the fraction in the card's text rather than joining it.

**Breaking for MCP consumers and for one persisted meaning.** `GetJobInfoTool` and `ListJobsTool` expose `pagesScraped` over MCP, and its value grows to include 404s, conditional hits, skips, and ignored failures — all work the job genuinely did, but a different number than before. `progressPages` and `progressMaxPages` are persisted columns whose meaning changes even though their values remain plausible, which makes the discrepancy quiet; it is bounded to rows that are overwritten the next time that library version is indexed.

**Depends on `filter-unprocessable-content`.** That change modifies the same "Filter ordering for discovered links" requirement to add the unprocessable-extension step. This change adds the depth step to the same list and should rebase onto the numbering it establishes. Landing this first would also be misleading: without the content filter, a large share of the "processed" count is resources being fetched and thrown away, which makes a filling progress bar technically correct and practically dishonest.

## Capabilities

### New Capabilities

- `scrape-progress-reporting`: Defines each progress counter reported by a scrape job, the invariant relating the processed count to the enqueued total, the point in the crawl at which each counter moves, which outcomes advance which counter, how the counters behave when `maxPages` and `maxDepth` bound the crawl, and which values are persisted across restarts.

### Modified Capabilities

- `scraping-scope`: The "Filter ordering for discovered links" requirement gains the depth check as an enqueue-time step, so that over-depth links are never queued.

## Impact

- **Code**:
  - [src/scraper/strategies/BaseScraperStrategy.ts:241](src/scraper/strategies/BaseScraperStrategy.ts:241) — remove the dequeue-time depth drop.
  - [src/scraper/strategies/BaseScraperStrategy.ts:430](src/scraper/strategies/BaseScraperStrategy.ts:430) — apply depth when link queue items are constructed, alongside the existing `shouldProcessUrl` call.
  - [src/scraper/strategies/BaseScraperStrategy.ts:255](src/scraper/strategies/BaseScraperStrategy.ts:255) — the `shouldCount` rule becomes the definition of "processed"; a separate increment tracks content-producing pages.
  - [src/scraper/types.ts:161](src/scraper/types.ts:161) — corrected TSDoc for `totalPages`, and the new counter on `ScraperProgressEvent`.
  - `src/pipeline/PipelineManager.ts`, `src/pipeline/types.ts`, `src/store/types.ts` — the `progressMaxPages` naming chain.
  - `src/telemetry/TelemetryService.ts` — `maxPagesConfigured` should read the resolved config, not `progressMaxPages`.
  - `src/tools/GetJobInfoTool.ts`, `src/tools/ListJobsTool.ts` — expose the new counter.
  - `src/web/client/pages/jobs/format.ts`, `src/web/client/pages/jobs/JobCard.tsx` — the bar and the card text.
- **Tests**: `LocalFileStrategy.test.ts:118-200` asserts a job terminating at `pagesScraped: 3, totalPages: 4`. It encodes the defect and must change, asserting all three counters explicitly so the relationship between them is pinned rather than implied. `BaseScraperStrategy.test.ts:43-89` asserts the progress event by exact equality and breaks on any shape change. `BaseScraperStrategy.test.ts:1248-1376` pins which fetch statuses advance the count. Roughly twenty further fixture sites across `src/pipeline`, `src/tools`, `src/events`, and `test/` need mechanical updates.
- **Config**: None.
- **Migration**: One column for `pagesIndexed` on the persisted job progress record. Existing rows default to null, rendered as unknown rather than zero.
- **Dependencies**: None.
- **Documentation**: `docs/concepts/pipeline-architecture.md` has a non-normative "Progress Tracking" bullet list that should point at the new spec.
