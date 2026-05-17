# scraping-scope Specification

## Purpose
Defines how discovered URLs are filtered for web scraping scopes, including protocol, host, path, redirect, hash-route, and warning behavior.
## Requirements
### Requirement: Default scope is subpages

When a caller of the scraper does not supply a `scope` value, the scraper SHALL apply `scope=subpages` for all link filtering. This applies at the strategy layer, not only at entry points, so programmatic callers cannot accidentally bypass scope filtering by omission.

#### Scenario: ScraperOptions with scope undefined
- **WHEN** a caller invokes the scraper with `scope: undefined`
- **THEN** discovered links are filtered as if `scope: "subpages"` had been passed

#### Scenario: ScraperOptions with scope explicitly set
- **WHEN** a caller invokes the scraper with `scope: "hostname"`
- **THEN** discovered links are filtered using `hostname` semantics

### Requirement: Start URL is exempt from scope filtering

The user-provided URL SHALL be added to the queue and fetched at depth 0 regardless of any scope rule. Scope filtering applies only to URLs *discovered* during crawling.

#### Scenario: Start URL outside its own subpages base after redirect
- **WHEN** the user-provided URL is `https://example.com/foo`
- **AND** the depth-0 response redirects to `https://example.com/foo~hash`
- **THEN** the depth-0 page is fetched and returned to the caller
- **AND** discovered links from that page are filtered using the resolved scope base (see "Depth-0 redirect adopts protocol and hostname" and related requirements below)

### Requirement: Filter ordering for discovered links

Discovered links SHALL be filtered in this order, with each filter able to reject before later filters run:
1. URL parse — invalid URLs are rejected.
2. Archive-extension filter — links ending in `.zip`, `.tar`, `.gz`, or `.tgz` (case-insensitive) are rejected during crawl.
3. Scope check — `isInScope(canonicalBaseUrl, target, scope)` must return true.
4. Pattern check — `shouldIncludeUrl(target, includePatterns, excludePatterns)` must return true (default exclusion patterns apply when no user excludePatterns are provided).
5. Optional `shouldFollowLink` callback — if configured, must return true.

#### Scenario: Scope reject short-circuits pattern check
- **WHEN** scope is `subpages` with base `https://example.com/api/`
- **AND** a discovered link is `https://other.com/api/intro`
- **THEN** the link is rejected by scope before patterns are evaluated

#### Scenario: Archive link rejected before scope check
- **WHEN** a discovered link is `https://example.com/api/dump.zip`
- **THEN** the link is rejected by the archive-extension filter regardless of scope

### Requirement: Protocol equality is required for all scopes

`isInScope` SHALL return false when the target URL's protocol differs from the scope base URL's protocol, regardless of which scope mode is in use. Mixed-protocol crawling (e.g. a `https://` page linking to its `http://` sibling) is not supported.

#### Scenario: HTTPS base, HTTP target, hostname scope
- **WHEN** scope base is `https://example.com/api/`
- **AND** discovered URL is `http://example.com/api/intro`
- **AND** scope is `hostname`
- **THEN** the URL is NOT in scope

#### Scenario: HTTPS base, HTTPS target after http→https redirect
- **WHEN** the user-provided URL is `http://example.com/api`
- **AND** the depth-0 response redirects to `https://example.com/api`
- **AND** a discovered link is `https://example.com/api/intro`
- **THEN** the URL is in scope (the redirect adoption made the base protocol `https:`)

### Requirement: Subpages and hostname scope compare on host (hostname + port)

For `subpages` and `hostname` scopes, the host comparison SHALL use `URL.host` (hostname plus optional port) rather than `URL.hostname` alone. Different ports on the same hostname represent different services and are different scopes.

#### Scenario: Different ports on same hostname
- **WHEN** scope base is `https://example.com:8443/api/`
- **AND** discovered URL is `https://example.com:9000/api/intro`
- **AND** scope is `hostname`
- **THEN** the URL is NOT in scope

#### Scenario: Default port normalization
- **WHEN** scope base is `https://example.com/api/`
- **AND** discovered URL is `https://example.com:443/api/intro`
- **THEN** the URL is in scope (the URL parser normalizes default ports away from `host`)

