## ADDED Requirements

### Requirement: Automatic llms.txt detection

The system SHALL automatically probe for an `llms.txt` file before beginning BFS crawling when using the web scraper strategy. The system SHALL NOT probe for llms.txt during refresh operations (when `isRefresh` is true). The probe SHALL derive candidate URLs by extracting the parent directory of the input URL path (stripping the last path segment regardless of whether it looks like a file or directory — e.g., `https://example.com/docs/getting-started` yields `https://example.com/docs/llms.txt`, and `https://example.com/docs/` yields `https://example.com/docs/llms.txt`). If the subpath probe fails, the system SHALL fall back to the site root (`https://example.com/llms.txt`). Probing SHALL stop at the first successful response (HTTP 200 with valid llms.txt content). If no `llms.txt` is found (HTTP 404, network error, or invalid content), the system SHALL proceed with normal BFS crawling from the original URL without error.

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

#### Scenario: llms.txt probe skipped during refresh
- **WHEN** the user performs a refresh operation (`isRefresh` is true) with a pre-populated queue
- **THEN** the system SHALL NOT probe for llms.txt
- **AND** the system SHALL process only the pre-populated queue entries

### Requirement: llms.txt Markdown parser

The system SHALL provide a parser for the llms.txt Markdown format as defined by the [llms.txt specification](https://llmstxt.org/). The parser SHALL extract the following from a valid llms.txt file:
- Project name (H1 heading) - required
- Project summary (blockquote immediately after H1) - optional
- Sections (H2 headings) with their link lists - optional
- Each link: URL (required), title (required), description (optional), and whether it belongs to the `## Optional` section (boolean)

The parser SHALL return an empty result (no URLs) if the content does not contain a valid H1 heading or contains no link lists.

#### Scenario: Parse complete llms.txt
- **WHEN** the parser receives valid llms.txt content with an H1, blockquote, and multiple H2 sections containing link lists
- **THEN** the parser SHALL return the project name, summary, all sections with their links, and flag links under `## Optional` as optional

#### Scenario: Parse minimal llms.txt
- **WHEN** the parser receives content containing only an H1 heading and one link
- **THEN** the parser SHALL return the project name and the single link URL

#### Scenario: Parse invalid content
- **WHEN** the parser receives content that is not valid llms.txt (no H1 heading, or HTML content, or binary data)
- **THEN** the parser SHALL return an empty result with no URLs

### Requirement: llms.txt URL seeding

The system SHALL add URLs extracted from a detected llms.txt file to the BFS crawl queue at depth 0, alongside the original input URL. All llms.txt URLs SHALL be filtered through the existing scope and include/exclude pattern logic via `shouldProcessUrl()`. URLs that do not pass filtering SHALL be silently dropped. The BFS crawl SHALL continue normally from seeded pages, following discovered links subject to `maxPages`, `maxDepth`, and all other existing constraints.

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

### Requirement: Markdown content negotiation

The web scraper SHALL include `Accept: text/markdown, text/html;q=0.9, */*;q=0.8` in the HTTP headers of all web page fetch requests. When a server responds with `Content-Type: text/markdown` (or `text/plain` with Markdown-structured content), the system SHALL treat the response body as Markdown and bypass HTML-to-Markdown conversion. When the server responds with `Content-Type: text/html` (ignoring the Markdown preference), the system SHALL process the response through the normal HTML pipeline. This content negotiation applies to all web-scraped pages regardless of whether they were discovered via llms.txt or BFS link-following.

#### Scenario: Server returns Markdown via content negotiation
- **WHEN** fetching any web page with the `Accept: text/markdown` header
- **AND** the server responds with HTTP 200 and `Content-Type: text/markdown`
- **THEN** the system SHALL use the response body as Markdown directly
- **AND** the content SHALL be processed through the Markdown pipeline (not the HTML pipeline)

#### Scenario: Server ignores Accept header and returns HTML
- **WHEN** fetching any web page with the `Accept: text/markdown` header
- **AND** the server responds with HTTP 200 and `Content-Type: text/html`
- **THEN** the system SHALL process the response through the normal HTML-to-Markdown pipeline

#### Scenario: Server returns text/plain with Markdown content
- **WHEN** fetching any web page with the `Accept: text/markdown` header
- **AND** the server responds with HTTP 200 and `Content-Type: text/plain`
- **THEN** the system SHALL treat the response body as Markdown

### Requirement: Markdown URL preference for llms.txt pages

When fetching a page that was discovered via llms.txt, the system SHALL first attempt to fetch the Markdown variant of the URL before falling back to the original URL. For file-like URLs (path ends with a filename, e.g., `page.html`), the system SHALL append `.md` to the path (e.g., `page.html.md`). For directory-like URLs (path ends with `/` or has no file extension in the last segment), the system SHALL append `index.html.md` to the path (e.g., `guide/` becomes `guide/index.html.md`). The `.md` variant request SHALL include the `Accept: text/markdown` header (per the Markdown content negotiation requirement). The system SHALL accept the `.md` response only if the HTTP status is 200 and the Content-Type indicates text content (`text/markdown`, `text/plain`, `text/x-markdown`, or similar). If the `.md` URL fails (non-200 status, non-text content type, or network error), the system SHALL fall back to fetching the original URL (which also uses content negotiation). Pages discovered via normal BFS link-following (not from llms.txt) SHALL NOT attempt the `.md` variant.

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

#### Scenario: Non-llms.txt pages skip .md attempt
- **WHEN** fetching a page discovered via normal BFS link-following (not from llms.txt)
- **THEN** the system SHALL NOT attempt the `.md` URL variant
- **AND** the system SHALL still use content negotiation via the `Accept: text/markdown` header

#### Scenario: .md URL for directory-like URL
- **WHEN** fetching a page listed in llms.txt at `https://example.com/docs/guide/`
- **AND** `https://example.com/docs/guide/index.html.md` returns HTTP 200 with `Content-Type: text/markdown`
- **THEN** the system SHALL use the Markdown content from the `index.html.md` URL

### Requirement: llms.txt file exclusion from indexing

The llms.txt file itself SHALL NOT be indexed as a document in the store. The exclusion SHALL be hardcoded in the URL filtering logic (not via configurable default exclude patterns), so that it remains active even when the user provides custom `excludePatterns`. If the llms.txt URL falls within the crawl scope and would normally be discovered during BFS crawling, it SHALL be excluded from content processing and storage. It is a meta-file used for URL discovery, not documentation content.

#### Scenario: llms.txt excluded from indexing
- **WHEN** the BFS crawl encounters the llms.txt file URL during link following
- **THEN** the system SHALL skip processing and storing it as a document
- **AND** the system SHALL not count it toward the `maxPages` limit

#### Scenario: llms.txt excluded even with custom excludePatterns
- **WHEN** the user provides custom `excludePatterns` (overriding default patterns)
- **AND** the BFS crawl encounters the llms.txt file URL
- **THEN** the system SHALL still exclude llms.txt from indexing
