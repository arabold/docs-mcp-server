## ADDED Requirements

### Requirement: Automatic llms.txt detection

The system SHALL automatically probe for an `llms.txt` file during web scraping and refresh operations when using the web scraper strategy. The probe SHALL run before the normal BFS crawl begins. The probe SHALL derive candidate URLs by extracting the parent directory of the input URL path (stripping the last path segment regardless of whether it looks like a file or directory — e.g., `https://example.com/docs/getting-started` yields `https://example.com/docs/llms.txt`, and `https://example.com/docs/` yields `https://example.com/docs/llms.txt`). If the subpath probe fails, the system SHALL fall back to the site root (`https://example.com/llms.txt`). Probing SHALL stop at the first successful response (HTTP 200 with valid llms.txt content). If no `llms.txt` is found (HTTP 404, network error, or invalid content), the system SHALL proceed with normal BFS crawling from the original URL without error.

The system SHALL use the existing fetcher path and shared outbound access policy for llms.txt probes, including redirect-target validation, DNS-resolved IP validation, configured host/CIDR allowlists, private-network blocking, and TLS policy.

#### Scenario: llms.txt found at subpath
- **WHEN** the user initiates a scrape of `https://docs.example.com/docs/guide`
- **AND** `https://docs.example.com/docs/llms.txt` returns HTTP 200 with valid llms.txt content
- **THEN** the system SHALL parse the llms.txt file and use its URLs as crawl seeds
- **AND** the system SHALL NOT probe `https://docs.example.com/llms.txt`
- **AND** the system SHALL log the discovery at info level

#### Scenario: llms.txt found at site root
- **WHEN** the user initiates a scrape of `https://docs.example.com/docs/guide`
- **AND** `https://docs.example.com/docs/llms.txt` returns HTTP 404
- **AND** `https://docs.example.com/llms.txt` returns HTTP 200 with valid llms.txt content
- **THEN** the system SHALL parse the llms.txt file and use its URLs as crawl seeds
- **AND** the system SHALL log the discovery at info level

#### Scenario: llms.txt not found
- **WHEN** the user initiates a scrape of `https://docs.example.com/docs/guide`
- **AND** both `https://docs.example.com/docs/llms.txt` and `https://docs.example.com/llms.txt` return HTTP 404 or error
- **THEN** the system SHALL proceed with normal BFS crawling from the original URL
- **AND** the system SHALL log the probe failures at debug level

#### Scenario: llms.txt probe during non-web strategy
- **WHEN** the scrape uses a non-web strategy (GitHub, npm, PyPI, local file)
- **THEN** the system SHALL NOT probe for llms.txt

#### Scenario: llms.txt probe during refresh
- **WHEN** the user performs a refresh operation (`isRefresh` is true) with a pre-populated queue
- **THEN** the system SHALL probe for llms.txt
- **AND** accepted llms.txt links SHALL be eligible for queueing after the depth-0 canonical scope base is established

#### Scenario: llms.txt probe blocked by access policy
- **WHEN** a candidate llms.txt URL is blocked by the outbound access policy
- **THEN** the system SHALL treat that candidate as a probe failure
- **AND** the system SHALL NOT bypass the configured network policy to fetch it

#### Scenario: llms.txt probe runs before root page processing
- **WHEN** the user initiates a web scrape
- **THEN** the system SHALL probe for llms.txt before fetching the original input URL as a crawl page
- **AND** a successful probe SHALL make accepted llms.txt links available as fallback crawl seeds if the original input URL cannot be indexed

### Requirement: llms.txt Markdown parser