### Requirement: Hostname comparison normalizes a single trailing dot

Before comparison, both the base URL's host and the target URL's host SHALL have a single trailing `.` stripped from the hostname portion. This rule applies uniformly to all three scopes (`subpages`, `hostname`, and `domain`). `example.com.` and `example.com` are treated as equivalent.

#### Scenario: Trailing dot on base hostname under subpages scope
- **WHEN** scope base is `https://example.com./api/`
- **AND** discovered URL is `https://example.com/api/intro`
- **AND** scope is `subpages`
- **THEN** the URL is in scope

#### Scenario: Trailing dot on target hostname under hostname scope
- **WHEN** scope base is `https://example.com/api/`
- **AND** discovered URL is `https://example.com./other`
- **AND** scope is `hostname`
- **THEN** the URL is in scope

#### Scenario: Trailing dot under domain scope
- **WHEN** scope base is `https://docs.example.com./`
- **AND** discovered URL is `https://api.example.com/v1`
- **AND** scope is `domain`
- **THEN** the URL is in scope

### Requirement: Subpages scope filters by base directory path-prefix

For `scope=subpages`, after protocol/host equality is established, the target URL SHALL be considered in scope when its pathname starts with the scope base URL's *base directory* (computed per the "Base directory computation" requirement). Path comparison is case-sensitive.

#### Scenario: Descendant path
- **WHEN** scope base is `https://docs.example.com/api/`
- **AND** discovered URL is `https://docs.example.com/api/guides/intro`
- **THEN** the URL is in scope

#### Scenario: Sibling path
- **WHEN** scope base is `https://docs.example.com/api/`
- **AND** discovered URL is `https://docs.example.com/blog/post`
- **THEN** the URL is NOT in scope

#### Scenario: Mixed-case paths
- **WHEN** scope base is `https://docs.example.com/Api/`
- **AND** discovered URL is `https://docs.example.com/api/intro`
- **THEN** the URL is NOT in scope (path comparison is case-sensitive)

### Requirement: Base directory computation

The base directory of a pathname for `scope=subpages` SHALL be computed as follows:

- Empty pathname or `/` → `/`.
- Pathname ending in `/` → the pathname unchanged.
- Pathname whose last segment matches `/^index(\.[a-z0-9]+)?$/i` (case-insensitive, extension optional) → the parent directory (the pathname with the last segment removed, ending in `/`).
- All other pathnames → the pathname with `/` appended.

This deliberately tight heuristic preserves the documented `/path/index.html`-as-start-URL behavior (sibling pages under `/path/` remain in scope), extends it consistently to extensionless `index` paths (clean-URL routing convention), and avoids misclassifying version-like or file-extension paths.

#### Scenario: Root path
- **WHEN** pathname is `/`
- **THEN** base directory is `/`

#### Scenario: Directory with trailing slash
- **WHEN** pathname is `/api/`
- **THEN** base directory is `/api/`

#### Scenario: Directory without trailing slash
- **WHEN** pathname is `/api`
- **THEN** base directory is `/api/`

#### Scenario: Path with index.html last segment
- **WHEN** pathname is `/api/index.html`
- **THEN** base directory is `/api/`

#### Scenario: Path with index.htm last segment
- **WHEN** pathname is `/api/index.htm`
- **THEN** base directory is `/api/`

#### Scenario: Path with mixed-case Index.HTML last segment
- **WHEN** pathname is `/api/Index.HTML`
- **THEN** base directory is `/api/`

#### Scenario: Version-like path with dot
- **WHEN** pathname is `/v1.0`
- **THEN** base directory is `/v1.0/`

#### Scenario: Nested version-like path with dot
- **WHEN** pathname is `/api/v2.0`
- **THEN** base directory is `/api/v2.0/`

#### Scenario: Non-index file-like last segment
- **WHEN** pathname is `/foo.html`
- **THEN** base directory is `/foo.html/`

#### Scenario: Non-index markdown file
- **WHEN** pathname is `/changelog.md`
- **THEN** base directory is `/changelog.md/`

