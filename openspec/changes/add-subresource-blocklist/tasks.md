## 1. Blocklist Module

- [x] 1.1 Create `src/scraper/middleware/subresourceBlocklist.ts` exporting a frozen `SUBRESOURCE_BLOCKLIST` array and an `isBlockedSubresource(url: string): { blocked: true; category: string } | { blocked: false }` matcher.
- [x] 1.2 Define the entry type to support two shapes: `{ host: string; category: string }` and `{ host: string; pathPrefix: string; category: string }`. Group entries by category with a one-line rationale comment per group.
- [x] 1.3 Populate the list with 25–40 entries across the five categories: Analytics, Session Replay, Chat Widgets, Captcha, Social Embed runtimes. Concrete starter entries to include: `google-analytics.com`, `googletagmanager.com`, `segment.io`, `segment.com`, `mixpanel.com`, `hotjar.com`, `fullstory.com`, `logrocket.com`, `intercom.io`, `intercomcdn.com`, `widget.kapa.ai`, `drift.com`, `crisp.chat`, `hcaptcha.com`, `recaptcha.net`, `platform.twitter.com`, `connect.facebook.net`, `youtube-nocookie.com` with `pathPrefix: /s/_/ytembeds/`. Aim for ~30 total.
- [x] 1.4 Implement hostname matching as exact-equality OR `.<entry>` suffix, with explicit rejection of cross-label substrings. Reject empty entries and entries containing protocol/port at construction time (throw or `// biome-ignore` compile-time check).
- [x] 1.5 Implement path-prefix matching as `URL.pathname.startsWith(prefix)` only when the entry has a `pathPrefix` field.
- [x] 1.6 Unit-test `isBlockedSubresource` exhaustively: exact-host hit, subdomain hit, suffix-collision miss (`evil-google-analytics.com`), label-boundary miss (`myanalytics.com`), path-prefix hit + miss for `youtube-nocookie.com`, invalid-URL input returns `{ blocked: false }`, and explicit non-blocks for `doubleclick.net`, `googlesyndication.com`, `unpkg.com`, `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`.

## 2. Configuration Wiring

- [x] 2.1 In [src/utils/config.ts:70](src/utils/config.ts:70), add `skipKnownTrackers: true` to `DEFAULT_CONFIG.scraper` next to `preserveHashes`.
- [x] 2.2 In the corresponding `AppConfigSchema.scraper` Zod object, add `skipKnownTrackers: envBoolean.default(DEFAULT_CONFIG.scraper.skipKnownTrackers)` using the same `envBoolean` helper as other scraper booleans.
- [x] 2.3 Extend the existing configuration tests to cover: default value resolution, env-var override via `DOCS_MCP_SCRAPER_SKIP_KNOWN_TRACKERS`, file-value override, env precedence over file, and the upgrade path that supplies the new key when an existing file lacks it.

## 3. Playwright Middleware Integration

- [x] 3.1 In [src/scraper/middleware/HtmlPlaywrightMiddleware.ts:551](src/scraper/middleware/HtmlPlaywrightMiddleware.ts:551), add a new abort branch immediately after the existing `isRequestAllowed` check and before the existing `image`/`font`/`media` resource-type abort. Gate the entire branch on `this.config.scraper.skipKnownTrackers` (or equivalent injected config reference — match how other middleware accesses runtime config).
- [x] 3.2 Inside the branch, short-circuit when `route.request().resourceType() === "document"` so the top-level navigation and any iframe document navigations are never blocked. Only then call `isBlockedSubresource(reqUrl)`. On a positive match, emit a single `logger.debug` line of the form `Blocked sub-resource (<category>): <url>` and call `route.abort("blockedbyclient")`. Wrap the abort in the same `isRouteAlreadyHandledError` handling pattern used by the surrounding code.
- [x] 3.3 Extracted a shared private helper `tryBlocklistAbort(route, reqUrl)` and called it from both route handlers (line ~551 and line ~948) right after the access-policy check.
- [x] 3.4 Added middleware-level tests in `HtmlPlaywrightMiddleware.test.ts` driving the private `tryBlocklistAbort` helper. Covers: analytics sub-resource aborted with `blockedbyclient` when the flag is on; the same request NOT aborted when the flag is off; `unpkg.com` library NOT aborted; top-level navigation `document` NOT aborted; iframe document on a blocklisted host NOT aborted; script inside that iframe IS aborted; analytics image beacon aborted under the blocklist (not the generic image rule); already-handled route is reported as handled silently. The access-policy gate precedence is enforced structurally (helper is called after `isRequestAllowed`); not separately asserted to keep tests focused on the helper.

## 4. Documentation

- [x] 4.1 Added a "Sub-resource blocklist" subsection under "Content Processing" in [ARCHITECTURE.md](ARCHITECTURE.md). Names the module, lists the five categories, states the two exclusions with rationale, and mentions the `scraper.skipKnownTrackers` flag.
- [x] 4.2 README.md left untouched per the rationale in the proposal.

## 5. Verification

- [x] 5.1 `npm run typecheck` and `npm run lint` both clean (3 lint warnings + 1 info exist pre-existing on `main` and are not introduced by this change). `npx vitest run` on the affected files (`subresourceBlocklist.test.ts`, `HtmlPlaywrightMiddleware.test.ts`, `config.test.ts`) reports 118/118 passing. Pre-existing test failures in `src/store/applyMigrations.test.ts` and `src/store/DocumentStore.test.ts` are unrelated and reproduce on a clean `main` checkout (verified via `git stash`).
- [ ] 5.2 Run the project against a known noisy real-world docs site (e.g. a FastAPI or Document360 page that previously produced `Resource too large to cache` warnings for `hcaptcha.com`, `widget.kapa.ai`, or `youtube-nocookie.com` runtime) and confirm those specific warnings are gone while the captured page content is unchanged. Repeat with `DOCS_MCP_SCRAPER_SKIP_KNOWN_TRACKERS=false` and confirm the warnings reappear and content is still unchanged.
- [x] 5.3 `openspec validate add-subresource-blocklist --strict` — change is valid.
