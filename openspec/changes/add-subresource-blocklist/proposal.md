## Why

During Playwright-based page rendering, the scraper fetches every sub-resource the page requests — analytics beacons, session-replay agents, chat widgets, captcha runtimes, and social-embed JS — none of which contribute to the captured documentation content. Real-world scrape logs show repeated multi-megabyte downloads from `hcaptcha.com`, `youtube-nocookie.com`, `widget.kapa.ai`, and similar providers, each one wasted bandwidth and latency. We already abort `image`, `font`, and `media` resource types up front; extending that abort path with a small hand-curated list of known tracker/widget/captcha hostnames is a low-risk way to cut a meaningful slice of per-page cost without adding a configuration surface or risking documentation-content loss.

## What Changes

- Add a built-in, hand-curated blocklist of ~25–40 entries covering five categories: **Analytics**, **Session Replay**, **Chat Widgets**, **Captcha**, and **Social Embed runtimes**. Entries match by hostname suffix, with optional path-prefix qualification for cases where only specific URLs under a host are unwanted (e.g. `youtube-nocookie.com` embed runtime paths).
- Abort matching Playwright sub-resource requests at the route-interception layer, before any bytes are downloaded, alongside the existing `image`/`font`/`media` abort branch. Aborts use Playwright's `blockedbyclient` reason, matching the existing access-policy abort.
- Log blocked sub-resources at `debug` level only — no per-request warnings, no `console` output.
- The blocklist explicitly **excludes the "Advertising" category** (ad networks like `doubleclick.net`, `googlesyndication.com`) to avoid tripping anti-adblock detection on monetized sites. Documentation sites are unlikely to deploy such detection, but staying out of that category keeps the surface clean.
- The blocklist explicitly **excludes generic CDNs** (e.g. `unpkg.com`, `cdn.jsdelivr.net`) because pages legitimately fetch content-bearing libraries (Mermaid, MathJax, KaTeX) from them; blocking would break captured output.
- Add a single boolean config flag **`scraper.skipKnownTrackers`** (default `true`) — a kill switch following the same flat-under-`scraper` shape as [`scraper.preserveHashes`](src/utils/config.ts:75). When `false`, the blocklist is bypassed entirely and all sub-resources flow through the existing gates (access policy, resource-type abort, cache). No per-host editing surface in v1; the built-in list lives in code so that future additions ship automatically to every user (see design.md for why we deliberately keep the list out of the persisted config). Extending the existing `excludePatterns` to sub-resources was considered and rejected — users cannot reason about which sub-resources a given page fetches, so coupling sub-resource control to crawl-shape patterns would cause more failures than it prevents.

**Non-breaking.** No API, CLI, or MCP changes. Adds one config key with a safe default (`true`) that preserves the new behavior across upgrades. The blocklist's effect is strictly subtractive on sub-resource fetches that produce no captured content today; no documentation output should change.

## Capabilities

### New Capabilities
- `subresource-blocklist`: Defines the categories of third-party sub-resources blocked at request-interception time during Playwright-driven scraping, the matching semantics (hostname-suffix with optional path-prefix), the ordering relative to other request gates (access policy, resource-type abort, caching), and the explicit category exclusions (Advertising, generic CDNs) that protect against anti-adblock detection and content loss.

### Modified Capabilities
- `configuration`: Adds the new `scraper.skipKnownTrackers` boolean to the typed config schema and defaults, with standard env-var and CLI override behavior. No other configuration semantics change.

## Impact

- **Code**:
  - [src/scraper/middleware/HtmlPlaywrightMiddleware.ts:556](src/scraper/middleware/HtmlPlaywrightMiddleware.ts:556) — add a new abort branch between the existing access-policy check (line 551) and the resource-type abort (line 556), gated on `config.scraper.skipKnownTrackers`.
  - New sibling module (e.g. `src/scraper/middleware/subresourceBlocklist.ts`) containing the frozen blocklist array and the URL-matching helper, with a one-line rationale comment per category.
  - [src/utils/config.ts:70](src/utils/config.ts:70) — add `skipKnownTrackers: true` to `DEFAULT_CONFIG.scraper`; add `skipKnownTrackers: envBoolean.default(...)` to the scraper Zod schema.
  - Corresponding test file covering: each category blocks as expected, generic CDNs are NOT blocked, advertising-category domains are NOT blocked, the start URL itself is never blocked (sub-resources only), ordering relative to access-policy and resource-type aborts, and the kill-switch behavior when `skipKnownTrackers` is `false`.
- **APIs / interfaces**: One new config key. No CLI, MCP, or Web UI changes shipped in this change (future UI work can render the flag as a simple toggle).
- **Config**: One new boolean key, `scraper.skipKnownTrackers`, default `true`.
- **Dependencies**: None. No runtime list fetch, no third-party list package.
- **Documentation**: Brief mention in `ARCHITECTURE.md` under the scraper middleware section pointing at the new module and its rationale. Add the new config key to whatever config reference doc the repo maintains (or skip if there isn't a canonical one — the schema is self-documenting via Zod).
- **Relationship to in-flight work**: Orthogonal to `add-fetch-access-controls`. That change adds an allow-shaped security boundary at the URL/file fetch layer; this change adds a block-shaped performance optimization at the Playwright sub-resource layer. The access-policy check runs first; the blocklist runs immediately after.
