# Design

## Context

See proposal.md — Why. This change writes a capability spec for behavior that already ships; no runtime code changes.

Two facts about the existing stage shape every decision below.

First, the extractor is the only pipeline stage with no spec, and its selector list is hand-tuned against real sites rather than derived from a rule. A spec that pinned the list would be rewritten on every tuning pass and would still not say what the stage guarantees.

Second, the stage has two backends, and they are not peers. `cheerio` is the default and the one users run. `defuddle` is an evaluation arm with a recorded benchmark table in `docs/guides/benchmarking.md`; its job is to be measured against the default, not to match it.

This design also carries the measured numbers the spec deliberately excludes, so they survive somewhere other than a commit message.

## Goals / Non-Goals

**Goals:**

- Pin the guarantees a re-implementation of the extractor would have to honour, in terms a caller can observe.
- Record the measurements behind the tuning values, and the sample they were taken from, so a future tuning pass knows what it is moving away from.
- Leave a requirement-to-evidence map, so the spec can be verified against the code without repeating the 20-site measurement.

**Non-Goals:**

- Changing extraction behavior. The content-region scoping this spec describes shipped in PR #506; nothing here alters it.
- Constraining the evaluation backend. See Decision 1.
- Specifying the stages either side of extraction — normalization, Markdown conversion, and network-level sub-resource blocking each have their own home.

## Decisions

### 1. The spec binds the default extractor only

`defuddle` is selectable but is not held to the requirements. Binding it would state as a guarantee whatever it happens to do today, which is precisely the thing the benchmark exists to measure; it would also make any future change to the arm a spec change, and would invalidate the reference numbers recorded in `docs/guides/benchmarking.md`.

*Alternative considered:* hold both backends to the contract and document their divergences. Tried first, and abandoned after measuring one: a page whose `<main>` holds only a loading placeholder beside the real prose extracts to just the placeholder under `defuddle`. Writing that down as a specified difference gave the spec an extra requirement whose only content was "the experiment behaves differently", which is what an experiment is for.

*Consequence:* the spec's requirements are the yardstick the arm is measured against. That is the more useful relationship, and it is the one the benchmark guide already assumes.

### 2. Categories in the spec, entries in the code

The spec names six chrome categories and no selectors. The list is ~150 entries, curated per site family, and a re-implementation would be free to pick different ones and still satisfy the contract. `subresource-blocklist` sets the precedent, with one difference: that spec bounds its list size (20–60 entries) because the blocklist is itself the product. Here the list is an implementation of the categories, so it is not bounded.

*Consequence:* adding a selector for a newly-encountered ad network is not a spec change. Adding a whole category is.

### 3. Region floor of 0.5, measured not guessed

The declared-region scoping applies only when the region holds at least half the document's remaining visible text.

Measured across 20 documentation sites (vite, mdn, react, typescript, rust, vue, bootstrap, django, requests, github, tailwind, node, astro, fastapi, pydantic, express, sqlalchemy, pkg.go.dev, mui, kubernetes), post-sanitization:

| | |
|---|---|
| Pages declaring a region | 19 of 20 (17 `<main>`, 2 `role="main"`) |
| Region's share of remaining text | >98% on every one; minimum 98.2% (sqlalchemy) |
| Content lost to scoping | none — every dropped block was chrome |
| Pages declaring nothing | 1 (tailwind, a JS-rendered shell under static fetch) |

The distance between the observed minimum (98.2%) and the floor (0.5) is the safety margin. The floor is not tuned to sit just under the observed data; it is set where a page would have to be structurally unusual to fall below it, because the cost of scoping wrongly (silent content loss) far exceeds the cost of not scoping (chrome in a chunk, the status quo).

*Alternative considered:* no floor. Rejected — the whole risk of this mechanism is a page that mislabels its region, and without a floor that page loses its content silently.

### 4. Scoping runs after selector removal, not before

Order matters for the ratio. Measured before selector removal, a page's nav and sidebar count against the region's share and the floor becomes a coin toss on sparse pages. Measured after, navigation, footers, ads and search widgets are already gone, so anything still outside the region is site chrome and the ratio is near 1 on well-formed pages.

*Consequence:* the floor rarely fires in practice. That is intended — its job is the pathological page, not the ordinary one.

### 5. Largest candidate wins when a page declares several

Pages carry more than one `<main>` (invalid but common), and `role="main"` nests inside `<main>`. Picking the text-richest candidate handles both without a separate rule, and degrades to "the only one" in the normal case.

*Alternative considered:* require exactly one and skip scoping otherwise. Simpler, but it forfeits the fix on exactly the malformed pages most likely to carry chrome.

### 6. Leave the evaluation arm's retention floor alone

`defuddle`'s fallback triggers below 1% retention. The placeholder case that motivated Decision 1 sits at roughly 4%, so a floor anywhere in 10–15% would catch it. Measured retention on the same 20 pages argues against moving it:

```
  fastapi  21.6% |=====
  mdn      29.5% |=======
  tailwind 38.8% |=========
  astro    43.1% |==========
  ...
  vite     90.9% |======================
  requests 94.1% |=======================
  ghdocs  100.0% |========================
```

