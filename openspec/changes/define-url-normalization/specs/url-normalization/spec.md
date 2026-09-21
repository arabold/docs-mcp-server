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

### Requirement: Case is preserved

Normalization SHALL NOT change the case of any part of a URL, and case folding SHALL NOT be offered as an option. A URL path, query and fragment are case-sensitive: two paths differing only in case may address two different documents, and treating them as one drops a page from the index without reporting anything.

Some servers do serve paths case-insensitively, and on those a case-sensitive key indexes one document twice. That is the safer failure: a duplicate is visible and can be recognised, while a page that was never fetched leaves nothing behind to notice.

#### Scenario: Paths differing only in case are distinct
- **GIVEN** two URLs whose paths differ only in case
- **WHEN** each is normalized
- **THEN** the results differ
- **AND** both pages are crawled

#### Scenario: A stored identity keeps its original case
- **GIVEN** a page whose URL contains upper-case characters in its path
- **WHEN** the page is recorded
- **THEN** its identity carries the same characters
- **AND** the link offered for it resolves

#### Scenario: Case folding cannot be re-enabled
- **WHEN** the normalizer's options are inspected
- **THEN** none of them folds case

### Requirement: Fragment handling follows the crawl's fragment policy

When a crawl treats fragments as routes rather than positions — a hash-routed site, where the fragment selects which page is shown — normalization SHALL leave fragments intact, and SHALL leave the surrounding URL intact with them. Trimming a trailing slash ahead of a route fragment produces a URL the site does not serve.

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