#### Scenario: Extensionless index
- **WHEN** pathname is `/api/index`
- **THEN** base directory is `/api/`

#### Scenario: Extensionless Index with mixed case
- **WHEN** pathname is `/api/Index`
- **THEN** base directory is `/api/`

#### Scenario: Path that starts with index but is not exactly index
- **WHEN** pathname is `/api/indexes`
- **THEN** base directory is `/api/indexes/` (`indexes` is not `index` or `index.<ext>`)

### Requirement: Hostname scope ignores pathname

For `scope=hostname`, after protocol equality is established, a target URL SHALL be considered in scope when its host (per the trailing-dot and port-aware rules) exactly matches the scope base URL's host, regardless of pathname.

#### Scenario: Same host, unrelated path
- **WHEN** scope base is `https://docs.example.com/api/`
- **AND** discovered URL is `https://docs.example.com/blog/post`
- **AND** scope is `hostname`
- **THEN** the URL is in scope

#### Scenario: Subdomain rejected
- **WHEN** scope base is `https://docs.example.com/api/`
- **AND** discovered URL is `https://api.example.com/v1`
- **AND** scope is `hostname`
- **THEN** the URL is NOT in scope

### Requirement: Domain scope spans the primary domain including subdomains

For `scope=domain`, after protocol equality is established, a target URL SHALL be considered in scope when its hostname's primary domain matches that of the scope base URL's hostname, regardless of pathname or port. The primary domain is extracted using the Public Suffix List with the following special cases:

- IPv4 and IPv6 literals are returned as-is and compared verbatim.
- Single-label hostnames (e.g. `localhost`) are returned as-is and compared verbatim.
- GitHub Pages user/org subdomains (`<user>.github.io`) are treated as their own primary domain so different users' GitHub Pages do not collide.

#### Scenario: Different subdomain, same primary domain
- **WHEN** scope base is `https://docs.example.com/`
- **AND** discovered URL is `https://api.example.com/v1`
- **AND** scope is `domain`
- **THEN** the URL is in scope

#### Scenario: Different primary domain
- **WHEN** scope base is `https://docs.example.com/`
- **AND** discovered URL is `https://example.org/page`
- **AND** scope is `domain`
- **THEN** the URL is NOT in scope

#### Scenario: GitHub Pages users are isolated
- **WHEN** scope base is `https://userA.github.io/proj/`
- **AND** discovered URL is `https://userB.github.io/other/`
- **AND** scope is `domain`
- **THEN** the URL is NOT in scope

#### Scenario: IPv4 hosts compare verbatim
- **WHEN** scope base is `http://192.168.1.10/`
- **AND** discovered URL is `http://192.168.1.20/`
- **AND** scope is `domain`
- **THEN** the URL is NOT in scope

#### Scenario: localhost compares verbatim
- **WHEN** scope base is `http://localhost:3000/`
- **AND** discovered URL is `http://localhost:4000/`
- **AND** scope is `domain`
- **THEN** the URL is in scope (port is ignored for domain scope; both hosts are `localhost`)

### Requirement: Depth-0 redirect adopts protocol and host of redirected URL

When the depth-0 fetch follows a redirect, the scope base URL's protocol and host (hostname plus optional port) SHALL be replaced with those of the post-redirect URL for all subsequent link filtering. This ensures protocol upgrades (`http`→`https`), host changes (apex↔`www`), and port changes do not cause every discovered link to be filtered out by the host check.

#### Scenario: Protocol upgrade redirect
- **WHEN** the user-provided URL is `http://example.com/api`
- **AND** the depth-0 response redirects to `https://example.com/api`
- **THEN** the scope base host is `example.com` and the scope base protocol is `https:`
- **AND** child links beginning with `https://example.com/api/` are in scope

#### Scenario: Apex to www redirect
- **WHEN** the user-provided URL is `https://example.com/api`
- **AND** the depth-0 response redirects to `https://www.example.com/api`
- **THEN** the scope base host is `www.example.com`
- **AND** child links on `www.example.com/api/` are in scope

