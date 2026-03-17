## Context

The [llms.txt specification](https://llmstxt.org/) is an emerging standard where websites place a `/llms.txt` Markdown file at their root containing a curated list of the most important documentation pages. The spec also proposes that pages offer clean Markdown at `url.md`. This change integrates llms.txt awareness into the existing web scraping pipeline.

**Constraints:**
- We do NOT run our own LLM. We only ingest, chunk, and serve documents.
- The llms.txt file is useful only at ingestion time, not at query time.
- The feature must be transparent and automatic with graceful fallback.

## Goals / Non-Goals

- Goals:
  - Automatically detect llms.txt and use its URLs to seed the crawl queue
  - Prefer `.md` variants of URLs discovered via llms.txt
  - No new user-facing parameters required (automatic behavior)
  - Graceful fallback to normal BFS when llms.txt is absent
- Non-Goals:
  - Generating llms.txt files
  - Producing monolithic context files (llms-ctx.txt)
  - Using llms.txt at query/search time
  - Replacing the BFS crawl entirely (llms.txt seeds the crawl, links are still followed)
  - Storing llms.txt metadata (project summary, sections) as library-level data (future enhancement)

## Decisions

### Decision 1: Probe location within WebScraperStrategy

llms.txt detection happens inside `WebScraperStrategy`, not as a separate strategy in `ScraperRegistry`.

**Rationale:** Unlike GitHub/npm/PyPI strategies, llms.txt is not identifiable from the input URL pattern. The user passes a documentation URL, not the llms.txt URL itself. A separate strategy would have no reliable `canHandle()` signal. Instead, the probe is a pre-crawl step within the existing web strategy.

**Alternatives considered:**
- New `LlmsTxtScraperStrategy`: Rejected — no URL-based trigger, would require a new dispatch mechanism.
- New `source` parameter on `ScraperOptions`: Rejected — adds user-facing complexity. Automatic detection is simpler and serves the common case.

### Decision 2: Probe order — parent directory first, then root

When the user provides `https://docs.example.com/docs/getting-started`, probe:
1. `https://docs.example.com/docs/llms.txt` (parent directory of input URL path — always strip the last path segment)
2. `https://docs.example.com/llms.txt` (site root)

Stop at first successful probe. Note: this derivation intentionally does NOT reuse `computeBaseDirectory()` from `src/scraper/utils/scope.ts`, which has different heuristics for file-vs-directory detection. For probe purposes, we always strip the last segment to get the parent directory, since the user's input URL is typically a page within a docs section.

**Rationale:** The spec says `/llms.txt` at the root but also mentions "(or, optionally, in a subpath)". Documentation often lives under a subpath (e.g., `/docs/`), and a subpath llms.txt is more targeted. Probing the subpath first gives us the most relevant file.

### Decision 3: Seeds supplement BFS, they do not replace it

URLs from llms.txt are added to the crawl queue at depth 0. Normal BFS link-following continues from these pages. The existing `maxPages`, `maxDepth`, scope, and pattern filters all apply.

**Rationale:** llms.txt files are curated but not exhaustive. Many relevant pages (sub-pages, API references, examples) may not be listed but are linked from the listed pages. Seeding + following gives the best coverage. The existing `maxPages` cap prevents runaway crawling.

### Decision 4: .md URL preference uses content-type validation

When fetching a page from llms.txt, try `url.md` (or `url/index.html.md` for directory URLs) first. Accept the `.md` response only if:
- HTTP status is 200
- Content-Type indicates text (`text/markdown`, `text/plain`, or similar)

Otherwise, fall back to the original URL.

**Rationale:** Some servers may return a 200 with an HTML error page for the `.md` URL. Content-type validation prevents treating HTML as raw Markdown.

### Decision 5: llms.txt itself is not indexed as a document

The llms.txt file is consumed for its URL list but is not processed through the content pipeline and stored as a document chunk. It is a meta-file, not documentation. The exclusion is hardcoded in URL filtering logic, not via configurable exclude patterns, to ensure it remains active even when users provide custom `excludePatterns`.

**Rationale:** Indexing llms.txt would create chunks containing link lists that pollute search results. Its value is in the URLs it contains, not its content. Relying on `defaultPatterns.ts` would be fragile since `getEffectiveExclusionPatterns()` replaces defaults entirely when the user provides custom patterns.

### Decision 6: No llms.txt probe during refresh

Refresh operations (`isRefresh: true`) use a pre-populated queue from the database (previously scraped pages with ETags for conditional requests). The llms.txt probe is skipped during refresh because introducing new seed URLs into a refresh would add pages the user did not previously index, which is unexpected behavior for a "refresh existing content" operation.

**Rationale:** Refresh is about updating existing content, not discovering new pages. If the user wants to re-index with llms.txt discovery, they should run a fresh scrape.

## Risks / Trade-offs

- **Extra HTTP request**: Every web scrape job makes 1-2 additional HTTP requests (llms.txt probe). This adds ~100-500ms latency at the start of a scrape.
  - Mitigation: The probe is a single small GET request. The overhead is negligible compared to the total scrape duration.

- **Outdated llms.txt**: The llms.txt file may not reflect current site structure (broken links, removed pages).
  - Mitigation: URLs from llms.txt go through the normal crawl pipeline. Broken links result in 404s and are skipped like any other broken link in BFS.

- **Scope conflicts**: llms.txt may list URLs outside the user's intended scope (e.g., external links to GitHub, Starlette docs).
  - Mitigation: All URLs are filtered through the existing `shouldProcessUrl()` which enforces scope + include/exclude patterns. Out-of-scope URLs are silently dropped.

- **`.md` URL returning wrong content**: A server may serve different content at `url.md` than at `url`.
  - Mitigation: Content-type validation. The `.md` preference is best-effort, not critical.

### Decision 7: Accept: text/markdown content negotiation on all web fetches

All HTTP requests made by the web scraper SHALL include `Accept: text/markdown, text/html;q=0.9, */*;q=0.8` as the Accept header. When a server responds with `Content-Type: text/markdown` (or `text/plain` with Markdown content), the response body is treated as Markdown and bypasses HTML-to-Markdown conversion.

This is independent of the `.md` URL preference (Decision 4). Content negotiation applies to **all** web-scraped pages, not just llms.txt-discovered pages.

**Rationale:** Cloudflare's [Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/) feature and similar server-side implementations convert HTML to Markdown on the fly when the client requests `text/markdown` via the standard HTTP Accept header. This is a zero-cost optimization: servers that don't support it simply ignore the header and return HTML as usual. The benefit is significant — Cloudflare reports ~80% token reduction and cleaner content structure. By requesting Markdown upfront, we avoid lossy client-side HTML-to-Markdown conversion when the server can provide authoritative Markdown.

**Alternatives considered:**
- Only use content negotiation for llms.txt pages: Rejected — the benefit applies to any page from a server that supports it. There's no reason to limit it.
- Use content negotiation _instead of_ `.md` URL preference: Rejected — the `.md` URL convention from the llms.txt spec predates and is independent of server-side content negotiation. Many static sites host `.md` files without implementing Accept header negotiation. Both mechanisms should coexist.

**Interaction with Decision 4 (.md URL preference):**
For llms.txt-discovered pages, the fetch order is:
1. Try `.md` URL variant (per Decision 4), with `Accept: text/markdown` header
2. If `.md` fails, fetch original URL with `Accept: text/markdown` header
3. If server returns HTML despite the Accept header, process through normal HTML pipeline

For non-llms.txt pages, only steps 2-3 apply.

### Decision 8: x-markdown-tokens response header

The `x-markdown-tokens` header returned by Cloudflare (and potentially other servers) indicating estimated token count is noted but NOT consumed in this change. It may be useful in the future for chunking strategy or context window management. No code is required for this decision.

## Open Questions

- Should we store the llms.txt project summary (blockquote) as library-level metadata in the database? This could be useful for search context but requires a schema change. Deferred to a future proposal.
- Should there be an opt-out mechanism (e.g., `ignoreLlmsTxt: true` on `ScraperOptions`)? Not implemented initially since the feature is transparent and non-breaking. Can be added later if needed.
