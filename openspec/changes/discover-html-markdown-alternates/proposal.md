## Why

Some documentation sites advertise clean Markdown versions of HTML pages with standard HTML alternate links, such as `<link rel="alternate" type="text/markdown" href="page.md">`. The scraper should prefer those explicitly declared Markdown representations early enough to avoid expensive HTML processing, including Playwright rendering, when a trusted Markdown alternate is available.

A Markdown representation published by a site's authors is the intended machine-readable form of that page. Converting HTML to Markdown ourselves exists because most sites advertise nothing better — it is a fallback, not a peer. Whenever both are available the published Markdown wins, and that has to hold regardless of which one a crawl happens to reach first.

The same question arises from the other direction, and is already causing duplicate indexing today. When a site's llms.txt lists `.md` URLs directly — as react.dev and vite.dev both do — those URLs are crawled as pages in their own right, so a page reachable both ways is stored twice under two URLs. A local index of vite.dev holds 112 pages for 68 distinct documents: 41 are the same document under both its canonical and its `.md` URL. The two copies also differ in quality, the Markdown one being the cleaner of the pair.

Both directions are the same underlying question — whether a Markdown URL is a separate resource or another representation of a page that already has an identity — so the rule is stated once here and applies to alternate declarations and llms.txt entries alike.

## What Changes

- Add discovery for Markdown alternate representations declared by HTML `<link rel="alternate">` elements.
- Prefer a validated Markdown alternate over HTML-to-Markdown conversion for the same page.
- Run alternate discovery before expensive HTML processing steps such as Playwright, sanitization, normalization, and HTML-to-Markdown conversion.
- Preserve graceful fallback: if no acceptable alternate is declared, fetchable, or validated as Markdown, process the original HTML normally.
- Reuse existing scope checks, caller-provided follow-link policy, fetcher path, and outbound access policy for alternate URLs.
- Avoid indexing both the HTML page and its Markdown alternate as separate duplicate documents when the alternate is used as the representation of the original page.
- Establish Markdown as the preferred representation independently of encounter order, so a page reached as HTML first still ends up indexed as Markdown.
- Derive a page's identity from its extension-stripped URL when the path extension names a Markdown type **and** the response is an acceptable Markdown variant, so a `.md` URL and its canonical form resolve to one page. Requiring both signals keeps the rule a property of the response rather than of discovery order, which is what makes it safe without knowing what else the crawl has seen.

## Capabilities

### New Capabilities

- `html-markdown-alternates`: Discovers and uses explicitly advertised Markdown alternate representations for HTML pages before expensive HTML processing.

### Modified Capabilities

<!-- None. -->

## Impact

- Affected code:
  - `src/scraper/strategies/WebScraperStrategy.ts` or adjacent web scrape orchestration for early alternate selection.
  - `src/scraper/middleware/` or `src/scraper/utils/` for extracting Markdown alternate links from raw HTML.
  - `src/scraper/pipelines/HtmlPipeline.ts` only if a small pre-render parsing stage is introduced there; the preferred design should avoid running the full HTML pipeline before alternate selection.
  - `src/scraper/fetcher/` only if additional response metadata or fetch behavior is needed.
  - Tests covering alternate extraction, early fallback behavior, scope/access-policy enforcement, and duplicate avoidance.
- No new user-facing configuration is required.
- No database schema changes are required.
