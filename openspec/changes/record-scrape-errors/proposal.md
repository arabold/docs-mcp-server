## Why

When a scrape fails because too many pages failed, the only thing a user sees is the abort message, for example `Scrape aborted after 83/165 child pages failed (0.50 > 0.50)` (issue #521). It gives counts but not causes. Users of the web UI cannot tell whether the pages returned 404s, were blocked with 403s, or came from a crawler trap. Without that, they cannot write the include or exclude pattern that would fix the next run. The only way to find out today is to read the server's stdout with `--verbose`.

A run that finishes under the threshold has the same blind spot, with less warning. Up to half its pages can fail, and the version still shows as completed with nothing to say that pages are missing.

## What Changes

- Every page-level error a scrape run encounters is recorded individually and persisted with the version: the page URL, a failure category, the HTTP status when there was one, the error message, the crawl depth and the time.
  - Recorded: fetch failures of any kind, pages not found outside a refresh, pages whose content extraction failed, and pages whose content could not be indexed.
  - Not recorded: refresh deletions, skipped unprocessable content and unchanged pages. None of these is an error.
- The history belongs to the version's latest run. Starting a new scrape or refresh of that version discards the previous history. Removing the version removes it. It survives a server restart.
- The page whose failure trips `abortOnFailureRate` is recorded too. Today that page is counted toward the threshold but is never reported.
- The store exposes the history in two forms: a summary grouped by category and HTTP status, with counts and a few sample URLs per group, and a paged list of every recorded error.
- The web UI shows the summary:
  - on the failed-job card, under the error message
  - on the library detail page, for a version whose latest run failed or completed with recorded errors
  - The library detail page can also expand to the full list.

**Non-breaking.** No change to MCP tools, CLI output, configuration, or the meaning of the progress counters. The new table is created by a forward-only migration.

## Capabilities

### New Capabilities

- `scrape-error-history`: what a scrape run records about the pages that failed, how long that record lives, and how it is summarised and shown.

### Modified Capabilities

None. The failure-rate rules in `scrape-failure-policy` and the outcome and counter rules in `scrape-progress-reporting` are unchanged. Recording an error does not affect either.

## Impact

- **Database:** new migration `019` adds the error-history table, keyed to `versions`.
- **Scraper:** `ScraperStrategy.scrape()` gains an optional callback for page errors, which every strategy forwards. `BaseScraperStrategy` reports each page error before the failure-rate check can abort the run.
- **Pipeline:** `PipelineWorker` clears the version's history when a run starts and writes each reported error through the store. It also records indexing failures that it catches itself.
- **Store:** `DocumentStore`, `DocumentManagementService`, `DocumentManagementClient`, the `IDocumentManagement` interface and the data tRPC router gain write, clear, summary and list operations.
- **Web UI:** `FailedJobCard`, `LibraryDetail`, `api/hooks.ts`, `useLiveInvalidation`, and styles in `components.css`.
- **Tests:** unit tests next to the changed modules, plus a mock-server E2E suite added to the test inventory in `AGENTS.md`.
