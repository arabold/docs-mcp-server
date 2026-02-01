## Context

The GitHub scraper uses the GitHub REST API to fetch repository trees and file contents. For private repositories, the API requires authentication via a Bearer token. The scraper infrastructure already supports custom headers in `ScraperOptions`, but this is not wired through to the GitHub-specific fetcher calls.

**Current flow (broken for private repos):**
```
User → ScrapeTool { headers: { Authorization: "Bearer ..." } }
  → ScraperService → GitHubScraperStrategy.processItem(options)
    → httpFetcher.fetch(url, { signal })  // ❌ headers NOT passed
      → GitHub API returns 404 (unauthorized)
        → HttpFetcher returns { status: NOT_FOUND, content: Buffer.from("") }
          → JSON.parse("") throws SyntaxError
```

**Constraints:**
- Cannot break existing public repo scraping
- Must work in CI/CD environments (env vars) and local dev (`gh` CLI)
- E2E tests for private repos must skip gracefully when no auth is available

## Goals / Non-Goals

**Goals:**
- Fix the JSON parsing error with a clear, actionable error message
- Enable private repository scraping via explicit headers or auto-detected auth
- Provide seamless local dev experience using existing `gh` CLI auth
- Support CI/CD via standard `GITHUB_TOKEN` / `GH_TOKEN` environment variables

**Non-Goals:**
- GitHub App authentication (requires additional complexity)
- Fine-grained permission scoping (use whatever token the user provides)
- OAuth flow integration (out of scope; users authenticate externally)

## Decisions

### Decision 1: Auth Resolution Order

Resolve GitHub authentication in this order (first match wins):
1. **Explicit `Authorization` header** in `options.headers` - user has full control
2. **`GITHUB_TOKEN` environment variable** - standard GitHub Actions / CI convention
3. **`GH_TOKEN` environment variable** - alternative used by some CI systems
4. **`gh auth token` CLI** - local development convenience

**Rationale:** This mirrors how GitHub's own `gh` CLI resolves authentication and follows the principle of least surprise.

### Decision 2: Auth Utility Location

Create a new file `src/scraper/strategies/github-auth.ts` with a single async function:

```typescript
export async function resolveGitHubAuth(
  explicitHeaders?: Record<string, string>
): Promise<Record<string, string>>
```

**Rationale:** Keeps auth logic isolated and testable. The function is pure except for env var and subprocess reads.

### Decision 3: Always Attempt Auth

Always resolve auth headers, even for public repos.

**Rationale:** 
- Authenticated requests have 5,000 req/hour vs 60 req/hour unauthenticated
- The subprocess overhead of `gh auth token` is negligible (~50ms once)
- Simplifies code (no branching on repo visibility)

### Decision 4: Logging Level

Use `logger.debug()` when auth is auto-detected (not `info`).

**Rationale:** Per user preference - avoid noise for normal operations while remaining inspectable with debug logging.

### Decision 5: E2E Test Strategy

- Use `arabold/private-test-repo` as the hardcoded test repository
- Load `GITHUB_TOKEN` from `.env` in E2E tests
- Skip private repo tests if no auth is available (CI will not have the token)
- Use the existing pattern: early return with console warning

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| `gh` CLI not installed | Silently fall back; no error, just no auth |
| `gh auth token` fails (not logged in) | Catch error, continue without auth |
| Token has insufficient permissions | GitHub API will return 403; improve error message |
| Subprocess spawn blocked (sandboxed env) | Catch error, continue without auth |

## Open Questions

None - all questions resolved in the discussion.
