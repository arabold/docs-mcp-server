## Why

Some documentation sites advertise clean Markdown versions of HTML pages with standard HTML alternate links, such as `<link rel="alternate" type="text/markdown" href="page.md">`. The scraper should prefer those explicitly declared Markdown representations early enough to avoid expensive HTML processing, including Playwright rendering, when a trusted Markdown alternate is available.

## What Changes

- Add discovery for Markdown alternate representations declared by HTML `<link rel="alternate">` elements.
- Prefer a validated Markdown alternate over HTML-to-Markdown conversion for the same page.
- Run alternate discovery before expensive HTML processing steps such as Playwright, sanitization, normalization, and HTML-to-Markdown conversion.
- Preserve graceful fallback: if no acceptable alternate is declared, fetchable, or validated as Markdown, process the original HTML normally.
- Reuse existing scope checks, caller-provided follow-link policy, fetcher path, and outbound access policy for alternate URLs.
- Avoid indexing both the HTML page and its Markdown alternate as separate duplicate documents when the alternate is used as the representation of the original page.

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
