## Why

The web crawler fetches every in-scope link it discovers, then asks the content pipelines whether they can do anything with the result. When the answer is no, the bytes are discarded. Nothing prevents the fetch from happening in the first place.

Measured against `origin/main` at 3.1.0, scraping `https://www.brendangregg.com` with defaults (`maxPages: 1000`, `maxDepth: 3`, `maxConcurrency: 3`):

| | |
|---|---|
| URLs discovered | 2158 |
| Pages indexed | 806 |
| **Fetched, then discarded for lack of a pipeline** | **1087** |
| of which images (`.png` 478, `.jpg` 290, `.svg` 96, `.gif` 14, `.jpeg` 3) | 881 |
| Wall clock | 152s |

Sampling 60 of the discarded image URLs gave 18.2 MB, averaging ~300 KB each, with several over 1 MB (`FlameGraphs/cpu-mysql-updated.svg` at 1.05 MB, `Perf/bpf_book_tools.png` at 1.01 MB). Extrapolated across all 881, roughly 250 MB is downloaded and thrown away on a single scrape of one documentation site.

The cost is not only bandwidth. With `maxConcurrency: 3`, one multi-megabyte image occupies a third of the crawl's throughput while it downloads, which is what reporters perceive as the scrape freezing on a particular page. Issue #490 describes exactly this, naming two pages that are themselves trivial (992 and 1232 bytes) but that happened to share a batch with large images.

These links are not embedded media. Both link extractors already exclude those: `HtmlLinkExtractorMiddleware` collects only `a[href]`, and `MarkdownLinkExtractorMiddleware` excludes `![](…)` image syntax. Every one of the 881 came from a genuine `<a href="…png">`, the common pattern of linking a thumbnail to its full-size original.

Today the only extension-based guard in the crawl filter chain covers archives (`.zip`, `.tar`, `.gz`, `.tgz`). There is no guard for anything else the pipelines cannot read.

## What Changes

- Add a **pipeline capability predicate** — a single function answering "can any configured content pipeline process this MIME type?", derived by asking each pipeline from `PipelineFactory.createStandardPipelines()` its own `canProcess()`. This becomes the one place that knows what the system can read. No gate keeps its own allow-list or deny-list.

- Add a **queue-time gate**. When filtering a discovered link, detect a MIME type from the link's pathname via `MimeTypeUtils.detectMimeTypeFromPath()`. If detection is confident and the predicate rejects the type, drop the link before it is enqueued. If detection returns null (no extension, or an extension the system does not recognise), the link proceeds unchanged. This gate can only act when it is sure, and it costs no network at all.

- Add a **fetch-time gate**. `HttpFetcher` switches to a streaming response so the `Content-Type` header can be evaluated before the body is consumed. When the predicate rejects the resolved type, the response is aborted and the resource reported as skipped. This is the authoritative check: it catches extensionless URLs, and URLs whose extension does not match what the server actually serves.

- **Skipped resources are logged at `debug` only** and do not count as page failures. Without the second part, crawling an image-heavy site would push `abortOnFailureRate` past its 0.5 threshold and abort an otherwise healthy scrape.

- **No configuration flag.** The fetch-time gate applies the same predicate the pipelines already apply, only earlier, so turning it off would produce a byte-identical index more slowly. The rationale, and the one case where the queue-time gate can differ from today's behaviour, are recorded in `design.md`.

SVG is deliberately not processed. No pipeline claims `image/svg+xml`, so the predicate rejects it with no special-casing, and teaching a future pipeline that type would make both gates allow it automatically.

**Non-breaking for consumers.** No API, CLI, MCP, or configuration changes. Indexed output is unchanged except for the narrow case described under Risks in `design.md`. Progress counters visibly change — `totalDiscovered` drops as junk links stop being enqueued — but their semantics are not redefined here. That work is `define-scrape-progress-semantics`, which depends on this change landing first.

## Capabilities

### New Capabilities

- `unprocessable-content-filtering`: Defines the pipeline capability predicate as the single source of truth for what the system can read, the two gates that consult it (queue-time by path extension, fetch-time by response `Content-Type`), their ordering relative to the existing crawl filters and the outbound access policy, the treatment of skipped resources as neither content nor failures, and the deliberate absence of a configuration surface.

### Modified Capabilities

- `scraping-scope`: The "Filter ordering for discovered links" requirement gains the queue-time gate as a numbered step between the archive-extension filter and the scope check.
- `scrape-failure-policy`: Adds a requirement that resources skipped by either gate are excluded from the child-page failure-rate calculation.
- `mime-type-detection`: Extends the existing single-source-of-truth rule to cover pipeline capability, so that neither gate may hardcode MIME type knowledge.

## Impact

- **Code**:
  - New module (e.g. `src/scraper/pipelines/capability.ts`) exporting the predicate, built from the pipeline set.
  - [src/scraper/strategies/WebScraperStrategy.ts:412](src/scraper/strategies/WebScraperStrategy.ts:412) — the queue-time gate joins the existing archive-extension check in the discovered-link filter.
  - [src/scraper/fetcher/HttpFetcher.ts:141](src/scraper/fetcher/HttpFetcher.ts:141) — `responseType` moves from `"arraybuffer"` to `"stream"`; the header check and abort sit immediately after the existing `assertNetworkUrlAllowed(finalUrl)` call; the body is accumulated into a `Buffer` manually to preserve the current `RawContent` shape.
  - `src/scraper/fetcher/types.ts` — `FetchOptions` gains an optional predicate so the strategy can inject capability knowledge downward without the fetcher learning about pipelines.
  - `RawContent` (or the `FetchStatus` enum) needs a way to express "skipped", distinct from `SUCCESS`, `NOT_MODIFIED`, and `NOT_FOUND`.
  - [src/scraper/strategies/BaseScraperStrategy.ts:430](src/scraper/strategies/BaseScraperStrategy.ts:430) — the skipped status must be handled without calling `recordChildPageFailure`.
- **APIs / interfaces**: None externally. `FetchOptions` and `FetchStatus` are internal.
- **Config**: None.
- **Dependencies**: None.
- **Documentation**: A short subsection in `ARCHITECTURE.md` under the scraper section describing the predicate and the two gates.
- **Relationship to in-flight work**: `define-scrape-progress-semantics` modifies the same "Filter ordering for discovered links" requirement to move the depth check to enqueue time. It should land after this change and rebase onto the step numbering established here. `discover-html-markdown-alternates` touches `WebScraperStrategy` but not the link filter, so there is no overlap.
