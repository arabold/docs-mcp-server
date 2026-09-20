# Spec Delta

## Purpose

Defines what the HTML extractor stage discards from a fetched page and what it guarantees to preserve: backend selection, the categories of site chrome removed, scoping to the content region a page declares, caller-supplied exclusions, the safety nets that keep a page from being emptied or dropped, and the preservation guarantees that keep documentation prose and code from being mistaken for chrome.

## ADDED Requirements

### Requirement: Extractor backend selection

Extraction SHALL be governed by exactly one user-facing configuration key, `scraper.htmlExtractor`, accepting the values `cheerio` and `defuddle` and defaulting to `cheerio`. No other configuration key SHALL select or blend backends.

The default backend carries this capability's contract: every requirement below describes it. The `defuddle` value selects an alternate heuristic extractor kept for head-to-head evaluation against that contract, and is NOT held to the requirements below — its purpose is to be measured against them, so pinning its behavior would defeat the comparison. Selecting it SHALL change only which parts of a page survive extraction; every downstream stage, and the caller-supplied exclusions described below, SHALL behave identically under either value.

#### Scenario: Default backend is used when unconfigured
- **GIVEN** `scraper.htmlExtractor` is not set
- **WHEN** an HTML page is extracted
- **THEN** the contract-bearing backend is used

#### Scenario: Selecting the evaluation backend changes only extraction
- **GIVEN** `scraper.htmlExtractor` is set to `defuddle`
- **WHEN** an HTML page is scraped
- **THEN** the alternate extractor decides what survives
- **AND** title extraction, link discovery, Markdown conversion, and chunking behave as they do under the default

#### Scenario: Unrecognised value falls back to the default backend
- **GIVEN** `scraper.htmlExtractor` is set to a value other than `cheerio` or `defuddle`
- **WHEN** configuration is loaded
- **THEN** the effective value is the default backend
- **AND** a warning records that the configuration was reset

### Requirement: Site chrome removal

The extractor SHALL remove site chrome from the document before Markdown conversion, covering at least these categories: structural landmarks that frame content rather than carry it (navigation, banners, sidebars, footers, headers); interactive and non-rendering elements that carry no readable text (scripts, styles, form controls, modals, overlays); elements identified as non-content by ARIA landmark roles; skip links and breadcrumb trails; advertising and content-recommendation network markup; and third-party search widgets embedded outside navigation.

Chrome removal SHALL be resilient to an unmatched or malformed category entry: an entry that matches nothing, or that cannot be evaluated, SHALL NOT prevent the remaining categories from being applied.

#### Scenario: Navigation and footer are removed
- **GIVEN** a page whose body contains a navigation landmark, a content region, and a footer
- **WHEN** the page is extracted
- **THEN** the extracted text contains the content region's text
- **AND** the extracted text contains neither the navigation text nor the footer text

#### Scenario: Ad network markup is removed
- **GIVEN** a documentation page carrying an advertising network's rendered markup alongside its prose
- **WHEN** the page is extracted
- **THEN** the extracted text contains the prose
- **AND** the extracted text contains none of the advertisement's text or images

#### Scenario: Embedded search widget is removed
- **GIVEN** a page embedding a third-party search widget outside its navigation landmark
- **WHEN** the page is extracted
- **THEN** the widget's controls and result placeholders do not appear in the extracted text

#### Scenario: A category that matches nothing is harmless
- **GIVEN** a page containing no advertising markup
- **WHEN** the page is extracted
- **THEN** extraction succeeds
- **AND** every other chrome category is still applied

### Requirement: Scoping to the declared content region

When a page declares a main content region — a `<main>` element, or an element carrying `role="main"` when no `<main>` is present — the extractor SHALL discard everything outside that region. This SHALL be applied after chrome removal, so the decision is made against a document whose navigation, footers, and advertising have already been discarded.

The extractor SHALL apply this scoping only when the declared region holds at least a minimum share of the document's remaining visible text. Below that floor the document SHALL be left unscoped, on the assumption that the page mislabelled its region and its content lies outside it. The floor's value is a tuning concern and is not part of this contract.

When a page declares more than one candidate region, the extractor SHALL scope to the one holding the most text. When a page declares no region at all, the document SHALL be left unscoped.

#### Scenario: Promotional banner outside the content region is discarded
- **GIVEN** a page whose body contains a promotional link-and-image block matching no chrome category, followed by a `<main>` element holding the page's prose
- **WHEN** the page is extracted
- **THEN** the extracted text starts with the prose
- **AND** the promotional block does not appear in the extracted text

#### Scenario: Region declared by role is honoured when no main element exists
- **GIVEN** a page with no `<main>` element, whose prose sits inside an element carrying `role="main"`, beside a site-ribbon link
- **WHEN** the page is extracted
- **THEN** the extracted text contains the prose
- **AND** the site-ribbon link does not appear in the extracted text

#### Scenario: Content outside a small declared region is preserved
- **GIVEN** a page whose `<main>` element holds only a short placeholder, while the page's prose sits beside it
- **WHEN** the page is extracted
- **THEN** the extracted text contains the prose
- **AND** the page is not scoped to the placeholder region

