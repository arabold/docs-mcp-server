## Why

Issue #381 surfaced one concrete failure (`scope=subpages` discovers only the depth-0 page when the start URL responds with a path-changing redirect, e.g. Document360's `/foo` → `/foo~hash`). Investigating it revealed that the scraping-scope rules — three modes, redirect handling, hostname/host/protocol comparison semantics, and a base-directory heuristic — are entirely implicit in code. No spec exists, several edge cases behave surprisingly, and two of those behaviors are silent bugs (paths like `/v1.0` or `/foo.html` as start URL with `scope=subpages` accidentally crawl the entire hostname). This change fixes the depth-0 redirect bug, fixes the silent over-broad-crawl bugs, tightens four related edge cases, and pins the full contract down in a new `scraping-scope` capability spec so the next implementer cannot regress these without breaking documented requirements.

## What Changes

- For `scope=subpages`, at depth 0 the scope base SHALL adopt the **protocol and hostname** of the post-redirect URL but keep the **user-provided pathname** as the scope anchor — unless the redirected path is a path-descendant of the user-provided path, in which case the redirected path is adopted.
- A warning SHALL be logged at depth 0 when the redirect is siblingwise (path changes in a way that is not a descendant), so users understand why few pages were discovered.
- `computeBaseDirectory` heuristic is tightened: only path segments matching `/^index(\.[a-z0-9]+)?$/i` are treated as a directory-index file (parent directory used as base). This covers `/index`, `/index.html`, `/index.htm`, `/Index.HTML`, etc. All other paths are treated as directories. This fixes the silent over-broad-crawl on paths like `/v1.0`, `/v2.1`, `/foo.html`, and `/changelog.md` while preserving the deliberate `/api/index.html` behavior.
- `isInScope` SHALL compare on `URL.host` (hostname + optional port) for `subpages` and `hostname` scopes. `domain` scope continues to use primary-domain extraction (port-agnostic).
- Hostname comparison SHALL strip a single trailing `.` from hostnames before comparison so `example.com.` and `example.com` are treated as equivalent.
- `BaseScraperStrategy.shouldProcessUrl` SHALL default `scope` to `"subpages"` when undefined, preventing programmatic callers from accidentally bypassing scope filtering.
- A new `scraping-scope` capability SHALL document all three scopes, depth-0 redirect handling, host/protocol/path comparison rules, base-directory computation (with concrete examples), filter ordering, the start-URL exemption, and the orthogonality between scope filtering and the `preserveHashes` option (scope acts on pathname; hashes are a queue-identity concern handled separately).
- **BREAKING (behavioral, no API change)**:
  1. Start URLs whose redirect changes the path siblingwise (`/v1` → `/v2/`) now scrape only the depth-0 page plus a warning instead of silently following the redirect into a different subtree.
  2. Start URLs like `/v1.0`, `/v2.1`, `/foo.html`, `/changelog.md` no longer accidentally crawl the entire hostname under `scope=subpages`. They now scope to themselves and their descendants.
  3. `subpages`/`hostname` scope now distinguishes ports — `https://x:8443/api` and `https://x:9000/api` are different scopes.
  4. Programmatic callers passing `scope: undefined` now get `subpages` semantics instead of unrestricted crawling.

## Capabilities

### New Capabilities
- `scraping-scope`: Defines the three crawl scopes (`subpages`, `hostname`, `domain`), how each filters discovered URLs, how host/protocol/path equality are evaluated, how the depth-0 redirect interacts with the scope base, base-directory computation rules with concrete examples, and the ordering of scope vs. include/exclude/custom filters.

### Modified Capabilities
<!-- None — scope rules are currently undocumented; this change captures them in a new spec rather than amending existing ones. -->

## Impact

- **Code**:
  - [src/scraper/utils/scope.ts](src/scraper/utils/scope.ts) — tighten `computeBaseDirectory` (index.* only), add `isPathDescendant`, add `stripTrailingDot`, switch to `host` comparison for subpages/hostname, normalize trailing dot.
  - [src/scraper/strategies/WebScraperStrategy.ts:174-177](src/scraper/strategies/WebScraperStrategy.ts:174) — replace unconditional `canonicalBaseUrl` overwrite with conditional descendant-adoption + warning log.
  - [src/scraper/strategies/BaseScraperStrategy.ts:103-114](src/scraper/strategies/BaseScraperStrategy.ts:103) — default `scope` to `"subpages"` in `shouldProcessUrl` when undefined.
- **APIs**: No changes to `ScraperOptions`, CLI flags, MCP tools, or Web UI.
- **Tests**:
  - Expand [src/scraper/utils/scope.test.ts](src/scraper/utils/scope.test.ts) (an existing 93-line file) into exhaustive table-driven coverage of `computeBaseDirectory`, `isPathDescendant`, `stripTrailingDot`, and `isInScope`. One existing assertion will change under the new heuristic (the `"treats file-looking path as its parent directory"` case, which currently expects `computeBaseDirectory("/deep/path/file.md")` to return `"/deep/path/"`); this is intentional and aligns with the bug fix.
  - Rewrite the scope test cluster in [src/scraper/strategies/WebScraperStrategy.test.ts](src/scraper/strategies/WebScraperStrategy.test.ts) (the three `scope=subpages`/`hostname`/`domain` tests plus the index.html and base-href tests) into a comprehensive matrix covering: each scope mode, depth-0 redirect shapes (hash-suffix, trailing slash, index.html, siblingwise reorg, protocol upgrade, apex↔www), port differences, trailing-dot hostnames, version paths (`/v1.0`), `.html` start URLs, start-URL exemption, and filter ordering.
- **Backwards compatibility**: Four observable behavior changes listed above. All are surfaced via the warning log (for the siblingwise-redirect case) or yield strictly narrower-than-today scope (for the `/v1.0` and `/foo.html` cases — fixing silent over-broad-crawl bugs). No API or config-shape changes.
- **Refresh mode**: Unaffected — `initialQueue` items are filtered with the same `shouldProcessUrl` path, which now uses the corrected scope base.
