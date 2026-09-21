## Context

Three counters are reported to every consumer of a scrape job, and two of them are wrong in ways that reinforce each other.

```
  WHERE EACH COUNTER MOVES TODAY

  discovered link
        │
        ├─ scope + pattern filters  ───────────► rejected here: never counted ✓
        │
        ▼
   [ ENQUEUE ]  ── totalDiscovered++          ─┐
                   effectiveTotal++ (≤maxPages)│  DENOMINATOR moves here
        │                                      ─┘
        ▼
   [ DEQUEUE ]
        │
        ├─ depth > maxDepth ──────────────────► dropped, already counted ✗
        │                                        264 phantom items
        ▼
   fetch + pipeline
        │
        ├─ no content produced ───────────────► not counted in numerator ✗
        │   (images, unsupported types,          1087 items
        │    ignored errors, directory items)
        ▼
   pageCount++                                ─── NUMERATOR moves here

  Result on brendangregg.com:  806 / 1000, and the queue is empty.
```

The denominator counts everything that got into the queue. The numerator counts a subset of what came out. The gap is not a rounding artefact, it is two different populations.

## Goals / Non-Goals

**Goals**

- Write down what each counter means, since nothing does.
- Make the progress fraction reach its denominator when a crawl completes normally.
- Give "how many pages did I actually get" its own number, because that is what users are asking when they read the fraction.
- Fix the documentation and naming that spread the original error outward.

**Non-Goals**

- Changing what a crawl indexes. The document set is unchanged, with one deliberate correction: a crawl that reaches `maxPages` now indexes exactly that many pages rather than stopping short because some dequeued items produced nothing.
- Predicting the final page count. The denominator is a live measure of queued work, not a forecast.
- Redesigning the Jobs page. The card's text changes to accommodate the new counter; the page's structure does not.

## Decisions

### Decision: The numerator counts processed items, not indexed ones

An item is *processed* when it is taken off the queue and given an outcome — content stored, not modified, not found, skipped, or failed-and-ignored. Every dequeued item reaches exactly one outcome, so the numerator advances once per item, always.

This is what `ca05250` intended in August 2025 and what `b82dc27` accidentally undid in November. Restoring it makes the invariant hold mechanically rather than by convention:

```
  AFTER

  discovered link
        │
        ├─ scope, patterns, archive, unprocessable, DEPTH ──► rejected: not counted
        │                                                      (depth moves up here)
        ▼
   [ ENQUEUE ]  ── totalDiscovered++
                   effectiveTotal++ (≤maxPages)    ── DENOMINATOR
        │
        ▼
   [ DEQUEUE ]  ── every item reaches an outcome
        │
        ├── content stored ──┐
        ├── 304 not modified ┤
        ├── 404 not found    ├──► processed++        ── NUMERATOR
        ├── skipped          ┤
        └── failed (ignored) ┘
                             │
                             └─ content stored also ──► indexed++   (separate)

  Every enqueued item is eventually dequeued and processed,
  so processed converges on effectiveTotal. The bar fills.
```

### Decision: Depth is a filter, applied at enqueue

Every other filter — scope, patterns, archive extension, unprocessable extension — runs before an item is queued. Depth is the lone exception, and only for historical reasons. Moving it to enqueue is what makes the invariant above true, and it also stops the queue from carrying items that exist only to be discarded.

```
  BEFORE                              AFTER

  enqueue depth-4 link                depth-4 link rejected at the filter
  effectiveTotal++                    effectiveTotal unchanged
       ⋮                              never queued
  dequeue, see depth > maxDepth
  return [] silently
  ── denominator now permanently
     264 higher than reachable
```

### Decision: rejection must not consume a dedup slot

`this.visited` is populated at enqueue time and is the only dedup mechanism in the crawl. Today an over-depth URL still occupies a slot in it. Whether removing it is safe rests on an ordering property nobody had written down, so it was traced explicitly.