#### Scenario: Page declaring no region is unaffected
- **GIVEN** a page with neither a `<main>` element nor a `role="main"` element
- **WHEN** the page is extracted
- **THEN** the extracted text contains every part of the document that chrome removal left in place

### Requirement: Caller-supplied exclusions

The extractor SHALL accept a caller-supplied list of CSS selectors identifying additional elements to discard, and SHALL apply it identically under either backend. Caller-supplied exclusions SHALL be applied in addition to, and never in place of, the built-in chrome categories.

A selector the extractor cannot evaluate SHALL be recorded as a non-fatal error on the page's result and SHALL NOT prevent the remaining selectors, the built-in categories, or the rest of extraction from being applied.

#### Scenario: Caller-supplied selector is applied
- **GIVEN** a caller supplies a selector matching a site-specific announcement block
- **WHEN** the page is extracted
- **THEN** the announcement block does not appear in the extracted text

#### Scenario: Caller-supplied selectors do not replace the built-ins
- **GIVEN** a caller supplies a selector matching an announcement block
- **AND** the page also contains a navigation landmark
- **WHEN** the page is extracted
- **THEN** neither the announcement block nor the navigation text appears in the extracted text

#### Scenario: Exclusions apply under either configured backend
- **GIVEN** a caller supplies a selector matching an announcement block
- **WHEN** the page is extracted under either value of `scraper.htmlExtractor`
- **THEN** the announcement block does not appear in the extracted text

#### Scenario: Unevaluatable selector is non-fatal
- **GIVEN** a caller supplies a selector the extractor cannot evaluate, alongside a valid one
- **WHEN** the page is extracted
- **THEN** the valid selector's matches are discarded
- **AND** the page is still extracted
- **AND** the result carries a non-fatal error identifying the rejected selector

### Requirement: Content preservation guarantees

Chrome removal SHALL target rendered chrome, never text that merely refers to it. Prose, headings, tables, and code blocks SHALL survive extraction even when they mention, quote, or link to a hostname or identifier that also appears in a chrome category.

Advertising markup SHALL be discarded after the page has rendered rather than prevented from loading, so that pages which detect blocked advertising requests still serve their content. Network-level filtering of third-party sub-resources is governed separately by the `subresource-blocklist` capability.

#### Scenario: Code block naming an ad network survives
- **GIVEN** a page whose prose and fenced code block reference an advertising network's hostname as an example
- **WHEN** the page is extracted
- **THEN** the prose and the code block appear in the extracted text unchanged

#### Scenario: Prose link to an ad network's site survives
- **GIVEN** a page whose prose links to an advertising network's public website
- **WHEN** the page is extracted
- **THEN** the link and its text appear in the extracted text

#### Scenario: Advertising is removed after render, not blocked
- **GIVEN** a page that serves its content only when its advertising requests are allowed to complete
- **WHEN** the page is scraped and extracted
- **THEN** the page's content is extracted
- **AND** the advertisement does not appear in the extracted text

### Requirement: Extraction never empties or drops a page

Extraction SHALL NOT turn a page that carried visible text into an empty document. If applying the built-in categories, caller-supplied exclusions, and region scoping would leave no text, the extractor SHALL fall back to a less aggressive result for that page.

An unexpected failure during extraction SHALL be recorded as a non-fatal error on the page's result and SHALL leave the page to be processed by the remaining pipeline rather than discarded. Under the heuristic backend, a result that retains substantially none of the page's visible text SHALL be treated the same way as an empty result.

#### Scenario: Over-aggressive removal falls back
- **GIVEN** a page whose entire visible text would be discarded by the applicable exclusions
- **WHEN** the page is extracted
- **THEN** the page's text is preserved rather than emptied
- **AND** a warning records that the fallback was taken

#### Scenario: Heuristic backend mis-extraction falls back
- **GIVEN** a content-rich page for which the heuristic backend returns substantially no text
- **WHEN** the page is extracted
- **THEN** the page is processed from the pre-extraction document instead
- **AND** a warning records the retention that triggered the fallback

#### Scenario: Unexpected failure does not drop the page
- **GIVEN** extraction of a page fails unexpectedly
- **WHEN** the pipeline continues
- **THEN** the page is still converted and indexed
- **AND** the result carries a non-fatal error describing the failure

### Requirement: Extraction does not narrow discovery

The page title and the set of links offered to the crawler SHALL be determined from the complete fetched document, before extraction discards anything. Removing chrome SHALL NOT reduce the set of URLs a crawl discovers, and SHALL NOT change the title recorded for a page.

#### Scenario: Links inside removed navigation are still discovered
- **GIVEN** a page whose only links to its sibling pages sit inside a navigation landmark
- **WHEN** the page is scraped
- **THEN** those sibling URLs are offered to the crawler for scope evaluation
- **AND** the navigation text does not appear in the extracted content

#### Scenario: Title survives removal of the element carrying it
- **GIVEN** a page whose title is declared in its document head
- **AND** whose visible heading sits in a region that extraction discards
- **WHEN** the page is extracted
- **THEN** the recorded title is the one declared in the head