#### Scenario: Port change via redirect
- **WHEN** the user-provided URL is `https://example.com/api`
- **AND** the depth-0 response redirects to `https://example.com:8443/api`
- **THEN** the scope base host is `example.com:8443`
- **AND** child links on `example.com:8443/api/` are in scope but `example.com/api/...` is not

### Requirement: Depth-0 redirect keeps the user-provided path as scope anchor

When the depth-0 fetch redirects, the scope base URL's pathname SHALL remain the user-provided pathname. The post-redirect URL is still used for the stored page URL and for resolving relative links from the fetched document, but discovered-link scope filtering uses the user-provided path together with the adopted protocol and host. This treats the user-provided URL as the crawl boundary and preserves intent for index URLs like `/docs` that redirect to a concrete first page while the caller expects to crawl the wider `/docs/` subtree.

#### Scenario: Trailing slash redirect
- **WHEN** the user-provided URL is `https://example.com/api`
- **AND** the depth-0 response redirects to `https://example.com/api/`
- **THEN** the scope base pathname is `/api`
- **AND** child links beginning with `https://example.com/api/` are in scope

#### Scenario: Directory index redirect
- **WHEN** the user-provided URL is `https://example.com/api`
- **AND** the depth-0 response redirects to `https://example.com/api/index.html`
- **THEN** the scope base directory is `/api/`
- **AND** sibling URLs under `/api/` remain in scope

#### Scenario: Deeper-descendant redirect
- **WHEN** the user-provided URL is `https://example.com/api`
- **AND** the depth-0 response redirects to `https://example.com/api/v2/intro`
- **THEN** the scope base pathname is `/api` (the user-provided path)
- **AND** descendant links under `/api/v2/intro/...` are in scope
- **AND** sibling links under `/api/` are also in scope

#### Scenario: Docs index redirects to a concrete first page
- **WHEN** the user-provided URL is `https://tailwindcss.com/docs`
- **AND** the depth-0 response redirects to `https://tailwindcss.com/docs/installation/using-vite`
- **THEN** the scope base pathname is `/docs`
- **AND** sibling docs under `/docs/`, like `/docs/theme`, are in scope

### Requirement: Siblingwise depth-0 redirects stay bounded by the user-provided path

When the depth-0 fetch redirects to a URL whose pathname is NOT a path-descendant of the user-provided URL's pathname, discovered-link filtering SHALL remain bounded by the user-provided pathname (while protocol and host adopt the redirect, per the protocol/host requirement). This prevents a dead URL, reorganized URL, or platform-specific suffix from expanding the crawl boundary to the redirected sibling path.

#### Scenario: Document360-style hash-suffix redirect (issue #381)
- **WHEN** the user-provided URL is `https://help.example.com/en/integrations/peoplevox-api-guide`
- **AND** the depth-0 response redirects to `https://help.example.com/en/integrations/peoplevox-api-guide~7400049439868183793`
- **THEN** the scope base pathname is `/en/integrations/peoplevox-api-guide`
- **AND** child links like `/en/integrations/peoplevox-api-guide/api-introduction~...` are in scope

#### Scenario: Site reorganization redirect
- **WHEN** the user-provided URL is `https://example.com/v1/api`
- **AND** the depth-0 response redirects to `https://example.com/v2/api`
- **THEN** the scope base pathname is `/v1/api`
- **AND** child links under `/v2/api/` are NOT in scope

#### Scenario: Dead URL redirected to homepage
- **WHEN** the user-provided URL is `https://example.com/removed-section`
- **AND** the depth-0 response redirects to `https://example.com/`
- **THEN** the scope base pathname is `/removed-section`
- **AND** the scope does NOT expand to the whole host

### Requirement: Hash fragments do not participate in scope filtering

