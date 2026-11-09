# Proposal

## Why

HTML content extraction — deciding which parts of a fetched page become indexed text — is the single largest body of unspecified behavior in the scrape pipeline. It decides what every HTML-sourced chunk contains, it is tuned by hand against real documentation sites, and it has no spec. `subresource-blocklist` covers the gate before it (what is never fetched) and `markdown-features` covers the stage after it (how text becomes chunks); the extractor between them is described only by its own source comments.

That gap has a cost. Issue #504 found promotional site chrome leading the first indexed chunk on every page of a site, because the extractor had no notion of a content region and the banner matched no selector. The fix was easy; knowing whether it was *safe* meant measuring 20 sites by hand, because no document said what the extractor guarantees. The guarantees that make this stage delicate — prose that merely mentions an ad network survives, a page is never emptied, removing boilerplate never shrinks crawl reach — exist today only as tests.

## What Changes

- Add an `html-content-extraction` capability spec covering the extractor stage of the HTML pipeline: the stage that receives a parsed DOM and decides what survives into Markdown conversion.
- Codify behavior that already ships, in terms a re-implementation would have to honour:
  - The `scraper.htmlExtractor` setting and what selecting a non-default value does and does not change.
  - Removal of site chrome by category (structural landmarks, generic chrome, ARIA roles, skip links and breadcrumbs, ad and content-recommendation networks, third-party search widgets) without pinning the entries.
  - Scoping to the content region a page declares with `<main>` or `role="main"`, subject to a share-of-text floor — the #504 fix, already merged in PR #506.
  - Caller-supplied `excludeSelectors`, honoured identically whichever backend is selected.
  - The safety nets: never emit an empty document, and fall back rather than fail.
  - Extraction runs after title and link discovery, so removing boilerplate cannot shrink the crawl frontier.
- Codify the false-positive guarantees explicitly, as `subresource-blocklist` does with its category exclusions: prose and code that mention an ad hostname are content; ads are removed after render rather than blocked at the network, to avoid anti-adblock detection.
- No behavior changes. This change is documentation-only: it pins what ships today, including the already-merged #504 fix.

## Capabilities

### New Capabilities

- `html-content-extraction`: What the HTML extractor stage removes from a fetched page and what it guarantees to preserve — backend selection, chrome-removal categories, content-region scoping, caller-supplied exclusions, safety nets, and the false-positive guarantees that keep documentation prose and code intact.

### Modified Capabilities

<!-- None. No existing requirement changes. -->

## Impact

- Affected code: none. The spec describes `src/scraper/middleware/HtmlSanitizerMiddleware.ts` and the middleware ordering in `src/scraper/pipelines/HtmlPipeline.ts` as they already behave.
- Capability boundaries this spec does not cross:
  - URL normalization and tracking-pixel removal run in a later middleware and stay out of scope.
  - Network-level blocking belongs to `subresource-blocklist`; the two are complementary and the spec notes the seam without restating it.
  - Choosing a Markdown representation instead of extracting HTML belongs to `llmstxt-discovery` and the in-flight `discover-html-markdown-alternates` change.
- Tuning values — the content-region text-share floor, the alternate extractor's retention ratio, and the selector list itself — belong to `design.md` and the code, not to the spec.
- The spec deliberately binds only the default extractor. `defuddle` exists as an evaluation arm benchmarked against the default (`docs/guides/benchmarking.md`), so the requirements here are what it is measured against, not what it promises. Pinning its behavior would both defeat that comparison and invalidate the recorded reference numbers.
