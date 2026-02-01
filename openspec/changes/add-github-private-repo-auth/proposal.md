# Change: Add GitHub Private Repository Authentication

## Why

The GitHub scraper currently fails with a cryptic `SyntaxError: Unexpected end of JSON input` when accessing private repositories. This is because:
1. The GitHub API returns a 404 for unauthorized access to private repos
2. The `HttpFetcher` returns an empty buffer for 404 responses
3. `JSON.parse("")` throws the unhelpful SyntaxError

Additionally, even though the scraper infrastructure supports custom `headers` in options, the GitHub scraper does not forward them to HTTP requests, making authentication impossible.

## What Changes

- **Fix JSON parsing bug**: Check `FetchStatus` before parsing and throw `ScraperError` with user-friendly messages that propagate through the pipeline and are displayed in the web UI
- **Forward auth headers**: Pass `options.headers` through all `httpFetcher.fetch()` calls in GitHub scraper strategies
- **Add automatic auth fallback**: When no explicit auth is provided, attempt to use:
  1. `GITHUB_TOKEN` or `GH_TOKEN` environment variables
  2. Local `gh auth token` CLI output (if `gh` is installed and authenticated)
- **Add comprehensive tests**: Unit tests for auth chain and error handling, E2E tests for private repos (skipped in CI if no auth)
- **Update documentation**: Document GitHub auth options in configuration docs

## Impact

- Affected specs: `github-scraper` (new capability)
- Affected code:
  - `src/scraper/strategies/GitHubScraperStrategy.ts` - JSON error handling, header forwarding
  - `src/scraper/strategies/GitHubRepoProcessor.ts` - header forwarding
  - `src/scraper/strategies/GitHubWikiProcessor.ts` - header forwarding
  - `src/scraper/strategies/github-auth.ts` (new) - auth resolution utility
  - `docs/setup/configuration.md` - document GITHUB_TOKEN / GH_TOKEN env vars