The system SHALL provide a parser for the llms.txt Markdown format as defined by the [llms.txt specification](https://llmstxt.org/). The parser SHALL extract the following from a valid llms.txt file:
- Project name (H1 heading) - required
- Project summary (blockquote immediately after H1) - optional
- Sections (H2 headings) with their link lists - optional
- Each link: URL (required), title (required), description (optional), and whether it belongs to the `## Optional` section (boolean)

The parser SHALL return an empty result (no URLs) if the content does not contain a valid H1 heading or contains no link lists. Relative link targets SHALL be allowed in parser output; the web strategy SHALL resolve them against the discovered llms.txt URL before crawl seeding. Link targets that do not resolve to HTTP(S) URLs SHALL be ignored during web crawl seeding.

#### Scenario: Parse complete llms.txt
- **WHEN** the parser receives valid llms.txt content with an H1, blockquote, and multiple H2 sections containing link lists
- **THEN** the parser SHALL return the project name, summary, all sections with their links, and flag links under `## Optional` as optional

#### Scenario: Parse minimal llms.txt
- **WHEN** the parser receives content containing only an H1 heading and one link
- **THEN** the parser SHALL return the project name and the single link URL

#### Scenario: Parse invalid content
- **WHEN** the parser receives content that is not valid llms.txt (no H1 heading, or HTML content, or binary data)
- **THEN** the parser SHALL return an empty result with no URLs

#### Scenario: Resolve relative links during crawl seeding
- **WHEN** llms.txt at `https://docs.example.com/docs/llms.txt` contains a link target `guide/intro`
- **THEN** the web strategy SHALL resolve it to `https://docs.example.com/docs/guide/intro` before filtering and queueing

### Requirement: llms.txt URL seeding

The system SHALL add URLs extracted from a detected llms.txt file to the BFS crawl queue at depth 0, alongside the original input URL. All llms.txt URLs SHALL be filtered through the existing scope and include/exclude pattern logic via `shouldProcessUrl()`. Filtering and enqueueing SHALL occur only after the depth-0 canonical scope base has been established when the original input URL is successfully processed, so protocol/host updates caused by the start URL's redirect are applied consistently with normal BFS link discovery while the user-provided path remains the scope anchor. If the original input URL returns `NOT_FOUND` but a valid llms.txt probe produced accepted URLs, the system SHALL continue crawling those accepted llms.txt URLs instead of failing the scrape immediately; in that fallback case, filtering SHALL use the user-provided input URL as the scope base. URLs that do not pass filtering SHALL be silently dropped. The BFS crawl SHALL continue normally from seeded pages, following discovered links subject to `maxPages`, `maxDepth`, and all other existing constraints.

#### Scenario: URLs seeded and crawled with link following
- **WHEN** llms.txt lists 5 documentation URLs
- **AND** 3 of those URLs are within the configured scope
- **THEN** the system SHALL add the 3 in-scope URLs to the crawl queue at depth 0
- **AND** the system SHALL follow links discovered on those pages (normal BFS behavior)
- **AND** the original input URL SHALL also remain in the queue

#### Scenario: llms.txt URLs respect maxPages
- **WHEN** llms.txt lists 50 URLs
- **AND** `maxPages` is set to 10
- **THEN** the system SHALL process at most 10 pages total (including the original URL and any llms.txt-seeded URLs)

#### Scenario: Duplicate URL deduplication
- **WHEN** llms.txt lists a URL that is the same as the original input URL (after normalization)
- **THEN** the system SHALL not add a duplicate entry to the crawl queue

#### Scenario: llms.txt URLs outside subpages scope are dropped
- **WHEN** the user scrapes `https://docs.example.com/docs/guide` with default scope `subpages`
- **AND** llms.txt lists `https://docs.example.com/api/reference` (outside the `/docs/` subpath)
- **THEN** the system SHALL silently drop the out-of-scope URL
- **AND** only seed URLs that pass the existing `shouldProcessUrl()` check

#### Scenario: llms.txt URLs use post-redirect scope base
- **WHEN** the user scrapes `http://example.com/docs`
- **AND** the depth-0 response redirects to `https://www.example.com/docs/`
- **AND** llms.txt lists `https://www.example.com/docs/guide`
- **THEN** the listed URL SHALL be evaluated against the post-redirect protocol and host
- **AND** it SHALL be eligible for queueing when it otherwise passes scope and pattern filters

#### Scenario: Root page not found but llms.txt contains crawlable URLs
- **WHEN** the llms.txt probe returns valid content with at least one URL that passes scope and pattern filtering
- **AND** fetching the original input URL returns `NOT_FOUND`
- **THEN** the system SHALL continue crawling the accepted llms.txt URLs
- **AND** the scrape SHALL NOT fail with a root-page-not-found error solely because the original input URL was not found

#### Scenario: Root page not found and llms.txt has no accepted URLs
- **WHEN** the llms.txt probe finds no valid file or no URLs that pass scope and pattern filtering
- **AND** fetching the original input URL returns `NOT_FOUND`
- **THEN** the system SHALL fail the normal scrape with a root-page-not-found error

### Requirement: Markdown content negotiation

The web scraper SHALL default HTTP(S) web page fetch requests to include `Accept: text/markdown, text/html;q=0.9, */*;q=0.8` unless the caller supplied an explicit `Accept` or `accept` header. This default SHALL apply to llms.txt probes, the original input URL, llms.txt `.md` variant attempts, llms.txt original-URL fallbacks, and normal BFS page fetches. When a server responds with a Markdown MIME type (`text/markdown`, `text/x-markdown`, `text/mdx`, or `text/x-gfm`), the system SHALL treat the response body as Markdown and bypass HTML-to-Markdown conversion. When the server responds with `Content-Type: text/html` (ignoring the Markdown preference), the system SHALL process the response through the normal HTML pipeline. This content negotiation applies to all web-scraped pages regardless of whether they were discovered via llms.txt or BFS link-following.

#### Scenario: Server returns Markdown via content negotiation
- **WHEN** fetching any web page with the `Accept: text/markdown` header
- **AND** the server responds with HTTP 200 and `Content-Type: text/markdown`
- **THEN** the system SHALL use the response body as Markdown directly
- **AND** the content SHALL be processed through the Markdown pipeline (not the HTML pipeline)

#### Scenario: Caller-supplied Accept header is preserved
- **WHEN** a web scrape is invoked with a custom `Accept` header in `ScraperOptions.headers`
- **THEN** the system SHALL preserve the caller-provided value
- **AND** it SHALL NOT overwrite it with the default Markdown-preferred Accept header

#### Scenario: Server ignores Accept header and returns HTML
- **WHEN** fetching any web page with the `Accept: text/markdown` header
- **AND** the server responds with HTTP 200 and `Content-Type: text/html`
- **THEN** the system SHALL process the response through the normal HTML-to-Markdown pipeline

#### Scenario: Generic text/plain remains plain text
- **WHEN** fetching a normal web page with the `Accept: text/markdown` header
- **AND** the server responds with HTTP 200 and `Content-Type: text/plain`
- **THEN** the system SHALL process the response through the normal text pipeline unless the implementation can conservatively identify it as Markdown content

### Requirement: Markdown URL preference for llms.txt pages

When fetching a page that was discovered via llms.txt, the system SHALL first attempt to fetch the Markdown variant of the URL before falling back to the original URL. Variant construction SHALL use these path rules: paths ending in `/` append `index.html.md`; paths whose last segment has no `.` append `/index.html.md`; paths whose last segment contains `.` append `.md`. For example, `/guide/` and `/guide` both become `/guide/index.html.md`, while `/guide.html` becomes `/guide.html.md`. The `.md` variant request SHALL include the default Markdown-preferred `Accept` header unless the caller supplied an explicit `Accept` header. The system SHALL accept the `.md` response only if the HTTP status is 200 and the Content-Type is a known Markdown MIME type (`text/markdown`, `text/x-markdown`, `text/mdx`, `text/x-gfm`) or `text/plain`. If the `.md` URL fails (non-200 status, unsupported content type, access-policy rejection, or network error), the system SHALL fall back to fetching the original URL (which also uses content negotiation). Pages discovered via normal BFS link-following (not from llms.txt) SHALL NOT attempt the `.md` variant.

#### Scenario: Successful .md fetch
- **WHEN** fetching a page listed in llms.txt at `https://example.com/docs/guide.html`
- **AND** `https://example.com/docs/guide.html.md` returns HTTP 200 with `Content-Type: text/markdown`
- **THEN** the system SHALL use the Markdown content from the `.md` URL
- **AND** the content SHALL be processed through the Markdown pipeline (not the HTML pipeline)

#### Scenario: .md URL not available, fallback uses content negotiation
- **WHEN** fetching a page listed in llms.txt at `https://example.com/docs/guide.html`
- **AND** `https://example.com/docs/guide.html.md` returns HTTP 404
- **THEN** the system SHALL fall back to fetching `https://example.com/docs/guide.html` with the `Accept: text/markdown` header
- **AND** if the server responds with `Content-Type: text/markdown`, use the Markdown content directly
- **AND** if the server responds with `Content-Type: text/html`, process it through the normal HTML pipeline

#### Scenario: .md URL returns HTML (misconfigured server)
- **WHEN** fetching a page listed in llms.txt at `https://example.com/docs/guide.html`
- **AND** `https://example.com/docs/guide.html.md` returns HTTP 200 but with `Content-Type: text/html`
- **THEN** the system SHALL reject the `.md` response
- **AND** fall back to fetching the original URL

#### Scenario: .md URL returns non-Markdown text
- **WHEN** fetching a page listed in llms.txt at `https://example.com/docs/styles.css`
- **AND** `https://example.com/docs/styles.css.md` returns HTTP 200 but with `Content-Type: text/css`
- **THEN** the system SHALL reject the `.md` response
- **AND** fall back to fetching the original URL

#### Scenario: Non-llms.txt pages skip .md attempt
- **WHEN** fetching a page discovered via normal BFS link-following (not from llms.txt)
- **THEN** the system SHALL NOT attempt the `.md` URL variant
- **AND** the system SHALL still use content negotiation via the `Accept: text/markdown` header

#### Scenario: .md URL for directory-like URL
- **WHEN** fetching a page listed in llms.txt at `https://example.com/docs/guide/`
- **AND** `https://example.com/docs/guide/index.html.md` returns HTTP 200 with `Content-Type: text/markdown`
- **THEN** the system SHALL use the Markdown content from the `index.html.md` URL

#### Scenario: .md URL for extensionless directory-like URL
- **WHEN** fetching a page listed in llms.txt at `https://example.com/docs/guide`
- **AND** `https://example.com/docs/guide/index.html.md` returns HTTP 200 with `Content-Type: text/markdown`
- **THEN** the system SHALL use the Markdown content from the `index.html.md` URL

### Requirement: llms.txt file exclusion from indexing

The llms.txt file itself SHALL NOT be indexed as a document in the store. The exclusion SHALL be hardcoded in the URL filtering logic (not via configurable default exclude patterns), so that it remains active even when the user provides custom `excludePatterns`. If the llms.txt URL falls within the crawl scope and would normally be discovered during BFS crawling, it SHALL be excluded from content processing and storage. The exclusion SHALL match URLs whose pathname basename is exactly `llms.txt`, case-insensitive, ignoring query strings and hash fragments. It is a meta-file used for URL discovery, not documentation content.

#### Scenario: llms.txt excluded from indexing
- **WHEN** the BFS crawl encounters the llms.txt file URL during link following
- **THEN** the system SHALL skip processing and storing it as a document
- **AND** the system SHALL not count it toward the `maxPages` limit

#### Scenario: llms.txt excluded even with custom excludePatterns
- **WHEN** the user provides custom `excludePatterns` (overriding default patterns)
- **AND** the BFS crawl encounters the llms.txt file URL
- **THEN** the system SHALL still exclude llms.txt from indexing
