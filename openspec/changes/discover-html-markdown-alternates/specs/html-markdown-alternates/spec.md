## ADDED Requirements

### Requirement: Early Markdown alternate discovery

The web scraper SHALL inspect successful HTML responses for Markdown alternate links before running Playwright, HTML sanitization, HTML normalization, or HTML-to-Markdown conversion. The inspection SHALL operate on the raw fetched HTML response and SHALL NOT require JavaScript execution. If no eligible Markdown alternate is found, the scraper SHALL continue with the existing HTML processing pipeline.

#### Scenario: Markdown alternate avoids Playwright
- **WHEN** a web scrape fetches an HTML page while `scrapeMode` is `playwright` or `auto`
- **AND** the raw HTML contains an eligible Markdown alternate link
- **AND** the alternate fetch succeeds and validates as Markdown
- **THEN** the system SHALL process the Markdown alternate content through the Markdown pipeline
- **AND** the system SHALL NOT run Playwright for the original HTML page
- **AND** the system SHALL NOT run HTML-to-Markdown conversion for the original HTML page

#### Scenario: No eligible alternate uses existing HTML pipeline
- **WHEN** a web scrape fetches an HTML page
- **AND** the raw HTML does not contain an eligible Markdown alternate link
- **THEN** the system SHALL process the original HTML response through the existing HTML pipeline

### Requirement: Eligible alternate link selection

The scraper SHALL consider only `<link>` elements whose `rel` token list contains `alternate`, whose `href` resolves to an HTTP(S) URL, and whose `type` attribute is a known Markdown MIME type: `text/markdown`, `text/x-markdown`, `text/mdx`, or `text/x-gfm`. The scraper SHALL ignore alternate links with missing or non-Markdown `type` values, including RSS, Atom, PDF, HTML, CSS, JavaScript, and generic binary formats. The scraper SHALL ignore links whose `rel` token list also contains `stylesheet`.

#### Scenario: Markdown alternate selected
- **WHEN** raw HTML contains `<link rel="alternate" type="text/markdown" href="guide.md">`
- **THEN** the system SHALL treat `guide.md` as an eligible Markdown alternate candidate after resolving it against the page URL

#### Scenario: Alternate stylesheet ignored
- **WHEN** raw HTML contains `<link rel="alternate stylesheet" href="contrast.css" title="High contrast">`
- **THEN** the system SHALL NOT treat the link as a Markdown alternate candidate

#### Scenario: Feed alternate ignored
- **WHEN** raw HTML contains `<link rel="alternate" type="application/atom+xml" href="feed.xml">`
- **THEN** the system SHALL NOT treat the link as a Markdown alternate candidate

#### Scenario: Untyped alternate ignored
- **WHEN** raw HTML contains `<link rel="alternate" href="guide.md">`
- **THEN** the system SHALL NOT treat the link as a Markdown alternate candidate

### Requirement: Markdown alternate validation and fallback

The scraper SHALL fetch eligible Markdown alternate candidates with the existing fetcher path and SHALL use an alternate only when the fetch succeeds and the actual response MIME type is Markdown. The scraper SHALL treat the alternate link's `type` attribute as advisory and SHALL validate the fetched response MIME type before replacing the original HTML response. If the alternate fetch fails, is blocked, returns a non-success status, redirects to a disallowed URL, or returns a non-Markdown MIME type, the scraper SHALL fall back to processing the original HTML response normally.

#### Scenario: Valid alternate replaces original HTML processing
- **WHEN** an HTML page declares an eligible Markdown alternate
- **AND** fetching the alternate returns success with `Content-Type: text/markdown`
- **THEN** the system SHALL process the alternate response as Markdown content
- **AND** the system SHALL skip normal HTML processing for the original HTML response

#### Scenario: Misconfigured alternate falls back to HTML
- **WHEN** an HTML page declares an eligible Markdown alternate
- **AND** fetching the alternate returns success with `Content-Type: text/html`
- **THEN** the system SHALL reject the alternate response
- **AND** the system SHALL process the original HTML response normally

