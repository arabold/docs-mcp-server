## 1. Fix JSON Parsing Bug with User-Friendly Errors

- [x] 1.1 In `GitHubScraperStrategy.ts:fetchRepositoryTree()`, check `rawContent.status` before parsing JSON
- [x] 1.2 Throw `ScraperError` with user-friendly message for `FetchStatus.NOT_FOUND` that will propagate through the pipeline and display in the web UI (e.g., "Repository not found or not accessible. For private repositories, set GITHUB_TOKEN environment variable.")
- [x] 1.3 Wrap `JSON.parse()` in try/catch and re-throw as `ScraperError` with actionable context
- [x] 1.4 Add unit test: verify user-friendly error message when fetching inaccessible repository

## 2. Create Auth Resolution Utility

- [x] 2.1 Create `src/scraper/strategies/github-auth.ts` with `resolveGitHubAuth()` function
- [x] 2.2 Implement explicit header passthrough (check for `Authorization` in input)
- [x] 2.3 Implement `GITHUB_TOKEN` / `GH_TOKEN` env var fallback
- [x] 2.4 Implement `gh auth token` subprocess fallback with error handling
- [x] 2.5 Add `logger.debug()` when auto-detecting auth source
- [x] 2.6 Create `src/scraper/strategies/github-auth.test.ts` with unit tests:
  - [x] 2.6.1 Returns explicit Authorization header unchanged
  - [x] 2.6.2 Uses GITHUB_TOKEN when no explicit header
  - [x] 2.6.3 Uses GH_TOKEN as fallback when GITHUB_TOKEN not set
  - [x] 2.6.4 Calls gh CLI when no env vars (mock subprocess)
  - [x] 2.6.5 Returns empty object when nothing available

## 3. Wire Auth Through GitHub Scrapers

- [x] 3.1 In `GitHubScraperStrategy.ts:processItem()`, call `resolveGitHubAuth(options.headers)` once at start
- [x] 3.2 Pass resolved headers to `httpFetcher.fetch()` in `fetchRepositoryTree()` (2 locations)
- [x] 3.3 Pass resolved headers to `GitHubRepoProcessor` and use in `fetch()` call
- [x] 3.4 Pass resolved headers to `GitHubWikiProcessor` and use in `fetch()` call
- [x] 3.5 Add unit test: verify headers are passed to httpFetcher.fetch() (mock fetch, check call args)

## 4. Add E2E Tests for Private Repos

- [x] 4.1 Create `test/github-private-repo-e2e.test.ts`
- [x] 4.2 Load `.env` at top of file with `import { config } from "dotenv"; config();`
- [x] 4.3 Implement skip logic: if no `GITHUB_TOKEN` in env, log warning and return early
- [x] 4.4 Add test: successfully scrape `arabold/private-test-repo` with auth
- [x] 4.5 Add test: verify scraped content is searchable

## 5. Update Documentation

- [x] 5.1 Update `docs/setup/configuration.md`: add `GITHUB_TOKEN` / `GH_TOKEN` env vars to the configuration table
