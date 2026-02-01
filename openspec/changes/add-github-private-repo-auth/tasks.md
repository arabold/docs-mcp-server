## 1. Fix JSON Parsing Bug with User-Friendly Errors

- [ ] 1.1 In `GitHubScraperStrategy.ts:fetchRepositoryTree()`, check `rawContent.status` before parsing JSON
- [ ] 1.2 Throw `ScraperError` with user-friendly message for `FetchStatus.NOT_FOUND` that will propagate through the pipeline and display in the web UI (e.g., "Repository not found or not accessible. For private repositories, set GITHUB_TOKEN environment variable.")
- [ ] 1.3 Wrap `JSON.parse()` in try/catch and re-throw as `ScraperError` with actionable context
- [ ] 1.4 Add unit test: verify user-friendly error message when fetching inaccessible repository

## 2. Create Auth Resolution Utility

- [ ] 2.1 Create `src/scraper/strategies/github-auth.ts` with `resolveGitHubAuth()` function
- [ ] 2.2 Implement explicit header passthrough (check for `Authorization` in input)
- [ ] 2.3 Implement `GITHUB_TOKEN` / `GH_TOKEN` env var fallback
- [ ] 2.4 Implement `gh auth token` subprocess fallback with error handling
- [ ] 2.5 Add `logger.debug()` when auto-detecting auth source
- [ ] 2.6 Create `src/scraper/strategies/github-auth.test.ts` with unit tests:
  - [ ] 2.6.1 Returns explicit Authorization header unchanged
  - [ ] 2.6.2 Uses GITHUB_TOKEN when no explicit header
  - [ ] 2.6.3 Uses GH_TOKEN as fallback when GITHUB_TOKEN not set
  - [ ] 2.6.4 Calls gh CLI when no env vars (mock subprocess)
  - [ ] 2.6.5 Returns empty object when nothing available

## 3. Wire Auth Through GitHub Scrapers

- [ ] 3.1 In `GitHubScraperStrategy.ts:processItem()`, call `resolveGitHubAuth(options.headers)` once at start
- [ ] 3.2 Pass resolved headers to `httpFetcher.fetch()` in `fetchRepositoryTree()` (2 locations)
- [ ] 3.3 Pass resolved headers to `GitHubRepoProcessor` and use in `fetch()` call
- [ ] 3.4 Pass resolved headers to `GitHubWikiProcessor` and use in `fetch()` call
- [ ] 3.5 Add unit test: verify headers are passed to httpFetcher.fetch() (mock fetch, check call args)

## 4. Add E2E Tests for Private Repos

- [ ] 4.1 Create `test/github-private-repo-e2e.test.ts`
- [ ] 4.2 Load `.env` at top of file with `import { config } from "dotenv"; config();`
- [ ] 4.3 Implement skip logic: if no `GITHUB_TOKEN` in env, log warning and return early
- [ ] 4.4 Add test: successfully scrape `arabold/private-test-repo` with auth
- [ ] 4.5 Add test: verify scraped content is searchable

## 5. Update Documentation

- [ ] 5.1 Update `docs/setup/configuration.md`: add `GITHUB_TOKEN` / `GH_TOKEN` env vars to the configuration table
