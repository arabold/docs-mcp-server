# Testing Setup

This directory contains end-to-end (e2e) tests for the docs-mcp-server project.

## Test Structure

The project uses a unified testing configuration in `vite.config.ts` that handles both unit tests and e2e tests:

- **Unit tests**: Located in `src/` alongside source files with `.test.ts` or `.test.tsx` extensions
- **E2E tests**: Located in `test/` directory
- **Live tests**: Special e2e tests that hit real websites (excluded from default runs)

## Running Tests

```bash
# Run all tests (unit + e2e with mock server)
npm test

# Run only unit tests
npm test:unit

# Run only e2e tests
npm test:e2e

# Run live website tests (requires internet, slower)
npm test:live

# Run tests in watch mode
npm test:watch

# Run tests with coverage
npm test:coverage
```

## Mock Server

E2E tests use a mock server (powered by MSW) to intercept requests to external services like `httpbin.org`. This makes tests:

- **Fast**: No actual network requests
- **Reliable**: No dependency on external services
- **Consistent**: Predictable responses every time

### Mock Server Setup

- **Configuration**: `test/mock-server.ts`
- **Fixtures**: `test/fixtures/` contains sample responses
- **Setup file**: `test/setup-e2e.ts` initializes the mock server
- **Unmocked requests fail**: the last handler in `test/mock-server.ts` answers
  every request no other handler claims with a network error, and
  `test/setup-e2e.ts` refuses WebSocket connections the same way. Only loopback
  passes through, so a test cannot reach the real network by accident. Opt-in
  live suites call `allowLiveNetwork()` in `beforeAll` once their credentials
  are set, and release it in `afterAll`.

### Adding New Mock Endpoints

1. Add fixture data to `test/fixtures/`
2. Update `test/mock-server.ts` to add the new handler
3. The mock server will automatically intercept matching requests

### Crawl Suites

Suites that crawl a website (refresh, progress, unprocessable content, empty
pages, Markdown identity) describe the site per test instead of adding handlers
to `mock-server.ts`:

- `mockSite(origin)` (`test/mock-site.ts`) serves one origin from a route table
  through the same MSW server. A page with an ETag answers `304` to a request
  carrying it, `llms.txt` answers `404` unless defined, `stall()` holds a request
  open until the test ends, and every request is logged with its
  `If-None-Match`. A request for a path with no route fails the test.
- `usePipelineHarness(...)` (`test/pipeline-harness.ts`) builds a real
  `PipelineManager` over an in-memory store for each test, runs scrapes and
  refreshes to completion, records their progress events, and reads back what
  the store holds.

## Live Tests

Tests in `test/*-live-e2e.test.ts` are excluded from the default test run because they:

- Hit real websites (MDN, Salesforce, etc.)
- Take longer to execute
- May be rate-limited or blocked
- Can fail due to external factors

Run them manually when needed with `npm test:live`.

## Type Checking

```bash
# Type check all code (src + tests)
npm run typecheck

# Type check only production code (no tests)
npm run typecheck:build
```

## Configuration Files

- `vite.config.ts`: Unified test configuration for Vitest
- `tsconfig.json`: Includes all source and test files for development
- `tsconfig.build.json`: Production-only TypeScript config (excludes tests)
- `test/setup-env.ts`: Common test setup (logger mock, localStorage polyfill)
- `test/setup-e2e.ts`: E2E-specific setup (includes mock server)
