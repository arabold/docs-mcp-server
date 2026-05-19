## 1. Markdown Link Extraction

- [x] 1.1 Implement link extraction in `src/scraper/middleware/MarkdownLinkExtractorMiddleware.ts` for inline Markdown links (`[text](target)`) while ignoring image links (`![alt](target)`). Preserve raw link target strings in `context.links`.
- [x] 1.2 Add reference-style Markdown link extraction for `[text][ref]` plus `[ref]: target` definitions, including definitions with optional titles.
- [x] 1.3 Avoid duplicate entries while preserving first-seen order.

## 2. Tests

- [x] 2.1 Update `src/scraper/middleware/MarkdownLinkExtractorMiddleware.test.ts` to cover inline links, relative links, absolute links, image exclusion, malformed links, reference-style links, and duplicate handling.
- [x] 2.2 Update `src/scraper/strategies/WebScraperStrategy.test.ts` to cover BFS continuation from a `Content-Type: text/markdown` page with in-scope Markdown links.
- [x] 2.3 Add or update a test proving `Content-Type: text/html` pages continue using HTML link extraction and do not require Markdown link extraction after HTML-to-Markdown conversion.

## 3. Validation

- [x] 3.1 Run `npx vitest run src/scraper/middleware/MarkdownLinkExtractorMiddleware.test.ts src/scraper/strategies/WebScraperStrategy.test.ts`.
- [x] 3.2 Run `npm run lint` and `npm run typecheck`.
- [x] 3.3 Run `npx openspec validate add-markdown-link-extraction --strict`.
