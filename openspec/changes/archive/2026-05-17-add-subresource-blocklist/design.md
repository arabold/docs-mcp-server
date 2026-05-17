## Context

Playwright's request-routing hook in `HtmlPlaywrightMiddleware.setupCachingRouteInterception` already intercepts every sub-resource a page tries to fetch and decides whether to (a) abort it, (b) serve it from the in-memory LRU cache, or (c) fetch + optionally cache it. Today the only abort decisions are:

1. **Access-policy reject** ([HtmlPlaywrightMiddleware.ts:551](src/scraper/middleware/HtmlPlaywrightMiddleware.ts:551)) — the shared outbound policy from the `add-fetch-access-controls` work; reason `blockedbyclient`.
2. **Resource-type abort** ([HtmlPlaywrightMiddleware.ts:556](src/scraper/middleware/HtmlPlaywrightMiddleware.ts:556)) — categorical drop of `image`, `font`, `media`.

Everything else (scripts, XHR, documents, stylesheets, fetch) is downloaded. Logs from real scrape jobs show consistent waste from a small, recognizable set of third-party providers: analytics SDKs, session-replay agents, embedded chat widgets, captcha runtimes, and social-embed JS. None of these carry the page's documentation content; they exist to instrument users, gate humans, or render UI ornaments that the sanitizer strips anyway.

A separate question — whether to extend the existing `excludePatterns` config to sub-resources, or add a new `ignoreUrlPatterns` field — was discussed and rejected. Users provide `excludePatterns` to shape *which pages get crawled*; they do not (and cannot) know which third-party CDNs a given page's runtime will request. Pushing sub-resource control to user pattern config produces more failure modes than it prevents.

A further question — whether to expose the list itself as a user-editable config array — was considered after the basic design landed and likewise rejected. The framework's `deepMerge` at [config.ts:682](src/utils/config.ts:682) intentionally treats arrays as scalars (source replaces target), and `loadConfig` writes the merged config back to disk on every start ([config.ts:463-472](src/utils/config.ts:463)). Combined: shipping the list as a default array means every user's first run freezes the list at that release's contents, and future additions silently never propagate. The hybrid we converged on keeps the list in code (so additions ship automatically on every release) and exposes only a single boolean kill switch through config.

## Goals / Non-Goals

**Goals:**
- Cut bandwidth and latency on rendered pages by aborting requests to a small, well-understood set of third-party hosts before any bytes transfer.
- Keep the blocklist trivially auditable: one file, one frozen array, one matcher function, one comment per category.
- Compose cleanly with the in-flight access-policy gate without reordering or duplicating its checks.
- Stay invisible to documentation output: blocked sub-resources must not be ones whose absence would change the captured DOM in a meaningful way.

**Non-Goals:**
- User-supplied additions to the blocklist (`additionalHosts`, custom patterns, etc.). Deferred until a real need surfaces. v1 ships exactly one boolean.
- Per-entry disable of built-in hosts. The kill switch is the only escape hatch in v1; if a specific built-in entry ever breaks content capture, a PR to remove it from the source is the right escalation.
- Import or generate the list from an external feed (DuckDuckGo Tracker Radar, Disconnect, EasyPrivacy). Best follow-up candidate if hand-maintenance becomes painful.
- Block "Advertising" category domains (`doubleclick.net`, `googlesyndication.com`, etc.). Anti-adblock detection commonly trips on these and we don't need them for documentation scraping anyway.
- Block generic CDNs that serve content-bearing libraries (`unpkg.com`, `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`).
- Touch the DOM-level sanitizer selectors in `HtmlSanitizerMiddleware`. Orthogonal post-fetch concern.
- Address the "Resource too large to cache" log directly. The log is a symptom; this change removes one common cause (oversized widget bundles) but isn't framed around it.
- Build the Web UI control. The flag is schema-visible so future UI work can render it as a toggle; not in scope for this change.

## Decisions

### Decision: Hand-curated list, baked into source

A frozen array of ~25–40 entries in a new sibling module (proposed: `src/scraper/middleware/subresourceBlocklist.ts`), grouped by category with a one-line rationale comment per group.

**Why over a third-party list:**
- Reviewable in 30 seconds. No license question, no parser, no transitive dependency.
- Tractable for the v1 audience (documentation sites), where the universe of problematic third parties is small and changes slowly.
- No build-time or runtime fetch — keeps the project hermetic.

**Alternatives considered:**
- *DuckDuckGo Tracker Radar* — open data, well-categorized. Best candidate if we later automate. Rejected for v1 as overkill for a sub-100-entry need.
- *EasyList/EasyPrivacy* — too broad, mixes ad networks with trackers, hard to slice cleanly.
- *Build-time generation from Tracker Radar, committed as code* — viable follow-up. Not v1 because we don't yet know whether the hand list needs frequent updating.

