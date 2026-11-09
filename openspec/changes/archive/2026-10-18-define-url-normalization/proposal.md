## Why

The scraper normalizes every URL it compares, and nothing says what that means. `scraping-scope` refers to "the URL-normalization layer" four times without defining it, so the rules live only in the implementation and have never been reviewed against what a URL actually is.

One of them is wrong. The normalizer lowercases the entire URL, including the path, which has been the default since the initial commit with no comment, no spec and no test covering the default — only one pinning the opt-out. RFC 3986 makes scheme and host case-insensitive and leaves path, query and fragment case-sensitive, so folding the whole string over-normalizes. The consequence is not cosmetic: the lowercased form is the crawl's deduplication key, so on a case-sensitive server `/Guide` and `/guide` collapse to one entry and the second page is silently dropped. Mixed-case paths are not hypothetical on sites we index — a local store holds 88 of them.

Two scraper strategies also set the flag explicitly to the value it already had, which reads like uncertainty about whether it was on.

Normalization now carries more weight than it did, because a page's identity is derived rather than taken verbatim: representations resolve to the page they represent, and spellings differing only by a trailing slash or fragment resolve to one page. That makes it worth stating what normalization does, why each rule exists, and what is deliberately left alone.

## What Changes

- Add a `url-normalization` capability describing the transformations, the reason for each, and the two contexts they serve: a comparison key, and a page identity.
- Remove case folding entirely — no flag, no replacement. A URL path is case-sensitive, and a normalizer that says otherwise loses pages.
- State that case folding is not a configurable behavior, so it cannot return as an option.
- Record that a page keeps both the identity it is stored under and the location its content was retrieved from, and why one cannot stand in for the other.

## Capabilities

### New Capabilities

- `url-normalization`: Defines how URLs are normalized for comparison and for storage as page identities.

### Modified Capabilities

<!-- None. `scraping-scope` already refers to this layer; it now has something to refer to. -->

## Impact

- Affected code:
  - `src/utils/url.ts` — remove the case-folding option and its application.
  - `src/scraper/strategies/NpmScraperStrategy.ts`, `PyPiScraperStrategy.ts` — drop the now-meaningless explicit flag.
  - `src/scraper/strategies/BaseScraperStrategy.ts` — the stored-identity normalizer no longer needs to opt out of case folding.
  - `src/utils/url.test.ts` — the opt-out test becomes a statement that case is always preserved.
- No database schema changes are required.
- No user-facing configuration changes.