#### Scenario: Missing alternate falls back to HTML
- **WHEN** an HTML page declares an eligible Markdown alternate
- **AND** fetching the alternate returns not found or another non-success status
- **THEN** the system SHALL process the original HTML response normally

### Requirement: Policy enforcement for alternate URLs

The scraper SHALL resolve Markdown alternate `href` values against the effective HTML document URL, using the document `<base href>` when it is valid according to the same cautious base-resolution rules used for HTML link extraction. Resolved alternate URLs SHALL pass existing scope checks, include/exclude pattern checks, optional custom follow-link policy, and outbound access policy before use. The scraper SHALL NOT fetch or process an alternate URL that is out of scope, blocked by include/exclude patterns, rejected by a custom follow-link policy, blocked by network security policy, or resolved to a non-HTTP(S) scheme.

#### Scenario: Relative alternate resolved against page URL
- **WHEN** the fetched HTML page source is `https://docs.example.com/docs/guide.html`
- **AND** raw HTML contains `<link rel="alternate" type="text/markdown" href="guide.md">`
- **THEN** the system SHALL resolve the alternate candidate to `https://docs.example.com/docs/guide.md`

#### Scenario: Out-of-scope alternate ignored
- **WHEN** the user scrapes `https://docs.example.com/docs/guide.html` with default subpages scope
- **AND** raw HTML contains `<link rel="alternate" type="text/markdown" href="https://docs.example.com/blog/guide.md">`
- **THEN** the system SHALL NOT fetch the alternate URL
- **AND** the system SHALL process the original HTML response normally

#### Scenario: Access-policy blocked alternate ignored
- **WHEN** raw HTML contains an eligible Markdown alternate URL
- **AND** the outbound access policy blocks the alternate URL or one of its redirects
- **THEN** the system SHALL NOT bypass the configured access policy
- **AND** the system SHALL process the original HTML response normally

### Requirement: Alternate representation avoids duplicate indexing

When a Markdown alternate is accepted, the scraper SHALL treat the alternate as the content representation of the original HTML page rather than as an additional independent crawl target. The scraper SHALL avoid indexing both the original HTML page and the accepted Markdown alternate as separate documents solely because of the alternate relationship. Links extracted from the accepted Markdown content SHALL continue through normal link filtering and crawling.

#### Scenario: Accepted alternate indexes one document
- **WHEN** an HTML page declares an eligible Markdown alternate
- **AND** the alternate is fetched and accepted
- **THEN** the system SHALL store one processed document for the page representation
- **AND** the system SHALL NOT also store the original HTML conversion as a second duplicate document

#### Scenario: Markdown alternate links continue crawling
- **WHEN** an accepted Markdown alternate contains links to additional in-scope documentation pages
- **THEN** the system SHALL extract those links through the Markdown pipeline
- **AND** the system SHALL apply the normal crawl filtering rules before queueing them

### Requirement: Ordering with llms.txt Markdown preference

For queue items discovered from llms.txt, the scraper SHALL preserve the existing implicit `.md` variant preference before using HTML Markdown alternate discovery. If the implicit `.md` variant fails and the original URL response is HTML, the scraper SHALL then apply HTML Markdown alternate discovery before normal HTML processing. For queue items not discovered from llms.txt, the scraper SHALL fetch the original URL with the existing Markdown-preferred `Accept` behavior and apply HTML Markdown alternate discovery only when the response is HTML.

#### Scenario: llms.txt .md variant wins before HTML alternate
- **WHEN** a queue item is marked as discovered from llms.txt
- **AND** the implicit `.md` variant fetch succeeds and validates as Markdown
- **THEN** the system SHALL process the implicit `.md` variant
- **AND** the system SHALL NOT fetch the original HTML page solely to inspect its alternate links

#### Scenario: llms.txt fallback can use HTML alternate
- **WHEN** a queue item is marked as discovered from llms.txt
- **AND** the implicit `.md` variant fetch fails
- **AND** the original URL response is HTML with an eligible Markdown alternate
- **AND** the alternate fetch succeeds and validates as Markdown
- **THEN** the system SHALL process the declared Markdown alternate before normal HTML processing