**In a normal crawl the queue is strictly breadth-first**, and this is provable rather than incidental. `queue.splice(0, batchSize)` takes a prefix, `queue.push(...newUrls)` appends, and `Promise.all` preserves index order rather than completion order, so `results.flat()` is ordered by batch position. Two invariants hold jointly by induction: queue depths are non-decreasing, and `max(depth) - min(depth) <= 1`. A URL is therefore always first offered for enqueue at its minimum reachable depth, and rejecting at depth N+1 cannot lose a URL reachable at depth ≤ N.

That guarantee is more fragile than it looks: it depends on the root being alone in the first batch, which happens only because `queue.length === 1` forces `batchSize = 1`. Nothing enforces it.

**In refresh mode the property does not hold at all.** `initialQueue` comes from `getPagesByVersionId`, which is `SELECT * FROM pages WHERE version_id = ?` with no `ORDER BY` — rowid order. After a refresh has deleted and re-inserted changed pages while leaving 304s at their old rowids, that order is "unchanged pages, then changed pages", which bears no relation to depth. The root is not necessarily first either, since it is only `unshift`ed when absent from `initialQueue`, and in a real refresh it is always present.

**The consequence runs opposite to the fear that prompted this investigation. Today's dequeue-time drop is itself a page-loss bug, and this change fixes it:**

```
  maxDepth = 3, maxConcurrency = 3
  initialQueue in DB order: [ P3 (depth 3), P1 (depth 1), root (depth 0) ]

  batch 1 = [P3, P1, root]
      P3 links X   →  X at depth 4
      P1 links Y   →  Y at depth 2,  and Y links X

  queue after batch 1 = [ X(4), Y(2) ]        ← not non-decreasing

  TODAY
      X(4) enqueued      →  visited.add(X), counters++
      X(4) dequeued      →  dropped silently at the depth guard
      Y(2) processed     →  offers X at depth 3, which is acceptable
      dedup              →  X already in visited  →  DISCARDED
      ⇒ X is never scraped, though it was reachable within maxDepth.
        PAGE LOST TODAY.

  PLANNED  (rejection does not touch visited)
      X(4) rejected at enqueue, visited untouched
      Y(2) offers X at depth 3  →  admitted  →  scraped
      ⇒ PAGE RECOVERED.
```

The same shape costs pages in the llms.txt path: a depth-0 seed for a URL already discovered over-depth is deduped away today, so a URL explicitly listed in llms.txt is never scraped. This change recovers those too.

All of which makes the proviso load-bearing. **Implementing the check as "mark visited, then skip" would convert this from a fix into a permanent-loss bug in exactly the interleaving above.** That is a test, not a comment.

Archive expansion and the GitHub strategy were also checked and are safe: both flatten their trees into a single depth level, and nesting elsewhere is strictly `parent + 1`.

### Decision: the depth check runs before scope and patterns

Dedup does not run until after every item in a batch has finished, so today N pages linking the same over-depth URL already pay N full `shouldProcessUrl` evaluations — scope comparison plus glob and regex matching. `visited` saves only the queue push and two counter increments.

Placing depth as step 4, ahead of scope and patterns, therefore makes over-depth links *cheaper* than they are today, because an integer comparison short-circuits the string work. Re-evaluating a rejected URL once per referring page costs nothing worth counting.

One caveat: nothing is logged for over-depth items today. A per-link log line would produce one entry per occurrence, and the measured crawl had 264 of them. Keep the rejection silent, or at trace level.

### Decision: a refresh's depth limit is floored by the pages it already has

Removing the dequeue guard would otherwise expose a latent hazard. That guard is currently the only thing stopping an `initialQueue` item whose stored depth exceeds the current `maxDepth`. Refresh normally inherits `maxDepth` from the stored scraper options, so this cannot happen — except that `getScraperOptions` returns null when `source_url` is missing and swallows unparseable JSON into an empty object. Either way `options.maxDepth` is undefined, the config default of 3 applies, and a version originally crawled with `-d 5` carries depth-4 and depth-5 rows into a refresh that believes its limit is 3.

