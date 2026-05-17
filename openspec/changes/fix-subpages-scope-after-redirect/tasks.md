## 1. Scope module — helpers and rewrites

- [x] 1.1 Add `stripTrailingDot(hostname: string): string` in [src/scraper/utils/scope.ts](src/scraper/utils/scope.ts) that strips a single trailing `.` from a hostname.
- [x] 1.2 Add `isPathDescendant(parentPath: string, childPath: string): boolean` in [src/scraper/utils/scope.ts](src/scraper/utils/scope.ts). Treats `parentPath` as a directory (trailing slash appended if missing); returns true when `childPath` equals the normalized parent or starts with it.
- [x] 1.3 Rewrite `computeBaseDirectory(pathname: string): string` in [src/scraper/utils/scope.ts](src/scraper/utils/scope.ts) per the spec's "Base directory computation" requirement: empty/`/` → `/`; trailing slash → as-is; last segment matching `/^index(\.[a-z0-9]+)?$/i` (extension optional) → parent directory; otherwise → pathname + `/`.
- [x] 1.4 Update `isInScope` in [src/scraper/utils/scope.ts](src/scraper/utils/scope.ts) so that `subpages` and `hostname` cases compare on `URL.host` with `stripTrailingDot` applied. `domain` case continues to use `extractPrimaryDomain` (port-agnostic), also with `stripTrailingDot` applied to both hostnames.

## 2. Depth-0 scope-base resolution

- [x] 2.1 In [src/scraper/strategies/WebScraperStrategy.ts:174-177](src/scraper/strategies/WebScraperStrategy.ts:174), replace the unconditional `this.canonicalBaseUrl = new URL(effectiveSource)` with the conditional rule from the spec: build a URL from `final.protocol`/`final.host` and either `final.pathname` (when `isPathDescendant(userPath, final.pathname)`) or `userPath` (otherwise).
- [x] 2.2 When the path-descendant check fails at depth 0, emit `logger.warn` identifying both URLs and the resulting scope anchor, with a suggestion to resubmit with the redirected URL. Fire at most once per scrape. The descendant check (failure ⇒ warn, success ⇒ no warn) is the sole predicate; the no-redirect case is covered automatically because equal paths satisfy the descendant predicate.

## 3. Strategy-layer default scope

- [x] 3.1 In [src/scraper/strategies/BaseScraperStrategy.ts:103-114](src/scraper/strategies/BaseScraperStrategy.ts:103), change `shouldProcessUrl` so that `scope` defaults to `"subpages"` when `options.scope` is undefined; `isInScope` runs unconditionally.

## 4. Unit tests for scope.ts (rewrite existing file)

- [x] 4.1 Rewrite [src/scraper/utils/scope.test.ts](src/scraper/utils/scope.test.ts) (an existing 93-line file with partial coverage of `computeBaseDirectory` and `isInScope`). Preserve the file's existing test scenarios that remain valid under the new behavior (`/api/`, `/api`, `/api/index.html`, `/`, hostname/domain subdomain cases, GitHub Pages cases). Update the now-incorrect assertion: `computeBaseDirectory("/deep/path/file.md")` currently expects `"/deep/path/"`; under the tightened heuristic this becomes `"/deep/path/file.md/"`. Either remove or invert that case (intent is bug-fix per proposal).
- [x] 4.2 Expand the `describe("computeBaseDirectory")` block to cover every scenario in the spec's "Base directory computation" requirement: `/`, `/api/`, `/api`, `/api/index.html`, `/api/index.htm`, `/api/Index.HTML`, `/api/index`, `/api/Index`, `/api/indexes`, `/v1.0`, `/api/v2.0`, `/foo.html`, `/changelog.md`, empty string.
- [x] 4.3 Add a `describe("isPathDescendant")` block with: equal paths, equal paths after trailing-slash normalization, descendant path, sibling path sharing a prefix (`/foo` vs `/foo~abc`), unrelated path, root path as parent, empty path edge case.
- [x] 4.4 Add a `describe("stripTrailingDot")` block: hostname without dot unchanged, single trailing dot stripped, multiple dots (only one stripped), empty string.
- [x] 4.5 Expand the `describe("isInScope")` blocks to cover each scenario in the spec: protocol equality required, host with port comparison (subpages and hostname), trailing-dot normalization for all three scopes, mixed-case paths (case-sensitive), subpages descendant/sibling, hostname same-host/subdomain, domain PSL behavior with IP/localhost/github.io cases.

## 5. Rewrite scope tests in WebScraperStrategy.test.ts

