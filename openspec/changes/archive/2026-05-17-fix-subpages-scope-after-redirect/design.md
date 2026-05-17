## Context

The scraper exposes three crawl scopes — `subpages`, `hostname`, `domain` — defined in [src/scraper/utils/scope.ts](src/scraper/utils/scope.ts). At depth 0 the strategy fetches the user-provided URL, then sets `canonicalBaseUrl` to the *post-redirect* URL ([src/scraper/strategies/WebScraperStrategy.ts:174-177](src/scraper/strategies/WebScraperStrategy.ts:174)). `BaseScraperStrategy.shouldProcessUrl` ([src/scraper/strategies/BaseScraperStrategy.ts:103](src/scraper/strategies/BaseScraperStrategy.ts:103)) then feeds that base into `isInScope` for every discovered link.

This change began as a fix for issue #381: Document360-backed help sites redirect `/foo` → `/foo~7400049439868183793`, and the current depth-0 overwrite adopts the suffixed path as the scope base. Child links use the unsuffixed clean form `/foo/api-introduction~...` and get filtered out — only 1 page is scraped.

Investigation surfaced four additional behaviors that are either silent bugs or undocumented edge cases:

- **`computeBaseDirectory`'s dot heuristic over-fires.** "Last segment contains a dot ⇒ treat as file, use parent dir" turns `/v1.0` into base `/` (whole hostname) and `/foo.html` into base `/` (whole hostname). The heuristic was added in commit [`5aaa7bb`](https://github.com/arabold/docs-mcp-server/commit/5aaa7bb) (Aug 15 2025) 28 minutes before the depth-0 redirect overwrite in [`6403325`](https://github.com/arabold/docs-mcp-server/commit/6403325) — both authored by the same person in the same session. The heuristic was a deliberate choice (an explicit test covers `/api/index.html` as start URL), but the dot rule is too coarse.
- **Port is ignored.** `subpages`/`hostname` compare `URL.hostname`, treating `https://x:8443/api` and `https://x:9000/api` as equivalent.
- **Hostname trailing dot is not normalized.** `example.com.` and `example.com` are technically the same DNS name but compare unequal.
- **Undefined scope at the strategy layer skips filtering entirely.** Entry points (`ScrapeTool`, web UI) default to `subpages`, but a programmatic caller passing `undefined` gets unrestricted crawling.

There is no spec covering scope behavior. These rules live implicitly in `scope.ts` and a handful of test cases in `WebScraperStrategy.test.ts`. This proposal both fixes issue #381 *and* captures the full contract in a new `scraping-scope` capability so the next implementer cannot regress these without breaking documented requirements.

## Goals / Non-Goals

**Goals:**
- Fix issue #381: `scope=subpages` works correctly when the depth-0 response redirects siblingwise.
- Fix silent over-broad-crawl bugs: `/v1.0`-style version paths and `/foo.html`-style file paths no longer accidentally crawl the entire hostname.
- Preserve the deliberate `/api/index.html` behavior with a tightened, well-bounded heuristic.
- Tighten port and trailing-dot handling so equivalent hostnames are treated equivalently and distinct ports are treated distinctly.
- Eliminate the "undefined scope = no filtering" footgun at the strategy layer.
- Pin the full set of scope rules down in a new spec capability with concrete examples per requirement.
- Rewrite the scope test cluster as a comprehensive matrix that mirrors the spec.

**Non-Goals:**
- Changing `scope=hostname` or `scope=domain` to span protocols (mixed http/https crawling). Protocol equality remains required for all three scopes.
- Changing the include/exclude pattern system or the default exclusion patterns. Patterns will get their own capability spec eventually.
- Auto-detecting which redirects are "legitimate" (site reorganizations) versus "platform suffixes." Users are responsible for resubmitting with the redirected URL when they want the new path.
- Touching `HtmlPlaywrightMiddleware`, refresh-mode queue handling, the hash-routed SPA feature, or any caller of `ScraperOptions`.

## Decisions

### Decision 1: Depth-0 redirect — adopt protocol/host always, adopt path only if descendant

At depth 0, build `canonicalBaseUrl` as follows:

```
final         = new URL(rawContent.source)        // post-redirect URL
userPath      = new URL(options.url).pathname

if isPathDescendant(userPath, final.pathname):
  canonicalBaseUrl = final                        // adopt redirected path
else:
  canonicalBaseUrl = new URL(userPath, final)     // keep user path, adopt protocol+host
  log.warn("Depth-0 redirect changed path siblingwise; …")
```