### Decision: Hostname-suffix matching, with optional path-prefix

Each entry is either a bare hostname (matched as suffix, with a `.` boundary to prevent `evil-google-analytics.com` matching `google-analytics.com`) or a `{host, pathPrefix}` pair for cases where only specific paths under a host are unwanted.

**Concrete need:** `youtube-nocookie.com` hosts both the legitimate `/embed/*` iframe document and the giant `/s/_/ytembeds/_/js/...` runtime bundle. We want to block the runtime, not the iframe (the iframe is harmless and may be how a docs page demonstrates an embed; blocking the runtime simply leaves an empty embed in the captured DOM, which is fine).

**Why not regex / minimatch / glob:**
- The matching needs are narrow. Two shapes cover every entry we expect.
- Regex invites mistakes (anchoring, escaping, backtracking) for zero benefit at this list size.
- Existing scraper patterns use minimatch via `shouldIncludeUrl`; we don't reuse that here because that helper is built around path patterns on canonical scrape URLs, not third-party host filtering at the route layer.

**Alternatives considered:**
- *Full minimatch on URL strings* — overkill and slower per request.
- *Hostname equality only* — too rigid for the youtube-nocookie split.
- *Regex array* — flexible but invites foot-guns; rejected.

### Decision: Place the new abort branch between the access policy gate and the resource-type gate

Order at `setupCachingRouteInterception`:

1. Access-policy reject (existing) — security boundary; runs first so the blocklist never overrides an allow-decision the policy would have refused.
2. **Sub-resource blocklist reject (new)** — performance optimization; runs before resource-type abort so an analytics image beacon is blocked under the blocklist rationale rather than the generic image rule. (Same outcome either way, but clearer logging.)
3. Resource-type abort (existing) — `image`/`font`/`media`.
4. Cache lookup, then fetch + maybe-cache (existing).

**Why this order:**
- The access policy is a hard security gate; nothing else should be able to subvert it.
- The blocklist runs early so the cache, headers merge, and fetch path are skipped entirely — full bandwidth savings.

### Decision: Never match the top-level navigation request

The matcher must apply only to sub-resources, not to the page document itself. If a user explicitly asks to scrape `https://www.google-analytics.com/somedocs`, that's their call — the start-URL navigation must succeed.

`page.route("**/*", ...)` at [HtmlPlaywrightMiddleware.ts:540](src/scraper/middleware/HtmlPlaywrightMiddleware.ts:540) intercepts **every** request the page makes, including the top-level navigation, so the exemption needs an explicit mechanism. The cleanest fit with existing patterns: gate the blocklist branch on `route.request().resourceType() !== "document"`. Playwright tags the top-level navigation request as `document` (along with any iframe document navigations); every analytics beacon, widget bundle, captcha runtime, or social-embed script in the categories we care about resolves to a different type (`xhr`, `fetch`, `script`, `image`, `stylesheet`). This mirrors the existing categorical resource-type filter one line below ([line 556](src/scraper/middleware/HtmlPlaywrightMiddleware.ts:556) — `image`/`font`/`media`).

A side effect worth naming: iframe document navigations are also resourceType `document`, so an iframe pointed at a blocklisted host won't be blocked at the navigation step — but every script and beacon inside that iframe will be, because they re-enter the same route handler via the per-frame `setupCachingRouteInterception` registration at [line 717](src/scraper/middleware/HtmlPlaywrightMiddleware.ts:717). That's the desired behavior: an iframe's mere existence costs little; its runtime is what we're blocking.

**Alternatives considered:**
- *Compare `reqUrl` against a captured "start URL" string* — works but requires plumbing the URL through the middleware factory and re-checking it every request. Heavier; doesn't naturally extend to "iframe documents are also fine."
- *Skip the blocklist when the request is at depth 0 / first navigation* — Playwright doesn't surface this directly through the route API.

### Decision: Debug-level logging only, no per-request user-visible output

The existing image/font/media abort is silent. The access-policy reject logs at warn. The blocklist sits in between — frequent and uninteresting once you trust the list. Per the project's logging conventions ("never use emojis in debug logs", AGENTS.md), the final shape is `logger.debug` with no emoji, message format `Blocked sub-resource (<category>): <url>`.

### Decision: Explicit category exclusions

