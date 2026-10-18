# Agent Instructions for docs-mcp-server

Read `README.md` for setup and configuration, and `ARCHITECTURE.md` before changing how services interact. For everything else, the code and the comments next to it are the reference.

## Environment

- Use Node.js 22 (`nvm use 22`), even though `package.json` allows newer versions. `better-sqlite3` ships a binary pinned to the Node ABI, so do not raise the engine floor.
- Use `npm ci` to get `node_modules`. Use `npm install` only to change dependencies on purpose.
- Run occasional tools such as `promptfoo` through `npx -y <pkg>@<version>` in a `package.json` script instead of adding a dependency.

## Checks

- Run `npm run lint`, `npm run typecheck` and `npm test` before you push. The Husky hooks only run Biome on staged files and commitlint on the message; never bypass them.
- `tsconfig.json` is incremental. Delete `.tsbuildinfo` before a typecheck you rely on, or a warm cache can hide errors that CI catches.
- Run one test file with `npx vitest run <path>`.

## Git

- Branches: `<type>/<issue>-<desc>`, e.g. `feat/123-add-cache`.
- Commits follow Conventional Commits, enforced by commitlint: `<type>(<scope>): <subject>`, with the subject in lower case, no trailing period, and the header under 100 characters.
- Never commit secrets or `.env` files.

## Code

- No `any` and no non-null assertions (`!`). Biome does not flag them.
- Every exported function and class has TSDoc: a summary first, then params and returns.
- Catch errors at API and CLI boundaries. The API answers with standard HTTP status codes.
- Logging: `console.*` for CLI results, `logger.info` for state changes, `logger.debug` for flow details. Prefix info, warning and error messages with an emoji (`❌` for errors); debug messages have none. Keep binary content out of error logs.
- The web UI follows `src/web/client/CONVENTIONS.md`.

## Tests

- Test observable behavior, not internal state. Prefer E2E, then integration tests; write unit tests for complex logic only. Use `vi.mock()` sparingly.
- `src/foo.ts` is tested in `src/foo.test.ts`, unit and integration tests together. Do not add `*.integration.test.ts` or `*.spec.ts` files.
- System-wide E2E suites live in `test/*-e2e.test.ts`. `test/README.md` describes the mock server, the crawl harness and the worker helpers.
- Each test checks one behavior. Unit tests take under 100 ms.
- `npm test` skips the live and Docker suites: run them with `npm run test:live` and `npm run test:docker`. After changing authentication or discovery, run the manual Clerk check (`npm run test:auth:clerk -- --app <app_id>`).
- Reuse the fixtures in `test/fixtures/`.

## Documentation

- `README.md` is for users, `ARCHITECTURE.md` for developers, and `docs/` for deep dives into subsystems.
- Write declaratively and in the present tense, about what the code does.
- Use Mermaid for workflows and state, with no Markdown formatting in diagram titles.
