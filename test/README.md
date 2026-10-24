# Test Harnesses

This directory holds the system-wide E2E suites and the shared code they run on.
Unit and integration tests live next to the code they cover under `src/`, and
the search benchmarks' own tests live under `tests/search-eval/` and
`tests/search-accuracy/`.

The testing conventions (which level to test at, where a test file goes) are in
[AGENTS.md](../AGENTS.md#tests), and each suite's `describe` blocks say what
it covers. This file explains how to run the tests and how the shared harnesses
work.

## Running Tests

| Command | What it runs |
|---|---|
| `npm test` | Every test under `src/`, `test/` and `tests/`, except the Docker and live suites |
| `npm run test:unit` | The tests under `src/` |
| `npx vitest run test/ --exclude test/docker-e2e.test.ts` | The E2E suites in this directory |
| `npx vitest run <file>` | One test file |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | The `npm test` set with coverage. Install `@vitest/coverage-v8` first; it is not a dev dependency. |
| `npm run test:live` | The live suites: the HTML pipeline against real documentation sites, and GitHub scraping against this repository |
| `npm run test:docker` | The production Docker image suite (needs a Docker daemon) |
| `npm run evaluate:accuracy` | The search accuracy benchmark ([tests/search-accuracy/README.md](../tests/search-accuracy/README.md)); not part of `npm test` |

`npm run test:e2e` runs `npm run build` first and then the same set as
`npm test`: its `test` filter matches every test file path, not only this
directory.

`npm run typecheck` checks `src/`, `test/` and `tests/` together.
`npm run typecheck:build` checks production code only, through
`tsconfig.build.json`.

## What Runs Around Every Test File

`vite.config.ts` holds the test configuration. Each test file runs in its own
child process (`pool: "forks"`), and output from passing tests is suppressed.
Set `ENABLE_TEST_LOGS=1` to see it.

- `test/global-setup.ts` runs once per test run and rebuilds the web UI when its
  build is missing or stale.
- `test/setup-env.ts` replaces `src/utils/logger` with an automatic mock, so
  every `logger.*` method is a spy a test can assert on, and adds a
  `localStorage` stand-in.
- `test/setup-e2e.ts` starts the MSW mock server described below.

The `env` block of `vite.config.ts` keeps the developer's own files away from
tests and the CLIs they spawn: `DOCS_MCP_CONFIG` names a config file and
`DOTENV_CONFIG_PATH` a `.env` file, neither of which exists. Suites that need
real credentials from `.env` load it with dotenv's `config()`, which ignores
`DOTENV_CONFIG_PATH`. `runCli()` and `startCliServer()` also clear
`OPENAI_API_KEY`, since the test config's empty `embeddingModel` falls back to
the default model whenever a key is set.

`npm run test:live` uses `vite.config.live.ts` instead. It drops
`setup-e2e.ts`, so the live suites reach the real network.

`npm run evaluate:accuracy` uses `vite.config.accuracy.ts`, which also drops
`setup-e2e.ts` (the benchmark downloads its corpus and calls the embedding
provider) and prints its output even when it passes.

## Network Isolation

`test/mock-server.ts` defines one MSW server that answers every outgoing HTTP
request a test makes in its own process:

- Fixed handlers answer the endpoints the suites share: OpenAI embeddings and a
  set of `httpbin.org` paths. The embedding handler returns deterministic
  vectors built from character trigrams, so texts with shared words get
  similar vectors and vector search ranks in a meaningful order.
- A catch-all handler comes last. A request to loopback (`localhost`,
  `127.0.0.1`, `[::1]`) goes through, and any other request fails at once as a
  network error. `test/setup-e2e.ts` treats WebSocket connections the same way.
- `http` and `https` requests to loopback skip MSW altogether. MSW cannot pass
  through a request whose agent connects later, as Playwright's request API does
  for `localhost`, so such a request would hang until it timed out.
- MSW ends a mocked response that has no `Content-Length` by closing the
  connection, and does not close one the request asked to keep alive. A request
  that sends `Connection: keep-alive` itself waits for the rest of such a body
  until the test times out, which is why `HttpFetcher` leaves connection-level
  headers to Node.
- An opt-in live suite calls `allowLiveNetwork()` in `beforeAll` once its
  credentials are set, and calls the function it returns in `afterAll`.

To add a shared endpoint, put its response body in `test/fixtures/` and add a
handler before the catch-all in `test/mock-server.ts`. A test that needs a
response only for itself adds a handler with `server.use(...)`;
`test/setup-e2e.ts` resets those handlers after each test.

MSW intercepts requests only inside the test process. A spawned CLI or worker
process makes real requests, so those tests point it at `file://` fixtures or
at a server the test starts on loopback.

## Crawl Suites

Suites that crawl a website describe the site in the test instead of adding
handlers to `mock-server.ts`. Two helpers make this work:

- `mockSite(origin)` (`test/mock-site.ts`) serves one origin through the global
  MSW server from a route table. The routes describe the site's current state:
  a page with an ETag answers `304` to a request that carries it, so a refresh
  against an unchanged site needs no extra setup. The site logs every request
  with its `If-None-Match` value, and a request for a path with no route fails
  the test. Helpers such as `stall()`, `redirect()` and `notFound()` cover the
  error paths.
- `usePipelineHarness(...)` (`test/pipeline-harness.ts`) gives each test a real
  `PipelineManager` over an in-memory store. It runs scrapes and refreshes to
  completion, records their progress events, and reads back what the store
  holds, so a test asserts on what a user of the server would see.

Read the module comments in both files for the full API.

## Server and Worker Suites

Suites that need a running server or a remote worker (`--server-url`) start it
one of two ways:

- `startInProcessServer(...)` (`test/in-process-server.ts`) runs the whole
  application in the test process with a fresh store. Its scrapes reach
  `mockSite()` origins, and a test can set the public URL and authentication
  without spawning the CLI.
- `startWorker(...)` (`test/test-helpers.ts`) spawns a real `worker` process.
  Its jobs scrape `file://` fixtures or `startSlowSite()`, a loopback site that
  answers each page after a delay. `startRunningSlowJob()` submits a scrape of
  that site that runs until it is cancelled.

`test/test-helpers.ts` also holds the helpers these suites share:
`writeTestConfig()` writes the config a spawned process starts with,
`createTcpProxy()` sits between a client and a worker to cut and restore the
connection or refuse WebSocket upgrades, and `runCli()` runs a CLI command to
the end.

A spawned CLI runs `dist/index.js` when it exists and `src/index.ts` through
vite-node otherwise. After a source change, run `npm run build` (or delete
`dist/`) before the CLI and worker suites, so they test the current code.