Where `isPathDescendant(parent, child)` returns true if `child === parent` after trailing-slash normalization, OR `child` starts with `parent + "/"`.

**Rationale**: The user typed a path; that path is their intent. Hostnames must be adopted from the redirect (without that, all links would fail the hostname check), but pathnames should respect user intent unless the redirect simply normalizes the path (trailing slash, index file) in which case the redirected path is identical-or-narrower and safe to adopt.

**Alternatives considered:**

- **Always use user-provided URL.** Simplest, but breaks the existing protocol/host redirect support that commit `6403325` introduced. Rejected.
- **Always use redirected URL (current behavior).** Status quo. Silently scrapes wrong subtree on site reorgs and breaks on platform-suffix redirects. The bug we're fixing. Rejected.
- **Heuristic on the redirected path's last segment.** Fragile — every KB platform uses different schemes. Rejected.

### Decision 2: Tighten `computeBaseDirectory` to recognize only `index` and `index.<ext>`

Replace the heuristic "last segment contains a dot ⇒ file" with "last segment matches `/^index(\.[a-z0-9]+)?$/i` ⇒ directory-index file." The extension is optional so that clean-URL routes like `/api/index` (no extension) are treated the same as `/api/index.html` — both are conventionally "the directory's index page."

```
computeBaseDirectory(pathname):
  if pathname is empty or "/":              return "/"
  if pathname ends with "/":                return pathname
  if last segment matches /^index(\.[a-z0-9]+)?$/i:
                                            return parent directory (with trailing slash)
                                            return pathname + "/"
```

**Rationale**: The history (28 minutes between the dot heuristic and the redirect overwrite, same author, same session) and the explicit `/api/index.html` test in `5aaa7bb` make clear the dot heuristic was a deliberate `/index.html` accommodation. The bug is that it fires on far too much. Tightening to `index(.<ext>)?` preserves the deliberate behavior, extends it consistently to extensionless index conventions, kills the silent over-broad-crawl on `/v1.0` and `/foo.html`, and is trivially predictable.

**Alternatives considered:**

- **Remove all heuristics, treat every path as directory.** Simpler. Loses the `/api/index.html` deliberate case. Rejected once history confirmed the case is intentional.
- **Use a broader extension allowlist** (`.html`, `.htm`, `.php`, `.aspx`, etc.). More inclusive but bigger guess surface. The `/api/index.html` case is the documented one; covering `/api/main.aspx` etc. is speculative. Rejected in favor of the minimum that preserves the documented behavior.
- **Detect at fetch time using Content-Type.** Would handle clean-URL platforms but introduces a fetch-dependent path computation. Rejected — too clever, harder to spec.

### Decision 3: Compare on `host` (hostname + port) for subpages/hostname; domain stays on primary domain

`URL.host` includes the optional port (`example.com:8443`); `URL.hostname` does not. Today's code uses `hostname` everywhere, so different-port URLs on the same host are considered the same scope. That's wrong for `subpages` and `hostname` — they describe "same service" boundaries.

For `domain` scope, primary-domain extraction (via PSL) is hostname-based and naturally port-agnostic. Stays as-is.

### Decision 4: Normalize trailing dot on hostnames

Strip a single trailing `.` from both base and target hostnames before comparison. `example.com.` and `example.com` resolve to the same DNS name and should be treated as equivalent.

### Decision 5: Keep protocol equality required for all scopes

Status quo. A `https://x/` page linking to `http://x/api` is out of scope even under `hostname`/`domain`. Spec'd explicitly so the rule is visible.

**Rationale**: Mixed-protocol crawling is a security concern (HTTPS pages should not be inferring trust into HTTP siblings), and modern docs sites are uniformly one protocol. The depth-0 redirect logic still correctly handles `http`→`https` upgrades by adopting the redirected protocol. No conflict.

### Decision 6: Default `scope` to `"subpages"` inside `shouldProcessUrl`

Today, `BaseScraperStrategy.shouldProcessUrl` skips scope filtering entirely when `options.scope` is falsy:

```ts
if (options.scope) {
  // …isInScope check…
}
```

Entry points default to `subpages`, so users never see this. But a programmatic caller could pass `undefined` and get unrestricted crawling. Change to:

