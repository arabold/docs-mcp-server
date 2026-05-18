# Change: Add llms.txt discovery, Markdown URL preference, and Markdown content negotiation

## Why

BFS crawling from a root URL is noisy - it discovers nav bars, blog posts, changelogs, and marketing pages that aren't useful documentation. The [llms.txt specification](https://llmstxt.org/) is an emerging standard where websites provide a curated `/llms.txt` Markdown file listing the most important pages for LLM consumption. By automatically detecting and using this file during scraping, we can produce higher-quality indexes with less user configuration. Additionally, the spec proposes that pages offer clean Markdown at `url.md`, which would bypass our HTML-to-Markdown conversion and yield better chunks.

Separately, [Cloudflare's Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/) introduces server-side content negotiation: when a client sends `Accept: text/markdown`, supporting servers convert HTML to Markdown on the fly. This is complementary to the `.md` URL convention and benefits all web-scraped pages, not just those discovered via llms.txt. Cloudflare reports ~80% token reduction compared to raw HTML.

## What Changes

- **Automatic llms.txt probe**: `WebScraperStrategy` probes for `/llms.txt` at the site (subpath directory first, then site root) during web scrapes and refreshes. If found, listed URLs are parsed, resolved against the llms.txt URL when relative, filtered after the depth-0 scope base is established, and added to the BFS crawl queue as seeds alongside the existing queue.
- **llms.txt parser**: A new utility (`llmsTxtParser`) parses the well-defined Markdown format of llms.txt files, extracting project name, summary, section groupings, and link lists while ignoring malformed or non-HTTP(S) links during crawl seeding.
- **Markdown URL preference**: When fetching pages discovered via llms.txt, the fetcher first attempts to retrieve the `.md` variant of the URL (e.g., `page.html.md` or `guide/index.html.md`). It accepts the variant only for Markdown MIME types or `text/plain`, and falls back to the original URL otherwise.
- **Markdown content negotiation**: Web scraper HTTP(S) requests default to `Accept: text/markdown, text/html;q=0.9, */*;q=0.8` unless the caller supplied an explicit `Accept` header. When a server responds with a Markdown MIME type, the response bypasses HTML-to-Markdown conversion. This applies to all web-scraped pages, not just llms.txt-discovered ones.
- **QueueItem extension**: `QueueItem` gains an optional `fromLlmsTxt` flag so `processItem` knows which pages to try `.md` variants for.
- **Access policy**: llms.txt probes, extracted URLs, redirects, and `.md` variant fetches use the existing fetcher and shared outbound access policy, so SSRF/private-network/TLS restrictions are preserved.
- **Logging**: Discovery and usage of llms.txt is logged at info level; probe failures and `.md` fallback decisions are logged at debug level.

## Impact

- Affected specs: New capability `llmstxt-discovery` (no existing specs modified)
- Affected code:
  - `src/scraper/strategies/WebScraperStrategy.ts` (probe logic, `.md` preference in `processItem`)
  - `src/scraper/strategies/BaseScraperStrategy.ts` (minor: handle additional seed URLs)
  - `src/scraper/types.ts` (`QueueItem` extension)
  - `src/scraper/fetchers/` (Accept header addition for content negotiation, Content-Type handling)
  - New: `src/scraper/utils/llmsTxtParser.ts` (parser)
  - New: `src/scraper/utils/llmsTxtParser.test.ts` (tests)
  - `src/scraper/strategies/WebScraperStrategy.test.ts` (tests for probe, `.md` fallback, and content negotiation)
