## Purpose

Defines how a URL is reduced to a comparable form, so that two spellings of the same page are recognised as one and two genuinely different pages are never merged.

## ADDED Requirements

### Requirement: Normalization serves two distinct purposes

Normalization produces a value used in two ways, and the two have different tolerances:

- A **comparison key**, used to decide whether a URL has already been seen and whether it is the crawl's start URL. A key may be more aggressive than the URL it came from, because it is never shown to anyone or requested.
- A **page identity**, the URL a page is recorded and cited under. An identity SHALL remain a URL that resolves to the page, because readers follow it.

Every transformation SHALL be safe for both uses. A transformation that cannot be is not a normalization but a guess, and belongs to the caller that can afford it.

#### Scenario: A key is never presented
- **WHEN** a URL is normalized for comparison
- **THEN** the result is used only to test whether the URL has been seen
- **AND** it is not stored as a page identity or offered as a link

#### Scenario: An identity remains followable
- **WHEN** a URL is normalized for storage as a page identity
- **THEN** the result addresses the same resource as the URL it came from

### Requirement: Transformations applied

Normalization SHALL apply the following, each because two spellings differing only in that respect address the same resource:

- **Trailing slashes** are removed, except from a path that is only a slash — a site's root has no shorter form.
- **Directory index files** resolve to the directory they index, because a server serves the same bytes for both.
- **Fragments** are removed, because a fragment selects a position within a page rather than a page.
- **Query strings** are retained, because a query commonly selects *which* resource is served rather than where to look inside one.

#### Scenario: Trailing slash
- **WHEN** two URLs differ only by a trailing slash
- **THEN** they normalize to the same value

#### Scenario: Site root keeps its slash
- **WHEN** a URL's path is a single slash
- **THEN** the slash is retained

#### Scenario: Directory index
- **WHEN** a URL names a directory's index file
- **THEN** it normalizes to the directory

#### Scenario: Fragment
- **WHEN** two URLs differ only by a fragment
- **THEN** they normalize to the same value

#### Scenario: Query string
- **WHEN** two URLs differ only by a query string
- **THEN** they do not normalize to the same value

### Requirement: Case is preserved where it is significant

Normalization SHALL NOT change the case of a URL's path, query or fragment, and case folding SHALL NOT be offered as an option. Those components are case-sensitive: two paths differing only in case may address two different documents, and treating them as one drops a page from the index without reporting anything.

Scheme and host are case-insensitive, and parsing a URL already renders them in lower case. Normalization inherits that and SHALL NOT be read as requiring the input's original spelling of either — preserving a meaningless distinction would split one host into two.

Some servers do serve paths case-insensitively, and on those a case-sensitive key indexes one document twice. That is the safer failure: a duplicate is visible and can be recognised, while a page that was never fetched leaves nothing behind to notice.

#### Scenario: Paths differing only in case are distinct
- **GIVEN** two URLs whose paths differ only in case
- **WHEN** each is normalized
- **THEN** the results differ
- **AND** both pages are crawled

#### Scenario: A stored identity keeps its original path case
- **GIVEN** a page whose URL contains upper-case characters in its path
- **WHEN** the page is recorded
- **THEN** its identity carries the same characters
- **AND** the link offered for it resolves

#### Scenario: Host case is not significant
- **GIVEN** two URLs differing only by the case of their scheme or host
- **WHEN** each is normalized
- **THEN** the results are equal

#### Scenario: Case folding cannot be re-enabled
- **WHEN** the normalizer's options are inspected
- **THEN** none of them folds case

### Requirement: Fragment handling follows the crawl's fragment policy

When a crawl treats fragments as routes rather than positions — a hash-routed site, where the fragment selects which page is shown — normalization SHALL leave fragments intact, and SHALL leave the surrounding URL intact with them. Trimming a trailing slash ahead of a route fragment produces a URL the site does not serve.

The exemption SHALL be decided per URL. It follows from a URL carrying a route fragment, not from the crawl's policy alone: a URL with no fragment is an ordinary URL whichever policy is in force, and exempting it too would leave a site's `/docs` and `/docs/` recorded as two pages.

#### Scenario: A URL without a fragment is normalized either way
- **GIVEN** a crawl that treats fragments as routes
- **WHEN** a URL carrying no fragment is normalized
- **THEN** the transformations above are applied to it

#### Scenario: Hash-routed URLs keep their fragments
- **GIVEN** a crawl that treats fragments as routes
- **WHEN** two URLs differ only by their fragments
- **THEN** they normalize to different values

#### Scenario: A route fragment's URL is left intact
- **GIVEN** a crawl that treats fragments as routes
- **WHEN** a URL carrying a route fragment is normalized
- **THEN** the rest of the URL is unchanged

### Requirement: A derived identity does not replace the retrieval location

An identity may be derived rather than observed: a representation resolves to the page it represents, and spellings differing only by a trailing slash or fragment resolve to one page. Deriving it SHALL NOT discard the location the content was retrieved from, which remains recorded alongside.

They answer different questions. The identity asserts where a page lives; the retrieval location is a fact about where its bytes came from. A refetch SHALL use the retrieval location, because that is what produced the stored content, and a stored validator SHALL be returned only to the resource that issued it. The identity is derived, so nothing guarantees it resolves; the retrieval location is known to.

#### Scenario: Refetching uses the retrieval location
- **GIVEN** a page whose identity differs from where its content was retrieved
- **WHEN** it is refetched
- **THEN** the request goes to the retrieval location

#### Scenario: Both remain available
- **WHEN** a stored page is read back
- **THEN** its identity and its retrieval location are both available

#### Scenario: A search result links somewhere that answers
- **GIVEN** a stored page whose identity was derived and whose retrieval location differs
- **WHEN** the page is returned as a search result
- **THEN** the retrieval location is available to the caller alongside the identity
- **AND** a link offered to a reader addresses the retrieval location
