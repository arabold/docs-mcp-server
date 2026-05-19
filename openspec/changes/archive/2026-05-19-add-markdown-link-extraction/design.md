## Context

The web scraper historically fetched documentation pages as HTML and extracted crawl links from `<a>` elements before converting HTML to Markdown for storage. With Markdown content negotiation and `.md` URL preference, the same pages can now enter `MarkdownPipeline` directly. `MarkdownLinkExtractorMiddleware` currently initializes an empty link array and does not extract Markdown links, so content-negotiated Markdown can unintentionally stop BFS discovery.

The Markdown pipeline is also used for local Markdown files and remote Markdown assets. Link extraction should benefit all Markdown inputs while continuing to rely on scraper strategies for URL resolution, scope filtering, deduplication, and access-policy enforcement.

## Goals / Non-Goals

**Goals:**

- Extract crawlable links from Markdown documents processed by `MarkdownPipeline`.
- Preserve raw link targets, including relative links, for downstream URL resolution.
- Avoid duplicate link extraction for HTML pages that are converted to Markdown after `HtmlLinkExtractorMiddleware` has already run.
- Keep existing scope, include/exclude, deduplication, and access-policy behavior centralized in scraper strategies and fetchers.

**Non-Goals:**

- Replace HTML link extraction.
- Parse and crawl every Markdown extension such as wiki links, autolinks, or raw HTML anchors in the first implementation.
- Make `llms.txt` itself indexable.
- Use `llms.txt` as a replacement for BFS crawling.

## Decisions

### Decision 1: Implement extraction inside MarkdownLinkExtractorMiddleware

`MarkdownLinkExtractorMiddleware` SHALL extract links when content is processed by `MarkdownPipeline`.

**Rationale:** This is the narrowest place that covers direct Markdown from content negotiation, `.md` variants, local Markdown files, and fetched `.md` assets. HTML pages do not use `MarkdownPipeline`; they use `HtmlPipeline`, where link extraction already happens before HTML-to-Markdown conversion. That avoids double extraction for normal HTML pages.

**Alternatives considered:**

- Extract Markdown links in `WebScraperStrategy`: rejected because local Markdown and other non-web Markdown users would not benefit.
- Reuse `llms.txt` parsing for all Markdown: rejected because llms.txt is a meta-file with a stricter list-oriented format, while general Markdown pages need broader link extraction.

### Decision 2: Extract standard Markdown links first

The first implementation SHALL extract inline links (`[text](target)`) and reference-style links (`[text][ref]` with `[ref]: target`). It SHALL ignore image links (`![alt](target)`).

**Rationale:** These forms cover the common links emitted by Markdown-for-Agents services and static Markdown docs. Keeping the first implementation focused avoids introducing a new parser dependency unless tests show regex-based extraction is insufficient.

**Alternatives considered:**

- Add a Markdown AST parser dependency: deferred. It may be valuable later for full CommonMark coverage, but the current dependency and behavior surface should stay small.

### Decision 3: Preserve raw targets and leave policy to existing layers

The middleware SHALL append raw link targets to `context.links` without resolving, normalizing, or filtering them. Existing scraper strategy code SHALL continue resolving relative links against the final document URL and applying scope, include/exclude patterns, dedupe, max depth, and access policy.

**Rationale:** This matches HTML link extraction behavior and keeps crawl policy centralized.

## Risks / Trade-offs

- Regex extraction may miss less common Markdown constructs such as nested brackets or raw HTML anchors. Mitigation: cover common inline/reference links now and consider an AST parser only if real docs require it.
- Markdown documents can contain many non-navigation links such as package badges. Mitigation: existing scope and exclude filters still control queueing; images are explicitly ignored.
- Local Markdown scraping may discover more links than before. Mitigation: this aligns behavior with HTML crawling and remains bounded by max depth/pages and scope rules.
