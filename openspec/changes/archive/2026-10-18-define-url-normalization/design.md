## Context

`normalizeUrl` in `src/utils/url.ts` has been the scraper's comparison function since the initial commit. `scraping-scope` refers to "the URL-normalization layer" but never defines it, so its rules have never been reviewed.

Case folding is the rule that does not survive review. `ignoreCase` defaults to true and lowercases `normalized.href` — the whole string, not just the origin. The result is the crawl's `visited` key, so two paths differing only in case are one entry and the second page is never fetched.

## Decisions

**Remove case folding outright rather than default it off.** An option that is never set is a trap: it reads as a supported behavior, and the two strategies that set it explicitly show it invites cargo-culting. Nothing in the codebase wants a case-insensitive key, and a caller that does can lowercase its own input.

**Accept duplicates on case-insensitive servers.** A case-sensitive key indexes `/Guide` and `/guide` separately where a server serves both. That is a worse index but a visible one; the alternative drops a page and reports nothing. Prefer the failure that leaves evidence.

**Keep query strings, keep dropping fragments.** Unchanged behavior, now stated: a query commonly selects which resource is served, a fragment selects a position within one.

## Program Design

```
src/utils/
~   url.ts                       # drop ignoreCase from options and from normalizeUrl
~   url.test.ts                  # the opt-out test becomes "case is always preserved"
src/scraper/strategies/
~   BaseScraperStrategy.ts       # canonicalizeStoredUrl no longer opts out of folding
~   NpmScraperStrategy.ts        # drop the redundant explicit flag
~   PyPiScraperStrategy.ts       # drop the redundant explicit flag
```

`UrlNormalizerOptions` loses one member:

```ts
interface UrlNormalizerOptions {
  removeHash?: boolean;
  removeTrailingSlash?: boolean;
  removeQuery?: boolean;
  removeIndex?: boolean;
}
```

`normalizeUrl`'s signature is unchanged; it simply stops lowercasing its result.

`canonicalizeStoredUrl` keeps its `preserveHashes` exemption — that is about route fragments, not case — but no longer needs to pass an override, since the behavior it was opting out of is gone:

```ts
protected canonicalizeStoredUrl(url: string, scrapeOptions: ScraperOptions): string
  // returns url unchanged when scrapeOptions.preserveHashes
  // otherwise normalizeUrl(url, this.getUrlNormalizerOptions(scrapeOptions))
```

## Risks

A crawl of a case-insensitive server now stores `/Guide` and `/guide` as two pages where it previously stored one. Both resolve and both carry correct content, so search returns a duplicate rather than a wrong answer. No migration is warranted: existing rows keep their stored URLs, which were never case-folded — only the comparison key was.
