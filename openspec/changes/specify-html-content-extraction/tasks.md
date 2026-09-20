# Tasks

The capability describes behavior that already ships, so most of the work is
closing the two coverage gaps recorded in design.md — Risks, then confirming
each requirement against the code it claims. No extraction behavior changes.

## 1. Close the coverage gaps the spec exposes

- [x] 1.1 Add a test to `src/scraper/middleware/HtmlSanitizerMiddleware.test.ts` covering the never-empty guarantee: a page whose entire visible text is removed by caller-supplied `excludeSelectors` keeps its text rather than emptying. Verify the new test fails when the pre-sanitization restore is disabled and passes with it in place.
- [x] 1.2 Add a test to `src/scraper/pipelines/HtmlPipeline.test.ts` covering the discovery guarantee: a page whose only sibling links sit inside a `<nav>` landmark (and outside `<main>`) still yields those URLs in `result.links` while the nav text is absent from `result.textContent`. The existing full-stack test only asserts each middleware ran and that a link in surviving prose is found, so it would not catch the extractor being reordered ahead of link discovery.
- [x] 1.3 Run `npx vitest run src/scraper/middleware/HtmlSanitizerMiddleware.test.ts src/scraper/pipelines/HtmlPipeline.test.ts` and verify both files pass.

## 2. Confirm each requirement against the code it claims

Work the requirement-to-evidence table in design.md — Program Design. For each
row, confirm the named test actually asserts the requirement's scenarios rather
than something adjacent; where it does not, note the gap instead of widening
this change.

- [x] 2.1 Confirm the backend-selection requirement: `scraper.htmlExtractor` accepts only `cheerio` and `defuddle` and defaults to `cheerio`, and an out-of-enum value fails configuration load. Verify by checking the enum in `src/utils/config.ts` and the existing config tests cover rejection.
- [x] 2.2 Confirm the chrome-removal requirement: every category named in the spec has at least one covering test, and an entry matching nothing leaves the other categories applied. Verify against the existing selector tests in `HtmlSanitizerMiddleware.test.ts`.
- [x] 2.3 Confirm the region-scoping requirement: all four scenarios (banner outside the region, `role="main"` fallback, small-region guard, no declared region) map to the tests added in PR #506. Verify by name-matching each scenario to a test.
- [x] 2.4 Confirm the preservation guarantees: prose and code naming an ad hostname survive, and a prose link to an ad network's apex domain survives. Verify against the two existing tests that cover this.
- [x] 2.5 Record any row where the evidence does not actually cover the scenario as a follow-up in design.md — Risks rather than fixing it here.

## 3. Reconcile the spec with the prose docs

- [x] 3.1 Check `docs/concepts/content-processing.md` against the spec's stage description and confirm the two agree on what extraction removes; the region-scoping sentence added in PR #506 already covers the new behavior.
- [x] 3.2 Check `docs/guides/benchmarking.md` still describes `defuddle` as an evaluation arm consistent with the spec binding only the default backend, and confirm no wording there implies the two backends carry the same guarantees.

## 4. Validate and close out

- [x] 4.1 Run `openspec validate specify-html-content-extraction --strict` and verify it reports the change as valid.
- [x] 4.2 Run `npm test` and verify the full suite passes with the tests added in group 1.
- [x] 4.3 Run `npm run lint` and `npm run typecheck` and verify neither reports a new issue.
