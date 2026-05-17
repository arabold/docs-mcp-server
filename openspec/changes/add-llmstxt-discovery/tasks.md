## 1. llms.txt Parser

- [x] 1.1 Create `src/scraper/utils/llmsTxtParser.ts` with types (`LlmsTxtResult`, `LlmsTxtLink`, `LlmsTxtSection`) and a `parseLlmsTxt(content: string)` function that extracts H1 (project name), blockquote (summary), H2 sections, and link lists from the llms.txt Markdown format. Preserve raw relative link targets for the web strategy to resolve against the discovered llms.txt URL.
- [x] 1.2 Create `src/scraper/utils/llmsTxtParser.test.ts` with tests covering: complete llms.txt with all sections, minimal (H1 + one link), optional section flagging, links with and without descriptions, relative links, invalid/empty content, HTML/binary content, edge cases (multiple H1s, malformed links)

## 2. QueueItem Extension

- [x] 2.1 Add optional `fromLlmsTxt?: boolean` field to `QueueItem` in `src/scraper/types.ts`

## 3. llms.txt Probe and URL Seeding

- [x] 3.1 Add a `probeLlmsTxt(baseUrl: string, inputUrl: string, signal?: AbortSignal)` method to `WebScraperStrategy` that derives candidate llms.txt URLs (parent directory of input URL path first, then site root), fetches via the existing fetcher (`AutoDetectFetcher`) so outbound access policy is enforced, parses valid responses, and returns the parsed result plus the discovered llms.txt URL or null. Run the probe for both normal scrapes and refreshes.
- [x] 3.2 Integrate the probe into `WebScraperStrategy` so llms.txt link filtering/enqueueing occurs after the depth-0 canonical scope base is established. Resolve relative llms.txt links against the discovered llms.txt URL, filter resolved HTTP(S) URLs through `shouldProcessUrl()`, dedupe with the normal visited set, and add passing URLs to the queue at depth 0 with `fromLlmsTxt: true`.
- [x] 3.3 Hardcode llms.txt exclusion in `shouldProcessUrl()` or the URL filtering path in `BaseScraperStrategy` (not via configurable `defaultPatterns.ts`) so URLs whose pathname basename is exactly `llms.txt` are always excluded from indexing even when the user provides custom `excludePatterns`.

## 4. Markdown Content Negotiation (Accept: text/markdown)

- [x] 4.1 Add default `Accept: text/markdown, text/html;q=0.9, */*;q=0.8` behavior to HTTP(S) web fetch requests without overwriting caller-supplied `Accept`/`accept` headers. Cover both `HttpFetcher` and browser-backed fetch paths used by web scraping.
- [x] 4.2 Ensure Markdown MIME responses (`text/markdown`, `text/x-markdown`, `text/mdx`, `text/x-gfm`) route through the Markdown pipeline, bypassing HTML-to-Markdown conversion. Keep generic `text/plain` on the text pipeline unless it is an accepted llms `.md` variant or a conservative Markdown-content heuristic is implemented. If `Content-Type: text/html`, process through the normal HTML pipeline as before.

## 5. Markdown URL Preference (.md variant for llms.txt pages)

- [x] 5.1 In `WebScraperStrategy.processItem()`, when `item.fromLlmsTxt` is true, attempt to fetch the `.md` variant before fetching the original URL. Build variants as `/guide/` -> `/guide/index.html.md`, `/guide` -> `/guide/index.html.md`, and `/guide.html` -> `/guide.html.md`. Accept the `.md` response only if HTTP 200 and Content-Type is Markdown or safe text (`text/markdown`, `text/plain`, `text/x-markdown`, etc.). Fall back to the original URL on non-200, non-text, access-policy rejection, or network error. The `.md` variant request SHALL also use the Markdown-preferred Accept default unless the caller supplied an explicit Accept header.

## 6. Integration Tests

- [x] 6.1 Add tests to `src/scraper/strategies/WebScraperStrategy.test.ts` covering: llms.txt probe at subpath, probe fallback to root, probe failure (404/access-policy rejection), URL seeding with scope filtering after depth-0 redirects, relative URL resolution, `.md` URL preference success and fallback, deduplication of llms.txt URLs with original URL, llms.txt exclusion from indexing
- [x] 6.2 Add tests for Markdown content negotiation: verify `Accept: text/markdown` header is sent by default on web requests, verify custom Accept headers are preserved, verify `Content-Type: text/markdown` responses bypass HTML conversion, verify generic `Content-Type: text/plain` remains text unless accepted as an llms `.md` variant or identified by an implemented Markdown heuristic, verify `Content-Type: text/html` responses are processed normally

## 7. Logging

- [x] 7.1 Add info-level log when llms.txt is detected (include URL and number of URLs extracted)
- [x] 7.2 Add debug-level log for probe failures (404, network error, parse failure)
- [x] 7.3 Add debug-level log when `.md` URL preference succeeds or falls back
- [x] 7.4 Add debug-level log when server responds with `Content-Type: text/markdown` via content negotiation

## 8. Documentation

- [x] 8.1 Update `README.md` to document automatic llms.txt discovery: explain that the scraper probes for `/llms.txt` before BFS crawling, uses discovered URLs as seeds, and prefers `.md` URL variants for llms.txt pages. Note that this is fully automatic with no configuration required.
- [x] 8.2 Update `README.md` to document Markdown content negotiation: explain that the scraper sends `Accept: text/markdown` on all web requests, and servers supporting this (e.g., Cloudflare's Markdown for Agents) will return Markdown directly, bypassing HTML-to-Markdown conversion for higher quality output.
- [x] 8.3 Update `ARCHITECTURE.md` if the llms.txt probe or content negotiation introduces meaningful changes to the scraping pipeline flow or data model (e.g., the `fromLlmsTxt` flag on `QueueItem`, the new parser utility).

## 9. Validation

- [x] 9.1 Run `npm run lint` and `npm run typecheck` to ensure no regressions
- [x] 9.2 Run `npm test` to confirm all existing and new tests pass