Rather than accept that and reason about the consequences, remove the possibility. The depth of every stored page is already on the `pages` row, and `PipelineManager` already maps over exactly that array to build `initialQueue`. Taking the maximum costs one pass over data already in hand:

```
  effectiveMaxDepth = max( storedOptions.maxDepth ?? configDefault,
                           max(page.depth for page in pages) )
```

A refresh can then never contain a page deeper than its own limit, whatever happened to the stored options. No schema change, no migration, and it self-heals versions whose options are already corrupt or missing.

This is narrow by design: it applies to refresh, where the depth limit is inherited rather than chosen. A user who wants a shallower crawl re-scrapes with an explicit `maxDepth`, and that path is untouched.

### Decision: `maxPages` bounds indexed pages, and the denominator stretches to match

`maxPages: 100` means "index 100 pages". A user who asks for 100 files expects 100 files, not 98 because the crawler looked at two things and discarded them. The loop therefore gates on `pagesIndexed`, not on the processed count.

The obvious objection is that this breaks the invariant: if the crawl keeps going until 100 pages are indexed, it may dequeue 130 items, and a denominator clamped at 100 would be exceeded. But the clamp is the thing to fix, not the gate. It exists to answer "how many items will we process before we stop?", and once `maxPages` counts indexed pages, that answer is no longer `maxPages`:

```
  effectiveTotal = min( enqueued,  maxPages + nonIndexedProcessed )
                          │                        │
                          │                        └─ exact by the time
                          │                           the crawl ends
                          └─ the crawl may simply run out of links first
```

Worked through:

```
  maxPages = 100

  queue drains first        enqueued 50, indexed 40, non-indexed 10
                            denominator = min(50, 110)  = 50
                            numerator                   = 50    ✓ 100%

  limit reached             enqueued 630, indexed 100 at 130 processed
                            denominator = min(630, 130) = 130
                            numerator                   = 130   ✓ 100%
```

The invariant holds by construction. `pagesIndexed <= maxPages` because `remainingPages` already bounds `batchSize`, so `processed = indexed + nonIndexed <= maxPages + nonIndexed`; and `processed <= enqueued` because you cannot dequeue what was never queued. Therefore `processed <= min(enqueued, maxPages + nonIndexed)`, which is the denominator.

The bar also stays monotonic. A skip bumps numerator and denominator together, and since `indexed <= maxPages` the ratio `(i+n)/(M+n)` rises rather than falls. The bar can still stretch backwards as *discovery* adds to `enqueued`, which is inherent to a queue-based measure and is pre-existing behaviour.

### Decision: the progress event names its outcome explicitly

The success branch currently fires the progress callback only when content was produced. Directory items, unsupported content types, empty-text pages and ignored failures reach an outcome and emit nothing, so `pagesScraped` would advance invisibly. Every outcome must emit an event.

Simply emitting a null result is not enough, because `result: null` is already overloaded. The 304 path emits exactly `{ result: null, pageId }`, and the worker's implicit fall-through is what makes that correct — "unchanged, keep what you have". An empty 200 would emit an identical event and silently inherit that meaning, which is wrong: a 304 is the server saying *nothing changed*, while an empty 200 is the server saying *here it is, and it is empty*. Those are different statements and must not share a representation.

The event therefore carries an explicit outcome rather than leaving the worker to infer one from a null and a `deleted` boolean. The outcomes are the ones this specification already enumerates — stored, unchanged, absent, empty, skipped, failed — so the code and the spec describe the same taxonomy, and `pagesIndexed` becomes simply the count of `stored`.

### Decision: an empty page is stored as empty, unless the pipeline failed

A 200 response that yields no extractable text is a statement about the page, not an absence of information. It should be recorded as what it is: a page that exists and has no content. Preserving the previous content in that situation is the same category error as treating it like a 304.

The etag question splits along the same line, and the split is what makes this safe. An etag describes *the response*; what we store describes *our extraction of it*. Those agree unless extraction failed:

