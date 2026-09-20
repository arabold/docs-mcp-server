## 1. Capability Predicate

- [x] 1.1 Create the predicate module (e.g. `src/scraper/pipelines/capability.ts`) exporting a factory that takes a `ContentPipeline[]` and returns `(mimeType: string) => boolean`, implemented as `pipelines.some(p => p.canProcess(mimeType))` with no content argument.
- [x] 1.2 Chose per-strategy-instance: the predicate is built from the strategy's own `this.pipelines`, so a strategy with a different pipeline set gets a matching gate. Construction is a closure over an array that already exists, so memoisation would buy nothing.
- [x] 1.3 Unit-test against every pipeline currently in the standard set: `text/html`, `text/markdown`, `application/json`, `application/pdf`, `text/x-python`, `text/plain` return true; `image/png`, `image/jpeg`, `image/gif`, `image/svg+xml`, `video/mp4`, `application/zip`, `application/octet-stream` return false.
- [x] 1.4 Add a test proving the predicate is never more restrictive than the pipeline-selection loop: for each type the predicate accepts, at least one pipeline's `canProcess(type, buffer)` also accepts it for representative non-binary content.

## 2. Queue-Time Gate

- [x] 2.1 Resolved: the utility strips query and fragment but reads the whole string, so a bare href resolves a type off the TLD (`https://example.zip` → `application/zip`). The caller passes `new URL(link).pathname`. Also confirmed and pinned by test: a dot inside a directory segment yields null, so `/docs/v1.0/guide` is not treated as having an extension.
- [x] 2.2 Added `canProcessDiscoveredLink` to the discovered-link filter in `WebScraperStrategy`, after the archive check and before `shouldProcessUrl`.
- [x] 2.3 Narrowed during implementation: reject only when the detected type is **binary media** (`image/*`, `video/*`, `audio/*`, `font/*`) **and** the predicate refuses it. The draft rule discarded 5 of the 806 pages the reference crawl indexes — all text scripts the `mime` package files under `application/*`, including `/Guess/guess.ps` from issue #490. Added `MimeTypeUtils.isBinaryMediaType()`. Re-measured: zero indexed pages lost, 882 of 1087 wasted fetches still caught.
- [x] 2.3a Null detection falls through untouched.
- [x] 2.4 Emit the `debug` log line on rejection, naming the URL and the rejecting MIME type.
- [x] 2.5 Tests added in `WebScraperStrategy.test.ts` (14) and `mimeTypeUtils.test.ts` (binary-media classification plus dotted-path pinning). Covers: media links rejected without a request; `.pdf`/`.md`/`.html`/`.py`/`.txt`/`.json` admitted; extensionless admitted; `.qbas` and `.ps` admitted as the issue #490 regression guard; `?file=x.png` does not trigger rejection; rejected links absent from `totalDiscovered`.

## 3. Fetch-Time Gate

- [x] 3.1 Added `acceptsMimeType` to `FetchOptions`, named for what it does to a response.
- [x] 3.2 Added `FetchStatus.SKIPPED`. Chose the enum over a `RawContent` field because `BaseScraperStrategy` already branches on status.
- [x] 3.3 `responseType` is now `"stream"`; `readStreamToBuffer` accumulates the body so `RawContent` is unchanged. Buffer/string/ArrayBuffer shapes still tolerated for mocked fetchers.
- [x] 3.4 Confirmed by the existing fetcher suite passing unchanged apart from the two `responseType` pins: charset parsing, `content-encoding` passthrough and `decompress` all behave as before.
- [x] 3.5 Gate sits after `assertNetworkUrlAllowed(finalUrl)` and before body accumulation; rejection destroys the stream and returns SKIPPED.
- [x] 3.6 Confirmed: the 304 branch returns at line 174, well before the gate at 229; the 404 return lives inside the `catch` block and never reaches it. Both pinned by test.
- [x] 3.7 Confirmed by test — a skip returns immediately with one axios call, no retry.
- [x] 3.8 Confirmed by the fetcher suite: challenge detection branches on status, not body, so the browser fallback is unaffected by streaming.
- [x] 3.9 `createFetchOptions` injects `this.canProcessMimeType`.
- [x] 3.10 10 tests added to `HttpFetcher.test.ts` driving real `Readable` streams. Covers: processable response read in full; image response abandoned with the stream destroyed and never drained; absent `Content-Type`; no-predicate case; 304 and 404 not consulting the gate; redirect chain gated on the final hop; skip not retried.

## 4. Strategy And Failure Policy

- [x] 4.1 Added a `SKIPPED` branch to `processBatch` ahead of the SUCCESS guard: no content, no page, no result-bearing progress event.
- [x] 4.2 The branch returns before `recordChildPageCompletion` and never calls `recordChildPageFailure`, so neither side of the failure rate moves.
- [x] 4.3 A depth-0 skip throws a non-retryable `ScraperError` naming the URL, so the job fails loudly instead of completing with zero documents.
- [x] 4.4 4 tests in `BaseScraperStrategy.test.ts`: 900 skips against 100 successes does not trip `abortOnFailureRate: 0.5`; genuine failures alongside skips still abort; a skipped child produces no progress result; a skipped start URL fails the job.

## 5. Verification Against The Reported Case

- [x] 5.1 Re-ran the reference crawl. Requests 2158 → 1013 (−1145, 53%); 141 aborted at headers; 806 indexed; 455 MB transferred, essentially all of it the 94 PDFs the site legitimately indexes; ~265 MB of image downloads eliminated.
- [x] 5.2 Indexed document set identical: 806 before, 806 after, zero lost, zero gained, verified by URL-set diff.
- [x] 5.3 Both `/Guess/guess.qbas` and `/Guess/guess.ps` still indexed. `.ps` drove the gate narrowing in 2.3.
- [x] 5.4 Numbers captured for the PR: requests 2158 → 1013 (−53%), 141 aborted at headers, ~265 MB of image downloads eliminated, 806 documents indexed before and after with a zero-diff URL set.

## 6. Documentation

- [x] 6.1 Added an "Unprocessable-content filtering" subsection to `ARCHITECTURE.md`, next to the sub-resource blocklist. Covers the predicate, both gates, why `application/*` is excluded from the binary-media test, skips not counting as failures, and why there is no config flag.
- [x] 6.2 No README change — there is no user-facing surface.

## 7. Checks

- [x] 7.1 `npm run lint`, `npm run typecheck` clean. Full suite 2008/2008 across 134 files, including `docker-e2e`.
- [x] 7.2 Ran the fetcher suite unchanged first: only the two `responseType: "arraybuffer"` pins failed, both updated to `"stream"`. No behavioural regression from the streaming conversion.
- [x] 7.3 Live e2e run under a temporary filename to bypass the config exclude: 15/16 passed with my change, versus 14/16 on a clean baseline of the same commit. The remaining failure is pre-existing MSW interceptor flakiness in a suite AGENTS.md already labels slow and flaky — not a streaming regression.
