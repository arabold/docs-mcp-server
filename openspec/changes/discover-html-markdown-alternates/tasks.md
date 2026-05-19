## 1. Alternate Extraction Utility

- [ ] 1.1 Add a focused HTML Markdown alternate extractor that parses raw HTML without Playwright and returns resolved candidate URLs for `<link rel="alternate">` elements with Markdown MIME `type` values.
- [ ] 1.2 Reuse or mirror the existing cautious `<base href>` resolution behavior from HTML link extraction for resolving alternate `href` values.
- [ ] 1.3 Add unit tests for eligible Markdown alternates, multiple `rel` tokens, relative URLs, `<base href>`, alternate stylesheets, feeds, PDFs, HTML alternates, missing `type`, invalid `href`, and non-HTTP(S) URLs.

## 2. Early Web Scraper Integration

- [ ] 2.1 Integrate alternate discovery in `WebScraperStrategy` after a successful HTML fetch and before selecting/running `HtmlPipeline`.
- [ ] 2.2 Fetch eligible alternate candidates with the existing fetcher path and existing request options so redirects, caller headers, cancellation, and outbound access policy continue to apply.
- [ ] 2.3 Validate alternate responses by actual status and MIME type before replacing the original HTML response with the Markdown response.
- [ ] 2.4 Fall back to the original HTML response on missing candidates, policy rejection, fetch errors, non-success status, redirects to blocked targets, or non-Markdown response MIME types.
- [ ] 2.5 Ensure accepted alternates skip Playwright, HTML sanitization, HTML normalization, and HTML-to-Markdown conversion for the original HTML page.

## 3. Scope, Deduplication, and Ordering

- [ ] 3.1 Apply existing scope checks, include/exclude pattern checks, and optional custom follow-link policy before fetching a resolved alternate URL.
- [ ] 3.2 Treat an accepted alternate as the representation of the original page and avoid enqueueing or indexing both resources solely because of the alternate relationship.
- [ ] 3.3 Preserve existing llms.txt ordering: implicit `.md` variant first for `fromLlmsTxt` pages, then original HTML alternate discovery only if the implicit variant fails and the original response is HTML.
- [ ] 3.4 Preserve existing Markdown content negotiation behavior for all web requests.

## 4. Integration Tests

- [ ] 4.1 Add web scraper tests proving a valid Markdown alternate is processed through the Markdown pipeline and Playwright/HTML conversion are skipped.
- [ ] 4.2 Add fallback tests for no alternate, unsupported alternate types, failed alternate fetch, non-Markdown alternate response, out-of-scope alternate, custom follow-link rejection, and access-policy rejection.
- [ ] 4.3 Add tests proving accepted alternates do not create duplicate indexed documents and that links from accepted Markdown content continue normal crawl filtering.
- [ ] 4.4 Add tests for ordering with llms.txt `.md` preference success and fallback to HTML alternate discovery.

## 5. Documentation and Validation

- [ ] 5.1 Update README or architecture documentation if the early alternate discovery path materially changes the documented Markdown-optimized web scraping behavior.
- [ ] 5.2 Run `npm run lint` and `npm run typecheck`.
- [ ] 5.3 Run targeted scraper tests, including `src/scraper/strategies/WebScraperStrategy.test.ts` and any new alternate extractor tests.
- [ ] 5.4 Run broader tests if changes touch shared pipeline or fetcher behavior.
