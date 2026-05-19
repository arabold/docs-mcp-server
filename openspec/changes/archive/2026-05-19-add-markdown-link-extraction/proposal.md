## Why

Markdown content can now enter the web scraping pipeline directly through content negotiation and `.md` URL variants. The current Markdown link extractor is a no-op, so direct Markdown responses can index cleaner content but stop BFS link discovery that previously worked when the same page was processed as HTML.

## What Changes

- Implement link extraction for Markdown documents processed by `MarkdownPipeline`.
- Extract inline and reference-style Markdown links while ignoring images.
- Preserve raw link targets so scraper strategies can resolve relative URLs against the fetched document URL and apply existing scope, include/exclude, and access-policy checks.
- Keep HTML-converted Markdown behavior unchanged: HTML pages continue extracting links before `HtmlToMarkdownMiddleware`, and Markdown link extraction applies only to content that enters `MarkdownPipeline` directly.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `markdown-features`: Markdown documents SHALL expose discovered links for downstream crawling.

## Impact

- Affected code:
  - `src/scraper/middleware/MarkdownLinkExtractorMiddleware.ts`
  - `src/scraper/middleware/MarkdownLinkExtractorMiddleware.test.ts`
  - Potentially `src/scraper/strategies/WebScraperStrategy.test.ts` for content-negotiated Markdown crawl coverage
- No API or configuration changes.
- No new dependencies expected unless implementation chooses an existing Markdown parser already present in the dependency tree.