```
  pipeline ran clean, produced nothing
      the page really is empty; the etag honestly describes that state
      → store the empty page AND the etag
      → next refresh gets 304, page stays empty. Correct, and cheap.

  pipeline errored (conversion threw, render timed out)
      we learned nothing about the page's content
      → storing the etag would cache OUR failure against THEIR content hash
      → next refresh gets 304 and never retries. The failure latches forever.
```

`processed.errors` already distinguishes them and is currently only logged. So:

| pipeline | content | stored | etag |
|---|---|---|---|
| clean | present | replaced | yes |
| clean | empty | empty page | yes |
| errored | empty | previous content left alone | **no**, so it retries |

Withholding the etag on failure is what keeps a transient problem transient. The page is re-fetched unconditionally on the next refresh and recovers as soon as extraction works.

One implementation obstacle: `addDocuments` returns early when `chunks.length === 0`, before the page row, title, etag and `last_modified` are written. Storing an empty page therefore writes nothing at all today, not even the page record. The row insert has to move above that guard.

A pipeline that errors *and* produces content is a different problem — it currently stores the raw markup — and belongs to the separate issue tracking HTML-to-Markdown conversion failures, not here.

### Decision: "Indexed" is a separate number, not part of the fraction

Pages that produce stored content are a subset of pages processed, and the difference is genuinely interesting — it is 404s, conditional hits, skipped resources, and failures. Folding it into the fraction is what caused the original confusion. Reporting it alongside answers the reporter's question directly:

```
  today       806 / 1000 pages        confusing: never completes,
                                      and 1000 contradicts "2158 discovered"

  after       ████████████ 100%       bar: processed / enqueued
              436 indexed · 806 processed
              2158 discovered (capped at 1000)   shown only when capped
```

### Decision: `pagesScraped` means processed, `pagesIndexed` is new

Two options were considered. They differ in what an existing MCP consumer sees.

```
  Option A — restore the original meaning, add the new number
  ─────────────────────────────────────────────────────────────
    pagesScraped   →  processed   (was: content-producing)
    NEW pagesIndexed →  content-producing

    + literally restores the Aug 2025 design
    + the field paired with totalPages is the one that reaches it
    − pagesScraped changes value for every existing MCP consumer;
      it has meant "content-producing" for ten months

  Option B — leave the existing field alone, add the new number
  ─────────────────────────────────────────────────────────────
    pagesScraped   →  content-producing  (unchanged, now documented)
    NEW pagesProcessed →  processed

    + no external value changes; existing consumers unaffected
    + matches what pagesScraped has actually meant since Nov 2025,
      so users' mental model is already correct
    − the field named "scraped" is not the one that drives the bar
    − does not restore anything; it documents the accident and
      works around it
```

**Chosen: A.** The current meaning of `pagesScraped` was never documented, never intentional, and arrived inside a database-migration commit. Preserving it would preserve a mistake, and the field name reads as "processed" far more naturally than as "indexed". The compatibility cost is real but narrow: the value an MCP consumer reads grows to include 404s, conditional hits, skips, and ignored failures, all of which are work the job genuinely did.

### Decision: the indexed count is persisted alongside the others

`progressPages` and `progressMaxPages` survive restarts. The new counter is persisted the same way, through the same code path, with the same lifecycle.

The alternative was to leave it live-only and derive the post-completion value from the store's existing per-version page count (`counts.uniqueUrls`, rendered by `LibraryDetail.tsx:86`). That would have avoided a migration, but it would leave one of four counters behaving unlike the other three — present during a run, absent afterwards, reconstructed from a different source with its own subtly different definition. A future reader finding three persisted counters and one that vanishes would reasonably assume it had been forgotten.

Symmetry is worth a migration here. All four counters are written and read the same way, and there is no second definition of "indexed" to keep in agreement.

### Decision: `totalDiscovered` is already correct and stays as it is

Of the three counters, `totalDiscovered` is the only one whose TSDoc is accurate: "Total number of URLs discovered during crawling. This may be higher than totalPages if maxPages limit is reached." Its behaviour matches. The spec should record the meaning it already has rather than change it.

Its usefulness is narrow — it only says something the denominator does not when `maxPages` clamps the crawl. The UI should show it on that condition rather than always, which is a presentation decision, not a semantic one.

