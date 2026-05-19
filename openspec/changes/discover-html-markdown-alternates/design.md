## Context

The current web scraper fetches a URL, selects a content pipeline by MIME type, and sends HTML through `HtmlPipeline`. That pipeline can run Playwright for `scrapeMode=playwright` or `scrapeMode=auto`, then parses the resulting HTML with Cheerio, extracts links and metadata, sanitizes, normalizes, and converts to Markdown.

The llms.txt branch already improves Markdown ingestion by probing `llms.txt`, trying implicit `.md` variants for llms.txt pages, and requesting `Accept: text/markdown`. HTML alternate links are complementary: a page can explicitly advertise a Markdown representation with standard markup such as `<link rel="alternate" type="text/markdown" href="page.md">`.

The important placement constraint is performance. Alternate discovery must happen before expensive HTML processing. If the raw fetched HTML declares a usable Markdown alternate, the scraper should fetch and process that alternate instead of running Playwright or converting the original HTML.

## Goals / Non-Goals

**Goals:**
- Discover Markdown alternates from raw HTML before Playwright, sanitization, normalization, and HTML-to-Markdown conversion.
- Treat a validated Markdown alternate as the content representation for the original HTML page.
- Preserve the original page URL as the crawl/document identity unless the existing store semantics require using the final fetched alternate source.
- Reuse existing fetcher, redirect handling, scope checks, custom follow-link policy, and outbound access policy.
- Fall back to normal HTML processing on absent, invalid, blocked, unsupported, or failed alternates.

**Non-Goals:**
- Discover or process RSS/Atom feeds, PDF alternates, print views, translations, alternate stylesheets, or generic alternate HTML pages.
- Add user-facing configuration.
- Change `llms.txt` parsing or probe behavior.
- Index both the original HTML page and the Markdown alternate as separate documents when the alternate is used as the representation of the page.

## Decisions

### Decision 1: Extract alternates in WebScraperStrategy before pipeline selection

Alternate discovery SHALL happen in the web strategy after the initial fetch returns an HTML response and before selecting `HtmlPipeline`.

**Rationale:** `HtmlPipeline` is intentionally a full HTML processing pipeline and may run Playwright first. If alternate discovery lives inside the existing standard middleware stack, it is too late to avoid the expensive work. Keeping it in the web strategy lets the scraper choose a Markdown response before invoking any HTML pipeline middleware.

**Alternatives considered:**
- Add a new `HtmlAlternateExtractorMiddleware` before existing HTML middleware: Rejected because middleware is only reached after `HtmlPipeline` selection and, in current ordering, after optional Playwright.
- Add alternate extraction to `HtmlLinkExtractorMiddleware`: Rejected because it runs after metadata extraction and still cannot replace the fetched content before conversion.

### Decision 2: Use a cheap raw-HTML parser, not browser rendering

The implementation SHOULD parse the raw HTML response body directly with Cheerio or a small utility to inspect `<head>` links. It MUST NOT require Playwright execution to discover alternate links.

**Rationale:** `<link rel="alternate">` is declarative metadata normally present in the document head. Running JavaScript to discover it would erase the primary benefit of this feature. Sites that inject alternates only after client-side rendering will fall back to normal HTML processing.

### Decision 3: Only Markdown typed alternates are eligible

The scraper SHALL consider only alternate links whose `rel` token list includes `alternate`, whose `href` resolves to HTTP(S), and whose `type` attribute is a known Markdown MIME type: `text/markdown`, `text/x-markdown`, `text/mdx`, or `text/x-gfm`.

Links SHALL be ignored when `rel` also includes `stylesheet`, or when `type` indicates RSS, Atom, PDF, HTML, CSS, JavaScript, or any non-Markdown format.

**Rationale:** The HTML `alternate` relationship is broad. It covers feeds, translations, print views, PDFs, stylesheets, and other reformulations. Restricting to explicit Markdown MIME types avoids crawling unrelated alternates and avoids duplicate HTML pages.

**Alternative considered:** Infer Markdown from `.md` path when `type` is missing. Rejected initially because this broadens behavior beyond the standard signal and can misclassify ordinary links. The existing llms.txt `.md` preference already covers its specific convention.

### Decision 4: Validate fetched alternate content before using it

The `type` attribute is advisory. After fetching an alternate, the scraper SHALL use it only if the actual response status is success and the response MIME type is Markdown. The implementation MAY accept `text/plain` only if it applies the same conservative Markdown heuristic already used elsewhere, or if a future requirement explicitly allows it.

If validation fails, the scraper SHALL fall back to the original HTML response and process it normally.

**Rationale:** Servers can misconfigure `type`, redirects can land on HTML error pages, and stale alternates can return non-Markdown content. Response validation keeps the behavior safe and reversible.

### Decision 5: Alternate URLs are representations, not independent crawl links

When a Markdown alternate is accepted, it represents the original page for indexing. The scraper SHOULD avoid enqueueing or storing both the original HTML URL and the alternate URL as separate pages solely because of the alternate relation.

Links extracted from the accepted Markdown content SHALL continue through normal link filtering and crawling.

**Rationale:** Treating the alternate as just another link creates duplicate content and pollutes search results. The relationship says the resources are alternate representations of the same document, not two separate docs to index.

### Decision 6: Preserve existing policy boundaries

Alternate href resolution SHALL respect `<base href>` using the same cautious base handling as HTML link extraction where practical. Resolved alternate URLs SHALL pass existing scope checks, optional custom follow-link policy, and outbound access policy before use.

**Rationale:** Alternate discovery must not become a bypass for subpage scope, include/exclude patterns, private-network blocking, host/CIDR allowlists, TLS policy, redirect validation, or caller-provided link restrictions.

### Decision 7: Ordering with llms.txt Markdown URL preference

For pages marked as discovered from llms.txt, the implicit `.md` variant preference remains the first attempt. If that attempt fails and the original URL fetch returns HTML, HTML Markdown alternate discovery MAY then run before normal HTML processing.

For pages not discovered from llms.txt, the scraper fetches the original URL with Markdown-preferred `Accept`; if the server returns HTML, HTML Markdown alternate discovery runs before normal HTML processing.

**Rationale:** The llms.txt change already defines a specific `.md` convention for llms-discovered pages. Explicit HTML alternates should complement, not replace, that behavior.

## Risks / Trade-offs

- **Extra HTTP request for pages with candidate alternates** -> Only fetch alternates when an explicit Markdown-typed alternate is present. Pages without candidates pay only cheap parsing cost.
- **False positives from incorrect `type` attributes** -> Validate the actual response MIME type before using the alternate.
- **Missed alternates injected by JavaScript** -> Accept this trade-off to avoid Playwright. Those pages continue through normal HTML processing.
- **Ambiguous document source identity** -> Prefer indexing the alternate content as the original page representation to avoid duplicates; tests should pin the chosen store behavior.
- **Interaction with `<base href>` edge cases** -> Reuse the existing cautious base resolution pattern from HTML link extraction where possible.
