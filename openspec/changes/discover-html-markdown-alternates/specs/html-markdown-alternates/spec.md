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

### Requirement: Markdown is the preferred representation of a page

When one crawl reaches both a Markdown and an HTML representation of the same page, the system SHALL index the Markdown one. Markdown is what the page's authors published for machine consumption; converting HTML to Markdown ourselves is a fallback for the majority of sites that offer nothing better, not an equal alternative.

This preference SHALL NOT depend on which representation was encountered first. A crawl that reaches the HTML page before the Markdown one SHALL still end with the Markdown content indexed.

The preference SHALL apply only between representations reached during the same crawl. It settles which of two routes to one document wins a race; it is not a claim that the stored copy is permanent. A later crawl's answer for a page SHALL replace what is stored, so a site that stops publishing a Markdown representation is re-indexed from what it now serves rather than freezing on the last Markdown copy retrieved.

A Markdown variant URL answered as plain text SHALL count as Markdown for this preference. Sites disagree on how to serve a `.md` file and `text/plain` is one of the answers in use, so the served type alone does not distinguish a published Markdown document from anything else. Markdown syntax is close enough to a superset of plain text that a document using none of it still survives the Markdown pipeline intact.

#### Scenario: Markdown replaces an already-indexed HTML representation
- **GIVEN** a page whose HTML representation has been processed
- **WHEN** a Markdown representation of the same page is accepted in the same crawl
- **THEN** the stored content for that page is the Markdown representation

#### Scenario: Encounter order does not decide the winner
- **GIVEN** two crawls of the same site that reach a page's HTML and Markdown representations in opposite orders
- **WHEN** each crawl completes
- **THEN** both have indexed the Markdown representation

#### Scenario: A later crawl supersedes the stored representation
- **GIVEN** a stored page whose content came from a Markdown representation
- **WHEN** a later crawl reaches only the page's HTML representation
- **THEN** the stored content for that page is the HTML representation

#### Scenario: A plain-text Markdown alternate is preferred over HTML
- **GIVEN** a crawl that retrieved a page's HTML representation
- **WHEN** the same crawl reaches a Markdown variant URL for that page and the server answers with plain text
- **THEN** the stored content for that page is the Markdown representation

#### Scenario: An empty representation competes on the same terms
- **GIVEN** a crawl that stored a page's Markdown representation
- **WHEN** the same crawl reaches another representation of that page that yields no extractable content
- **THEN** the stored content for that page remains the Markdown representation

#### Scenario: HTML is used when no Markdown representation exists
- **WHEN** a page offers no Markdown representation
- **THEN** the system SHALL process its HTML through the existing pipeline

### Requirement: A Markdown variant URL carries the canonical page identity

A URL SHALL be recorded under its extension-stripped form when **both** of the following hold:

1. the URL's path extension names a Markdown type, and
2. the response is an acceptable Markdown variant.

Both signals are required, and they answer different questions. The extension states what the author intended the URL to mean; the response states what the server actually returned. Either alone is unsafe: an extension with no matching response strips the identity of a page that merely happens to end in `.md`, and a Markdown response with no matching extension would rewrite the identity of a document that is legitimately its own resource.

The rule is a property of the response, not of how the URL was discovered. It therefore holds regardless of whether the URL arrived from an llms.txt index, a discovered link, or an alternate declaration, and needs no knowledge of what else the crawl has seen or will see.

A response that is not an acceptable Markdown variant SHALL leave the URL's identity unchanged, so a server that ignores the extension — answering with an HTML page or a soft error — cannot cause a page to be recorded under a URL that does not serve it.

#### Scenario: An llms.txt index listing Markdown URLs
- **GIVEN** an llms.txt whose entries name `.md` URLs
- **WHEN** those entries are fetched and return Markdown
- **THEN** each page is recorded under its extension-stripped URL
- **AND** no page is recorded under a `.md` URL

#### Scenario: Both representations reached in one crawl
- **GIVEN** a site whose Markdown variants are listed in llms.txt
- **AND** whose HTML pages are also reachable by crawling
- **WHEN** both are encountered
- **THEN** they resolve to a single page identity
- **AND** the page is indexed once

#### Scenario: A generic text content type still counts
- **GIVEN** a `.md` URL served with a generic text content type rather than a Markdown one
- **WHEN** the response is accepted as a Markdown variant
- **THEN** the extension is stripped
- **AND** the identity does not depend on the server naming the Markdown type exactly

#### Scenario: A server that ignores the extension
- **GIVEN** a `.md` URL whose response is an HTML page
- **WHEN** the response is evaluated
- **THEN** it is not an acceptable Markdown variant
- **AND** the URL keeps its own identity rather than being folded onto a page it does not serve

#### Scenario: A Markdown response at a URL without the extension
- **GIVEN** a URL with no Markdown extension that returns Markdown
- **THEN** its identity is unchanged

### Requirement: A page retains the location its content came from

Resolving a page's identity SHALL NOT discard the location the content was actually retrieved from. A page therefore carries both: the identity it is recorded under, and the location that served it. They coincide for most pages and differ whenever a representation was fetched from somewhere other than the page's canonical address.

Keeping only the identity breaks three things at once, because the identity is an assertion about where a page lives while the retrieval location is a fact about where its bytes came from:

- **Refetching.** A later refresh SHALL request the representation that produced the stored content. Requesting the identity instead retrieves a different representation, so the stored content is never refreshed and the preferred representation is silently replaced by whatever the identity serves.
- **Validators.** A stored validator describes the resource that issued it, so it SHALL be sent only to that resource. Pairing a validator with a different resource makes conditional requests meaningless at best, and at worst earns a not-modified response that skips a real update.
- **Offering a working link.** The identity is derived rather than observed — nothing guarantees the canonical address serves anything. The retrieval location is known to serve the content, so it remains available as the link to offer when the identity does not resolve.

Whether a consumer presents the identity or the retrieval location is that consumer's decision; this requirement is that both remain available to make it.

#### Scenario: Refresh requests the representation that produced the content
- **GIVEN** a page whose content came from a Markdown representation at a different location than its identity
- **WHEN** the page is refreshed
- **THEN** the request goes to the location the content came from
- **AND** not to the page's identity

#### Scenario: A validator is returned to its own resource
- **GIVEN** a stored page whose validator was issued by its Markdown representation
- **WHEN** a conditional request is made for that page
- **THEN** the validator is sent to the resource that issued it

#### Scenario: A page keeps refreshing after its identity is resolved
- **GIVEN** a page recorded under an identity that differs from where its content was retrieved
- **WHEN** it is refreshed and the representation has changed
- **THEN** the stored content reflects the change
- **AND** the page does not become frozen at the content it was first indexed with

#### Scenario: Both locations are available to consumers
- **WHEN** a stored page is read back
- **THEN** its identity and the location its content came from are both available
- **AND** a consumer can offer a link to a location known to serve the content

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
