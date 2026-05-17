## ADDED Requirements

### Requirement: Markdown Link Extraction
The system SHALL extract crawl links from Markdown documents processed by the Markdown pipeline. Extracted targets SHALL preserve their raw Markdown target value so downstream scraper strategies can resolve relative URLs against the source document URL and apply existing scope, include/exclude, deduplication, max-depth, max-page, and access-policy behavior. The system SHALL ignore Markdown image targets during link extraction.

#### Scenario: Extract inline Markdown links
- **WHEN** a Markdown document contains inline links such as `[Guide](/docs/guide)` and `[API](https://example.com/api)`
- **THEN** the Markdown pipeline SHALL include `/docs/guide` and `https://example.com/api` in the extracted links

#### Scenario: Extract reference-style Markdown links
- **WHEN** a Markdown document contains a reference-style link such as `[Guide][guide-ref]` and a definition `[guide-ref]: /docs/guide "Guide title"`
- **THEN** the Markdown pipeline SHALL include `/docs/guide` in the extracted links

#### Scenario: Ignore Markdown images
- **WHEN** a Markdown document contains an image such as `![Logo](/logo.png)`
- **THEN** the Markdown pipeline SHALL NOT include `/logo.png` in the extracted links

#### Scenario: Content-negotiated Markdown continues BFS crawling
- **WHEN** a web page is fetched as `Content-Type: text/markdown` and contains a Markdown link to an in-scope page
- **THEN** the web scraper SHALL be able to enqueue and process that linked page using the existing crawl queue behavior

#### Scenario: HTML-to-Markdown conversion does not duplicate extraction
- **WHEN** a web page is fetched as `Content-Type: text/html`
- **THEN** the page SHALL continue to use the HTML pipeline's existing link extraction before conversion to Markdown
- **AND** Markdown link extraction SHALL NOT run as a second extraction pass for that HTML page