### Decision: fix the naming the wrong TSDoc produced

`93a6ee3` described the denominator as the configured `maxPages` limit, and the surrounding code adopted that framing: `progressMaxPages` in `PipelineManager` and the store schema, `maxPages` in the web `jobPageCounts()` return, `/** Maximum number of pages to process. */` in `pipeline/types.ts`. None of these carry a configured limit.

The most consequential instance is telemetry, which reports `maxPagesConfigured: job.progressMaxPages || 0`. That is a discovery count labelled as user configuration, so any analysis of how people configure `maxPages` is measuring something else entirely. It should read the resolved config value.

## Risks / Trade-offs

**`maxPages` stops bounding total work, which it was never meant to do.** The limit is a request for pages, not a budget for effort; that it also capped work was a side effect of the numerator and the gate being the same variable. Gating on indexed pages removes the side effect, so a site with ten thousand links and fifty indexable pages will walk further under `maxPages: 100` than it does today. The crawl still terminates — the queue is bounded by scope, depth and site size — and `filter-unprocessable-content` removes the dominant source of processed-but-not-indexed items before they are ever queued, 1087 of them in the measured crawl. That is the main reason it should land first.

**The unclamped initialisation breaks the invariant on its own.** `totalDiscovered` and `effectiveTotal` are both initialised to `queue.length` before `maxPages` is resolved, and the clamp guards only later increments. Refreshing a version with 1500 stored pages whose options were lost, so `maxPages` falls back to 1000, leaves the bar reading 1000 / 1500 forever — the exact defect this change exists to remove, arriving through a path the change would otherwise not touch. The fix is to resolve `maxPages` above the initialisation and clamp both assignments.

**The invariant does not survive abnormal termination, by design.** Cancellation, the failure-rate abort, and a rethrow at depth 0 all end a crawl with the numerator below the denominator. These are stated as out of scope rather than papered over; a cancelled job should not claim to have completed.

**A test asserts the current defect.** `LocalFileStrategy.test.ts:118-200` sets up a directory with three files and asserts the job finishes at `pagesScraped: 3, totalPages: 4`. The fourth item is the directory itself, which yields links but no content, so it inflates the denominator and never advances the numerator. Under this change it becomes `4 / 4`. The diff will look like a weakened assertion to anyone reading quickly, so the commit message should name it explicitly.

**Roughly twenty fixture sites move together.** `PipelineManager.test.ts`, `PipelineWorker.test.ts`, `ListJobsTool.test.ts`, `EventBusService.test.ts`, `ScrapeTool.test.ts` and two e2e suites construct progress events by hand. Most need a mechanical field addition. `BaseScraperStrategy.test.ts:43-89` compares the whole event by equality and will fail on any shape change at all.

**Persisted values change meaning without changing shape.** A job row written before this change and read after it carries numbers that mean something slightly different. They remain plausible, which makes the discrepancy quiet. Worth deciding whether in-flight jobs at upgrade time need any handling, or whether the next scrape simply overwrites them.

**The bar can still appear to stall.** Reaching the denominator is not the same as moving smoothly toward it. `effectiveTotal` grows as the crawl discovers links, so early progress can go backwards in percentage terms even while the numerator rises. That is honest behaviour for a queue-based measure and this change does not try to smooth it, but it is worth stating so it is not reported as a regression.

## Migration Plan

One column is added to the persisted job progress record for the indexed count, following the pattern established by `harden-migration-workflow`.

Existing rows default to null, not zero. A job written before this change genuinely does not know how many of its pages produced content, and zero would assert something false — that it indexed nothing. Consumers render null as unknown, and the value is populated on the next scrape or refresh of that library version.

The counter semantics themselves need no migration. They take effect on the next scrape, and previously completed jobs keep the numbers they were written with, now interpreted under the corrected definitions. Those older values remain plausible under the new reading, which makes the discrepancy quiet rather than visible; it is bounded, since it only affects rows that are overwritten the next time the library is indexed.