- [x] 5.1 Remove the existing scope test cluster from [src/scraper/strategies/WebScraperStrategy.test.ts](src/scraper/strategies/WebScraperStrategy.test.ts): the three `scope=subpages`/`hostname`/`domain` tests (lines ~125–291), the index.html nested-descendant test (~903–941), the upward-relative-with-hostname-scope test (~943–982), the directory-base parity test (~984–1017), and the cross-origin `<base href>` test (~1019–1054). Do NOT remove tests outside this cluster (cleanup, refresh-mode, hash-routed SPA, maxDepth/maxPages limits — those are about other concerns).
- [x] 5.2 Add a fresh `describe("scope filtering")` block. For each scope mode and each spec scenario that requires integration coverage, add a test that mocks the fetcher (returning a page with curated link set) and asserts which links are followed. Cover:
  - `subpages` — base URL `https://example.com/api/`: descendant in scope, sibling not, subdomain not, different host not.
  - `subpages` — `/api/index.html` start URL with no redirect: siblings under `/api/` followed (verifies the tightened heuristic preserves this).
  - `subpages` — `/api/index` start URL (extensionless) with no redirect: siblings under `/api/` followed.
  - `subpages` — `/v1.0` start URL with no redirect: only `/v1.0/...` followed (verifies the silent over-broad-crawl bug is fixed).
  - `subpages` — `/foo.html` start URL with no redirect: only `/foo.html` itself fetched.
  - `subpages` — mixed-case path: `/Api/` and `/api/intro` do NOT match.
  - `hostname` — same host all paths followed; subdomain rejected.
  - `hostname` — different ports rejected (`https://x:8443/` vs `https://x:9000/`).
  - `hostname` — trailing-dot normalization: `example.com.` and `example.com` treated equal.
  - `hostname` — protocol mismatch rejected (`http://x/` from `https://x/` base).
  - `domain` — same primary domain across subdomains accepted; different primary domain rejected; GitHub Pages users isolated; localhost accepted across ports.
- [x] 5.3 Add a `describe("depth-0 redirect handling")` block covering each redirect-scenario from the spec:
  - Hash-suffix redirect (issue #381): user URL `https://example.com/foo`, mock returns `source: "https://example.com/foo~abc"`, page contains `<a href="/foo/child">`. Expect child fetched.
  - Trailing-slash redirect: `/api` → `/api/`. Expect children under `/api/` fetched.
  - Directory-index redirect: `/api` → `/api/index.html`. Expect siblings under `/api/` fetched.
  - Deeper-descendant redirect: `/api` → `/api/v2/intro`. Expect children under `/api/v2/` fetched.
  - Site-reorg redirect: `/v1/api` → `/v2/api`, page contains `<a href="/v2/api/child">`. Expect child NOT fetched, warning logged.
  - Dead-URL redirect: `/removed` → `/`, page contains `<a href="/home/intro">`. Expect child NOT fetched, warning logged.
  - Protocol upgrade: `http://example.com/api` → `https://example.com/api`. Expect `https://example.com/api/child` fetched.
  - Apex→www: `https://example.com/api` → `https://www.example.com/api`. Expect `https://www.example.com/api/child` fetched.
  - Port change via redirect: `https://example.com/api` → `https://example.com:8443/api`. Expect `https://example.com:8443/api/child` fetched.
- [x] 5.4 Rewrite the cross-origin `<base href>` test under the new `host`-based comparison: a page with `<base href="https://cdn.example.com/lib/">` and `<a href="script.js">` (resolves to `https://cdn.example.com/lib/script.js`) is NOT in scope when scope is `subpages` and base is `https://example.com/app/`. Same canonical scenario as the removed test, asserted against the new code paths.
- [x] 5.5 Add a `describe("scope edge cases")` block:
  - Start URL is always fetched even when its path doesn't match its own scope after redirect (depth-0 exemption).
  - Warning fires at most once per scrape on multi-page crawl.
  - Warning does not fire when there is no redirect or when the redirect is descendant-only.
  - `scope: undefined` at the strategy layer behaves identically to `scope: "subpages"`.
- [x] 5.6 Add a `describe("hash-route scope interaction")` block covering the `preserveHashes` × scope contract (orthogonal to existing hash-preservation tests):
  - Hash-routed siblings on the same pathname all pass subpages scope (issue #379 scenario).
  - Hash route to a different pathname is still filtered by subpages scope.
  - Descendant redirect with restored hash keeps hash routes in scope.
  - Siblingwise redirect with hash drops the hash and warns.
  - Hash routes are equivalent under hostname scope.

## 6. Validation

- [x] 6.1 Run `npm run typecheck` and confirm no new errors.
- [x] 6.2 Run `npm run lint` and confirm no new errors.
- [x] 6.3 Run `npm run test:unit -- src/scraper/utils/scope.test.ts` and confirm all new unit tests pass.
- [x] 6.4 Run `npm run test:unit -- src/scraper/strategies/WebScraperStrategy.test.ts` and confirm all rewritten and untouched tests pass.
- [x] 6.5 Run the full unit test suite `npm run test:unit` and confirm no other tests regress.
- [x] 6.6 Run `npx openspec validate fix-subpages-scope-after-redirect --strict` and confirm it passes.

## 7. PR/commit hygiene

- [x] 7.1 Reference issue #381 in the eventual commit/PR description.
- [x] 7.2 Call out the four behavior changes explicitly in the PR description, matching the proposal's "BREAKING" list: (1) siblingwise depth-0 redirect now keeps user path + warns; (2) start URLs like `/v1.0`, `/foo.html`, `/changelog.md` now scope narrowly instead of accidentally crawling the whole hostname; (3) `subpages`/`hostname` scopes now distinguish ports; (4) `scope: undefined` at the strategy layer now defaults to `subpages` instead of unrestricted crawling.
- [x] 7.3 No README or user-facing docs changes required — config shape is unchanged. The spec at [openspec/changes/fix-subpages-scope-after-redirect/specs/scraping-scope/spec.md](openspec/changes/fix-subpages-scope-after-redirect/specs/scraping-scope/spec.md) is the authoritative reference.
