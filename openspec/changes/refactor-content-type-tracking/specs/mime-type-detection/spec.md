## ADDED Requirements

### Requirement: Dual Content Type Tracking

The system SHALL store two distinct MIME type values for each indexed page:
1. `source_content_type`: The MIME type of the original fetched resource (e.g., `text/html`, `application/pdf`, `text/x-typescript`), as reported by the HTTP Content-Type header or detected from the file extension.
2. `content_type`: The MIME type of the post-processing content stored in chunks (e.g., `text/markdown` after HTML-to-markdown conversion, or the original MIME type if the pipeline does not transform the format).

Both values SHALL be stored on the `pages` table. Chunks inherit the page-level values via JOIN.

#### Scenario: HTML page indexed via web scraper
- **GIVEN** an HTML page fetched from a URL with Content-Type `text/html`
- **WHEN** the page is processed by `HtmlPipeline` and stored
- **THEN** `source_content_type` is `text/html`
- **AND** `content_type` is `text/markdown`

#### Scenario: PDF document indexed via web scraper
- **GIVEN** a PDF fetched from a URL with Content-Type `application/pdf`
- **WHEN** the document is processed by `DocumentPipeline` and stored
- **THEN** `source_content_type` is `application/pdf`
- **AND** `content_type` is `text/markdown`

#### Scenario: TypeScript file indexed via local file strategy
- **GIVEN** a `.ts` file processed via `LocalFileStrategy`
- **WHEN** the file is processed by `SourceCodePipeline` and stored
- **THEN** `source_content_type` is `text/x-typescript`
- **AND** `content_type` is `text/x-typescript`

#### Scenario: Markdown file indexed directly
- **GIVEN** a `.md` file fetched with Content-Type `text/markdown`
- **WHEN** the file is processed by `MarkdownPipeline` and stored
- **THEN** `source_content_type` is `text/markdown`
- **AND** `content_type` is `text/markdown`

### Requirement: Consistent Content Type Propagation

All scraper strategies SHALL populate both `sourceContentType` and `contentType` fields in their `ProcessItemResult`. The values SHALL be derived as follows:
- `sourceContentType`: Always `rawContent.mimeType` from the fetcher
- `contentType`: Always `processed.contentType` from the pipeline result, falling back to `rawContent.mimeType` if the pipeline does not set a value

#### Scenario: WebScraperStrategy populates both types
- **GIVEN** an HTML page fetched by `HttpFetcher` with mimeType `text/html`
- **WHEN** `WebScraperStrategy` processes the page through `HtmlPipeline`
- **THEN** `ProcessItemResult.sourceContentType` is `text/html`
- **AND** `ProcessItemResult.contentType` is `text/markdown`

#### Scenario: LocalFileStrategy populates both types
- **GIVEN** a Python file detected by `FileFetcher` with mimeType `text/x-python`
- **WHEN** `LocalFileStrategy` processes the file through `SourceCodePipeline`
- **THEN** `ProcessItemResult.sourceContentType` is `text/x-python`
- **AND** `ProcessItemResult.contentType` is `text/x-python`

#### Scenario: GitHubRepoProcessor populates both types
- **GIVEN** a Rust file detected with mimeType `text/x-rust`
- **WHEN** `GitHubRepoProcessor` processes the file through `SourceCodePipeline`
- **THEN** `ProcessItemResult.sourceContentType` is `text/x-rust`
- **AND** `ProcessItemResult.contentType` is `text/x-rust`

### Requirement: Content Type Consumer Semantics

Downstream consumers SHALL use the appropriate MIME type field for their purpose:
- **Assembly strategy selection** SHALL use `content_type` (processed) to determine how to reassemble chunks.
- **Content rendering** (web UI, MCP search results) SHALL use `content_type` (processed) to decide rendering format (markdown vs. code block).
- **Display labels** (MIME type badge in web UI) SHALL use `source_content_type` (original) to inform users of the original document format.
- **Search API results** SHALL expose both values: `mimeType` (processed, for backward compatibility) and `sourceMimeType` (original).

#### Scenario: Assembly strategy uses processed type for HTML-converted content
- **GIVEN** a page with `source_content_type` = `text/html` and `content_type` = `text/markdown`
- **WHEN** the assembly strategy factory selects a strategy
- **THEN** `MarkdownAssemblyStrategy` is selected based on `content_type`

#### Scenario: Web UI displays original type in badge
- **GIVEN** a search result for a page with `source_content_type` = `text/html` and `content_type` = `text/markdown`
- **WHEN** the result is rendered in the web UI
- **THEN** the MIME type badge displays `text/html`
- **AND** the content is rendered as markdown

#### Scenario: Search API returns both types
- **GIVEN** a search result for a page with both MIME types stored
- **WHEN** the search API returns the result
- **THEN** `mimeType` contains the processed content type
- **AND** `sourceMimeType` contains the original source type

### Requirement: Schema Migration for Dual Content Types

The system SHALL provide a database migration that adds `source_content_type` to the `pages` table. The migration SHALL copy existing `content_type` values into `source_content_type` as a best-effort backfill for historical data.

#### Scenario: Migration adds source_content_type column
- **WHEN** the migration runs on an existing database
- **THEN** the `pages` table has both `source_content_type` and `content_type` columns
- **AND** existing rows have `source_content_type` populated from the previous `content_type` value

#### Scenario: Re-indexing corrects historical data
- **GIVEN** a library previously indexed with only one MIME type stored
- **WHEN** the library is re-indexed
- **THEN** both `source_content_type` and `content_type` are set correctly
