## 1. llms.txt Parser

- [ ] 1.1 Create `src/scraper/utils/llmsTxtParser.ts` with types (`LlmsTxtResult`, `LlmsTxtLink`, `LlmsTxtSection`) and a `parseLlmsTxt(content: string)` function that extracts H1 (project name), blockquote (summary), H2 sections, and link lists from the llms.txt Markdown format
- [ ] 1.2 Create `src/scraper/utils/llmsTxtParser.test.ts` with tests covering: complete llms.txt with all sections, minimal (H1 + one link), optional section flagging, links with and without descriptions, invalid/empty content, HTML/binary content, edge cases (multiple H1s, malformed links)

## 2. QueueItem Extension

- [ ] 2.1 Add optional `fromLlmsTxt?: boolean` field to `QueueItem` in `src/scraper/types.ts`

## 3. llms.txt Probe and URL Seeding

- [ ] 3.1 Add a `probeLlmsTxt(baseUrl: string, inputUrl: string, signal?: AbortSignal)` method to `WebScraperStrategy` that derives candidate llms.txt URLs (parent directory of input URL path first, then site root), fetches via the existing fetcher (`AutoDetectFetcher`), parses valid responses, and returns the parsed result or null. Skip the probe entirely when `isRefresh` is true.
- [ ] 3.2 Integrate the probe into the crawl initialization in `WebScraperStrategy` (or override the relevant hook in `BaseScraperStrategy.scrape()`): call `probeLlmsTxt` before the BFS loop, filter returned URLs through `shouldProcessUrl()`, and add passing URLs to the queue at depth 0 with `fromLlmsTxt: true`
- [ ] 3.3 Hardcode llms.txt exclusion in `shouldProcessUrl()` or the URL filtering path in `BaseScraperStrategy` (not via configurable `defaultPatterns.ts`) so that `llms.txt` files are always excluded from indexing even when the user provides custom `excludePatterns`

## 4. Markdown Content Negotiation (Accept: text/markdown)

- [ ] 4.1 Add `Accept: text/markdown, text/html;q=0.9, */*;q=0.8` header to all web page fetch requests in the fetcher layer (e.g., `AutoDetectFetcher` or the HTTP utility used by `WebScraperStrategy`). This applies to all web requests, not just llms.txt-discovered pages.
- [ ] 4.2 In the content processing pipeline, detect `Content-Type: text/markdown` (or `text/plain`) responses and route them through the Markdown pipeline, bypassing HTML-to-Markdown conversion. If `Content-Type: text/html`, process through the normal HTML pipeline as before.

## 5. Markdown URL Preference (.md variant for llms.txt pages)

- [ ] 5.1 In `WebScraperStrategy.processItem()`, when `item.fromLlmsTxt` is true, attempt to fetch the `.md` variant before fetching the original URL. For file-like URLs (path has a file extension), append `.md` (e.g., `page.html.md`). For directory-like URLs (trailing `/` or no extension in last segment), append `index.html.md`. Accept the `.md` response only if HTTP 200 and Content-Type is text-based (`text/markdown`, `text/plain`, `text/x-markdown`). Fall back to the original URL on failure. The `.md` variant request SHALL also include the `Accept: text/markdown` header.

## 6. Integration Tests

- [ ] 6.1 Add tests to `src/scraper/strategies/WebScraperStrategy.test.ts` covering: llms.txt probe at subpath, probe fallback to root, probe failure (404), URL seeding with scope filtering, `.md` URL preference success and fallback, deduplication of llms.txt URLs with original URL, llms.txt exclusion from indexing
- [ ] 6.2 Add tests for Markdown content negotiation: verify `Accept: text/markdown` header is sent on all web requests, verify `Content-Type: text/markdown` responses bypass HTML conversion, verify `Content-Type: text/html` responses are processed normally

## 7. Logging

- [ ] 7.1 Add info-level log when llms.txt is detected (include URL and number of URLs extracted)
- [ ] 7.2 Add debug-level log for probe failures (404, network error, parse failure)
- [ ] 7.3 Add debug-level log when `.md` URL preference succeeds or falls back
- [ ] 7.4 Add debug-level log when server responds with `Content-Type: text/markdown` via content negotiation

## 8. Documentation

- [ ] 8.1 Update `README.md` to document automatic llms.txt discovery: explain that the scraper probes for `/llms.txt` before BFS crawling, uses discovered URLs as seeds, and prefers `.md` URL variants for llms.txt pages. Note that this is fully automatic with no configuration required.
- [ ] 8.2 Update `README.md` to document Markdown content negotiation: explain that the scraper sends `Accept: text/markdown` on all web requests, and servers supporting this (e.g., Cloudflare's Markdown for Agents) will return Markdown directly, bypassing HTML-to-Markdown conversion for higher quality output.
- [ ] 8.3 Update `ARCHITECTURE.md` if the llms.txt probe or content negotiation introduces meaningful changes to the scraping pipeline flow or data model (e.g., the `fromLlmsTxt` flag on `QueueItem`, the new parser utility).

## 9. Validation

- [ ] 9.1 Run `npm run lint` and `npm run typecheck` to ensure no regressions
- [ ] 9.2 Run `npm test` to confirm all existing and new tests pass