The blocklist must NOT include:
- **Advertising networks** (`doubleclick.net`, `googlesyndication.com`, `googleadservices.com`, etc.). Tripping anti-adblock detection on the small set of monetized docs-like sites (e.g. tutorial blogs, some vendor sites) would break content capture. Excluding the category eliminates the risk entirely.
- **Generic CDNs** (`unpkg.com`, `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `cdn.skypack.dev`, `esm.sh`). Pages legitimately fetch Mermaid, KaTeX, MathJax, syntax highlighters, etc., from these hosts; blocking would silently degrade captured output.

These exclusions are documented in the spec as testable requirements so they cannot regress.

### Decision: Single boolean kill switch, list stays in code

Configuration surface is exactly one flag: `scraper.skipKnownTrackers: boolean` (default `true`), placed as a flat key under `scraper.*` to match [`scraper.preserveHashes`](src/utils/config.ts:75). When `false`, the blocklist branch in `setupCachingRouteInterception` is bypassed entirely and sub-resources flow through the existing gates unchanged.

**Why only a boolean, why not the list itself:**
- **Array-merge constraint.** `deepMerge` ([config.ts:682](src/utils/config.ts:682)) treats arrays as scalars — the file's value replaces the default's value entirely. `loadConfig` writes the merged config back to disk on every start ([config.ts:463-472](src/utils/config.ts:463)). Combined: if we shipped the list as a default array, every user's first run would freeze the list at that release's contents, and future additions silently never propagate. Keeping the list in code sidesteps the issue: new entries ship on every release.
- **User intent fits a binary.** The 99% case for editing this config is "turn it off because something broke." That's exactly one bit of information. Adding a list field would force users to either reason about a 30-entry list they didn't write, or to maintain their own copy of our list — both worse than a toggle.
- **UI-ready.** A boolean renders as a switch with a one-sentence helper; no list editor, no validation per row, no "is `unpkg.com` safe to add here?" support load.

**Default is `true`:**
- Performance gain is universal; cost on documentation sites is zero by construction.
- Users who want the unfiltered behavior (e.g. debugging why a page renders strangely) flip one flag.

**Naming: `skipKnownTrackers`:**
- Reads as user intent ("skip well-known trackers") rather than implementation ("subresource blocklist").
- "Known" signals the curated, fixed scope — no implication of completeness or per-host control.
- The internal module/spec name (`subresource-blocklist`, `subresourceBlocklist.ts`) stays implementation-flavored because that's developer-facing.

**Alternatives considered:**
- *Two knobs (`enabled` + `additionalHosts`)* — what we had before this revision. Rejected as YAGNI for v1; users who need extra entries can file an issue and we add to the built-in list (right escalation for a fixed-scope feature).
- *Full list in config defaults* — rejected for the array-merge reason above.
- *Per-entry disable list* — adds a third knob and an interaction matrix for a case (user keeps the list but removes one entry) we have no evidence of needing.

## Risks / Trade-offs

- **[Risk] A page depends on a blocked widget for content rendering** → Mitigation: every category in the list is content-orthogonal by definition (analytics, session replay, chat widgets, captcha, social-embed *runtimes*). Generic CDNs and embed *iframes* are excluded. If a real failure surfaces, the fix is a one-line PR removal of the offending entry — list is small and reviewable.

- **[Risk] Hostname-suffix matching collides with an unrelated domain** → Mitigation: enforce a `.` boundary in matching so `analytics.example.com` does not match against `example.com`, and `evil-google-analytics.com` does not match against `google-analytics.com`. Pinned by test.

- **[Risk] Anti-adblock detection triggers** → Mitigation: explicit category exclusion (no `Advertising` entries). Documentation sites virtually never run anti-adblock; the residual probability is low and the cost (one PR) is low.

- **[Risk] List drift — third parties rebrand or move CDNs** → Mitigation: entries that stop matching simply become dead code; no user-visible failure. Periodic review on a scrape-job-failure trigger is sufficient. If the maintenance burden actually materializes, the follow-up is build-time generation from Tracker Radar.

- **[Risk] Captured pages render differently because chat widgets / captcha iframes are missing** → This is the *desired* outcome (those UI ornaments are noise, and the sanitizer strips most of them post-fetch anyway). Documented as expected behavior in the spec.

- **[Trade-off] Single boolean is the only user override** → Conscious choice. If a built-in entry breaks content capture for a specific user, the only in-config remedy is to flip `skipKnownTrackers: false`, which loses all other entries. The right escalation for "entry X is wrong" is a PR to remove it from the source list — small, reviewable, ships to every user. Per-entry disable can be added later as a non-breaking field addition if real demand surfaces.

## Migration Plan

Non-breaking. The new config key defaults to `true`, so existing installs gain the optimization automatically on upgrade. No data migration. Existing on-disk config files will be auto-rewritten to include the new key with its default value via the existing `loadConfig` auto-save path ([config.ts:463-472](src/utils/config.ts:463)). Rollback is `git revert` of the single PR; users who land on a reverted build will simply have an extra unrecognized key in their config file. Zod's default behavior on `z.object()` is to **strip unknown keys** during parse — the schema in [config.ts](src/utils/config.ts) does not call `.passthrough()` or `.strict()` — so the orphaned key is silently dropped on the next config load with no validation error.