Scope filtering SHALL operate on `URL.protocol`, `URL.host`, and `URL.pathname`, all of which exclude the fragment by definition. Hash fragments are a client-side routing concern controlled by the `preserveHashes` option, which determines whether `URL.hash` participates in queue identity and dedup. Scope decisions are independent of hash values: two URLs with the same protocol/host/pathname but different hashes are equivalent under every scope mode. This is the mechanism by which hash-routed SPAs (issue #379) are crawlable — distinct hash routes share a pathname and therefore share a scope verdict.

The depth-0 redirect adoption rules apply to the post-redirect URL as returned by the fetcher; if `preserveHashes` is enabled, the user-requested hash is restored to that URL by the URL-normalization layer when the pre- and post-redirect paths match (so `https://x/docs#/guide` → `https://x/docs/` yields `effectiveSource = https://x/docs/#/guide`). The scope-base pathname computed from `effectiveSource` is unaffected by this restoration.

#### Scenario: Hash-routed siblings on the same pathname all pass subpages scope
- **WHEN** the user-provided URL is `https://docs.example.com/`
- **AND** the page contains hash-routed links `#/Docs/welcome`, `#/Docs/api`, `#/Docs/config`
- **AND** `preserveHashes` is enabled
- **AND** scope is `subpages`
- **THEN** every hash-routed target is in scope (each has pathname `/`, which equals the scope-base directory `/`)
- **AND** each distinct hash route is fetched as a separate page

#### Scenario: Hash route to a different pathname is filtered by subpages scope
- **WHEN** scope base is `https://example.com/foo/`
- **AND** discovered URL is `https://example.com/bar#/section`
- **AND** scope is `subpages`
- **THEN** the URL is NOT in scope (pathname `/bar` does not start with `/foo/`; the hash does not rescue it)

#### Scenario: Descendant redirect with restored hash preserves the scope contract
- **WHEN** the user-provided URL is `https://example.com/docs#/guide`
- **AND** `preserveHashes` is enabled
- **AND** the depth-0 response redirects to `https://example.com/docs/`
- **THEN** the restored `effectiveSource` is `https://example.com/docs/#/guide`
- **AND** the scope base pathname is `/docs` (the hash is ignored for scope purposes)
- **AND** the scope base directory is `/docs/`
- **AND** subsequent hash-routed links like `https://example.com/docs/#/api` are in scope

#### Scenario: Siblingwise redirect with hash drops the hash and warns
- **WHEN** the user-provided URL is `https://example.com/foo#/guide`
- **AND** `preserveHashes` is enabled
- **AND** the depth-0 response redirects to `https://example.com/bar`
- **THEN** the hash is NOT restored (the URL-normalization layer restores only when pre- and post-redirect paths match)
- **AND** the siblingwise-redirect warning is logged
- **AND** the scope base pathname remains `/foo`

#### Scenario: Hash routes are equivalent under hostname and domain scope
- **WHEN** scope base is `https://example.com/`
- **AND** discovered URLs are `https://example.com/#/a` and `https://example.com/#/b`
- **AND** scope is `hostname` (or `domain`)
- **THEN** both URLs are in scope (host/domain check ignores pathname and therefore ignores hash)

### Requirement: Siblingwise depth-0 redirect emits a warning

When the depth-0 redirect changes the path siblingwise (the redirected pathname is not a path-descendant of the user-provided pathname), the scraper SHALL log a warning that identifies the user-provided URL, the redirected URL, and the resulting scope anchor (user-provided path), and suggests resubmitting with the redirected URL if the new path is intended. The warning SHALL fire at most once per scrape and SHALL NOT fire when the redirected pathname is a descendant or equal to the user-provided pathname.

#### Scenario: Hash-suffix redirect surfaces warning
- **WHEN** the user-provided URL is `https://help.example.com/foo`
- **AND** the depth-0 response redirects to `https://help.example.com/foo~abc`
- **THEN** a warning is logged that mentions both URLs and the scope anchor
- **AND** the scrape continues using the user-provided pathname as the scope anchor

#### Scenario: Descendant redirect does not warn
- **WHEN** the user-provided URL is `https://example.com/api`
- **AND** the depth-0 response redirects to `https://example.com/api/`
- **THEN** no scope-redirect warning is logged

#### Scenario: No redirect does not warn
- **WHEN** the user-provided URL is `https://example.com/api`
- **AND** the depth-0 response is served directly with no redirect
- **THEN** no scope-redirect warning is logged