The lowest legitimate retention is 21.6%, on a 20-page sample, against a backend whose aggression is deliberate. A 15% floor leaves ~6 points of margin before it starts falling back on pages it extracted correctly — and that failure mode (indexing a whole nav-heavy page raw) is worse than the one it prevents. Moving it would also perturb the recorded benchmark numbers.

### 7. Capability boundaries

| Adjacent capability | Seam |
|---|---|
| `subresource-blocklist` | Network gate — what is never fetched. Ads are deliberately *not* network-blocked (anti-adblock detection), so they die here instead. The spec notes the seam; it does not restate the blocklist. |
| `markdown-features` | Starts at the splitter, after Markdown conversion. |
| `llmstxt-discovery`, `discover-html-markdown-alternates` (in flight) | Choosing a Markdown representation instead of extracting HTML — a different answer to the same problem, upstream of this stage. |
| URL normalization | A later middleware. Tracking-pixel removal and URL absolutization stay out of scope. |

## Program Design

No code changes. The design-level artifact this change produces is the map from each requirement to the code and tests that already satisfy it, so the spec can be verified without re-running the site measurement.

```
src/scraper/
    middleware/
      HtmlSanitizerMiddleware.ts        # the contract-bearing extractor
      HtmlDefuddleMiddleware.ts         # evaluation arm; unbound by this spec
    pipelines/
      HtmlPipeline.ts                   # middleware order: metadata + links before extractor
```

| Requirement | Satisfied by | Evidence |
|---|---|---|
| Extractor backend selection | `scraper.htmlExtractor` enum in `src/utils/config.ts`; backend choice in `HtmlPipeline.ts` | `HtmlPipeline.test.ts` — "processes HTML via Defuddle when htmlExtractor is set to defuddle" |
| Site chrome removal | `defaultSelectorsToRemove` in `HtmlSanitizerMiddleware.ts` | `HtmlSanitizerMiddleware.test.ts` — default elements, Carbon Ads, EthicalAds/AdSense, DocSearch, skip-links/breadcrumbs |
| Scoping to the declared content region | `scopeToMainContent` in `HtmlSanitizerMiddleware.ts` | `HtmlSanitizerMiddleware.test.ts` — promo chrome outside main, `role=main` fallback, small-region guard, no-region case |
| Caller-supplied exclusions | `excludeSelectors` merge in `HtmlSanitizerMiddleware.ts`; `applyExcludePreDefuddle` in `HtmlDefuddleMiddleware.ts` | `HtmlSanitizerMiddleware.test.ts` — custom selectors, combined selectors |
| Content preservation guarantees | Host-scoped ad selectors (`a[href*="srv.carbonads.net"]`, not the apex) | `HtmlSanitizerMiddleware.test.ts` — prose links to the Carbon Ads apex survive; prose/code naming ad hostnames survive |
| Never empties or drops a page | Pre-sanitization body snapshot and restore in `HtmlSanitizerMiddleware.ts`; retention fallback in `HtmlDefuddleMiddleware.ts` | Restore path is uncovered — see Risks |
| Does not narrow discovery | Middleware order in `HtmlPipeline.ts`: metadata and link extraction precede the extractor | Order is asserted only implicitly — see Risks |

## Risks / Trade-offs

- **The spec claims guarantees that no test pins.** Two requirements rest on behavior nothing exercises directly: the empty-document restore path, and the ordering that keeps link discovery ahead of extraction. Both would survive a refactor silently. → tasks.md adds a regression test for each; they are the only code this change produces.

- **Twenty pages is a small sample.** The region share (>98%) and the retention floor (≥21.6%) are both read off one static fetch of 20 sites. A site family absent from that sample could sit lower. → The 0.5 floor is set far from the observed minimum rather than just under it, and the failure mode when it fires is the status quo, not content loss. The sample is recorded above so a future pass can extend rather than re-derive it.

- **Static fetches, not rendered pages.** The measurement used plain HTTP, so JS-rendered layouts are underrepresented — tailwind appeared as a 2 KB shell. → Under Playwright these pages render a normal `<main>`, which is the case the floor handles best; the risk is that an unusual rendered layout was not observed at all.

- **The spec and the selector list can drift.** Categories are specified, entries are not, so a category could quietly lose all its entries without failing validation. → Accepted. The alternative pins the list and makes routine tuning a spec change, which costs more than it protects.

- **Two requirements rest on evidence thinner than the table implies.** Verified during apply: no test covers the ARIA-landmark-role category of chrome removal (the role selectors ship, but only `role="main"` appears in a test, and for a different requirement). And the "advertising is removed after render, not blocked" scenario is cross-capability — it is a property of the seam with `subresource-blocklist`, asserted by neither side. → Recorded rather than fixed: adding an ARIA-role test is a reasonable follow-up, and the render-not-block property is better pinned where the two capabilities meet than inside either one.

- **Configuration policy, not an extractor concern.** An unrecognised `scraper.htmlExtractor` value does not fail startup; the loader warns, quarantines the offending file when writable, and resets to defaults. Only `server.publicOrigin` throws. The spec's scenario was corrected to match during apply. A typo'd extractor therefore runs the default silently apart from that warning — worth revisiting as config-wide behavior, but out of scope for this capability.

- **Doc-only changes are easy to leave half-applied.** The capability describes shipped behavior, so nothing fails if the spec is wrong. → Verification is the requirement-to-evidence map above rather than a test run.