```ts
const scope = options.scope ?? "subpages";
// always run isInScope
```

The strategy layer becomes self-defending — no caller can bypass scope by omission.

### Decision 7: Surface siblingwise redirects via warning log

When `isPathDescendant(userPath, final.pathname)` is false at depth 0, emit a `logger.warn` describing the user-provided URL, the redirected URL, the resulting scope anchor (user-provided path), and a suggested action (resubmit with the redirected URL if the new path is intended). Only emit once per scrape and only when the depth-0 redirect actually triggers the rule.

**Rationale**: Without this, a user typing `/v1` and getting redirected to `/v2/` would see "1 page scraped" with no explanation. The warning makes the implicit visible.

### Decision 8: New capability `scraping-scope`, not amendment to an existing spec

Closest existing capability is `scraper-isolation` (per-scrape strategy instance isolation), which is orthogonal. No spec currently covers scope behavior. A new `scraping-scope` capability gives this contract a stable home.

### Decision 9: Rewrite the scope test cluster from scratch

The current scope tests in `WebScraperStrategy.test.ts` (the three `scope=subpages/hostname/domain` tests around lines 125–291, plus the `index.html` and base-href integration tests around 903–1054) were written before any of the edge cases above were understood. None simulate a depth-0 redirect, none cover port or trailing-dot, and the `index.html` test passes by accident under the old broad heuristic. Patching them piecemeal is messier than a clean rewrite.

Plan: replace those tests with a comprehensive matrix that mirrors the new spec — one integration test per scenario in the spec, plus expanded unit tests on `scope.ts` (the existing `src/scraper/utils/scope.test.ts` is 93 lines and covers a partial slice of `computeBaseDirectory` and `isInScope`; it needs to be rewritten/extended, and one assertion — `computeBaseDirectory("/deep/path/file.md")` currently expected to return `"/deep/path/"` — will be inverted under the new heuristic). Tests that are *not* about scope (cleanup, refresh, hash-routed SPA support) remain untouched. The cross-origin `<base href>` test is part of the scope cluster and is rewritten under the new `host`-based comparison.

## Risks / Trade-offs

- **Site-reorg redirects (`/v1` → `/v2/`) change behavior** → Today: 400 pages on `/v2/*` scraped silently. After fix: 1 page + warning. **Mitigation**: warning log tells users exactly what happened and how to resubmit. Silently rewriting the user's URL is the very class of bug we're fixing for issue #381.

- **`/v1.0` and `/foo.html` start URLs now scope narrowly instead of crawling the whole hostname** → Strict bug fix. Anyone who was getting the old behavior was getting hostname-scope semantics under a subpages-scope label without knowing. **Mitigation**: PR description must call this out explicitly so anyone relying on it can switch to `scope: hostname`.

- **`/api/index.html` start URL still works only because of the tightened heuristic.** If the heuristic ever drifts (e.g. someone tries to make it stricter still), this case regresses. **Mitigation**: an explicit scenario in the spec for `/api/index.html` → base `/api/`, plus a unit test in `scope.test.ts`, locks it in.

- **Port-aware comparison could break someone running their docs on `https://x.com/` while linking to `https://x.com:443/`** → Browsers normalize port `443` away from the URL when it matches the protocol default; `new URL("https://x.com:443/").host === "x.com"`. So this should not occur in practice. Other defaulted ports (80 for http) normalize the same way. **Verified** via Node URL parser.

- **Trailing-dot normalization is hostname-only.** Path-segment trailing dots are not normalized (and shouldn't be — they're meaningful in some routes).

- **Warning could be noisy on multi-redirect chains** → If `followRedirects=true` chains several hops, the final URL might legitimately differ from the user's URL even when paths are "the same." **Mitigation**: descendant check is path-only and tolerates trailing slash + `index.<ext>` variants via base-directory computation, which covers the vast majority of multi-hop legitimate cases.

- **Test rewrite is a larger diff than a targeted fix.** ~6–8 tests removed, ~15 new tests added (scope.test.ts + new scope cluster in WebScraperStrategy.test.ts). **Mitigation**: the test rewrite is the spec's executable form; cohesion is the point. PR will be reviewed scope-by-scope.

## Migration Plan

No data migration. Behavior change is bounded to scope-filtering logic. Deployment is a normal release; rollback is reverting the change. The new spec doc is purely additive.
