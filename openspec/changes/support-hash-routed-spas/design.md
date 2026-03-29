## Context

Currently, the crawler's `normalizeUrl` utility removes URL hash fragments by default. This is correct for 99% of web crawling scenarios, as hashes usually indicate jump links (anchors) within the same page. However, for Single Page Applications (SPAs) that use hash-based routing (e.g., `docs.xyops.io/#Docs/api`), this behavior causes all internal links to collapse into the root URL, resulting in only the main shell being indexed.

Attempting to "guess" whether a site is a hash-routed SPA is unpredictable and risky. Therefore, an explicit opt-in mechanism is required to preserve hashes during crawling.

## Goals / Non-Goals

**Goals:**
- Provide a CLI flag (`--preserve-hashes`) and config option (`preserveHashes`) to disable hash stripping.
- Ensure URLs with hashes are treated as distinct documents in the database and crawler queue when the flag is enabled.
- Ensure `HtmlPlaywrightMiddleware` correctly intercepts and serves the initial page shell, even when the requested URL contains a hash fragment.
- Validate that `preserveHashes` is only used with a compatible scrape mode (`playwright` or `auto`), since pure `fetch` cannot execute client-side routing.

**Non-Goals:**
- Automatically detecting hash-routed SPAs.
- Changing the default behavior of `normalizeUrl`.
- Supporting hash routing in `fetch` scrape mode.

## Decisions

1. **Explicit Opt-in Flag (`preserveHashes`)**:
   - *Decision*: Add a `preserveHashes` boolean to `ScraperOptions` and the CLI.
   - *Rationale*: Safe, predictable, and doesn't break the vast majority of sites that use traditional anchor links.
   - *Alternative Considered*: "Auto" detection based on DOM analysis or URL patterns (e.g., `#/`). Rejected because heuristics are brittle and often lead to false positives (indexing duplicate pages for normal anchor links).

2. **Middleware Interception Fix**:
   - *Decision*: In `HtmlPlaywrightMiddleware`, when checking if `reqUrl === context.source` for the initial page fulfill, strip the hash from `context.source` before comparison.
   - *Rationale*: Browsers (and thus Playwright's network stack) do not send hash fragments to the server. If `context.source` is `http://site/#/route`, the `reqUrl` intercepted by Playwright will be `http://site/`. We must compare the origin + pathname + search components to successfully fulfill the initial document request.

3. **Scrape Mode Enforcement**:
   - *Decision*: If `preserveHashes` is enabled and `scrapeMode` is explicitly set to `fetch`, the scraper should either throw a validation error or automatically upgrade the mode to `playwright`.
   - *Rationale*: A pure HTTP fetch cannot resolve a hash route (the server just returns the empty SPA shell). Playwright is required to boot the SPA and allow the client-side router to render the content for the specific hash.

## Risks / Trade-offs

- **[Risk] User Confusion**: Users might enable `--preserve-hashes` on a traditional site, causing every anchor link to be indexed as a separate duplicate page.
  - *Mitigation*: Clearly document that this flag is exclusively for hash-routed SPAs.
- **[Risk] Playwright Interception Mismatch**: The updated URL comparison in `HtmlPlaywrightMiddleware` might inadvertently fulfill sub-resource requests if not scoped correctly.
  - *Mitigation*: Use strict URL parsing (e.g., `new URL(context.source)`) to ensure only the exact base path of the initial document is fulfilled from the pre-fetched content.
