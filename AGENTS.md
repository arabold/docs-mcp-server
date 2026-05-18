
# Agent Instructions for docs-mcp-server

## Repository Context

- **Repository**: `arabold/docs-mcp-server`
- **Core Stack**: Node.js 22.x, TypeScript, Vite, AlpineJS, TailwindCSS, SQLite (better-sqlite3)
  - **Node Version**: Always use **Node.js v22** for local development and builds, even if `package.json` allows older versions. If `nvm` is installed, run `nvm use 22` before local commands.
- **Tooling**: Biome (lint/format), Vitest (test), Husky (pre-commit)
- **Critical Documentation**:
  - 📖 **Read `README.md`** first for project structure, setup, and configuration details.
  - 🏗️ **Read `ARCHITECTURE.md`** before making changes to understand system design and service interactions.

## Development Workflow

### Key Commands

| Task | Command | Description |
|------|---------|-------------|
| **Setup** | `npm install` | Install dependencies |
| **Build** | `npm run build` | Build both server and web assets |
| **Lint** | `npm run lint` | Check code issues with Biome |
| **Fix** | `npm run lint:fix` | Auto-fix lint issues (add `-- --unsafe` if needed) |
| **Typecheck** | `npm run typecheck` | Run TypeScript compiler checks |
| **Format** | `npm run format` | Format code with Biome |
| **Test All** | `npm test` | Run all tests with Vitest |
| **Test Single** | `npx vitest run <path>` | Run a specific test file (e.g., `src/utils/foo.test.ts`) |

### Git Workflow

- **Branching**: `<type>/<issue>-<desc>` (e.g., `feat/123-add-cache`)
- **Pre-commit**: Husky runs lint, typecheck, and tests. **Never** bypass.
- **Security**: **NEVER** commit secrets, credentials, or sensitive data (e.g., `.env`).

### Dependency Hygiene

- Use `npm ci` (not `npm install`) when you just need `node_modules`; it installs from the lockfile without mutating it. Reserve `npm install` for intentional dependency changes.
- Keep Node 22 — `better-sqlite3` ships a Node-ABI-pinned native binary. Do not bump the engine floor to v24+.
- For occasional CLI tools that aren't part of the runtime (e.g. `promptfoo` for search evals), invoke them via `npx -y <pkg>@<version>` from `package.json` scripts rather than declaring them as dependencies — keeps the dep tree and lockfile clean.

### Commit Messages

Strictly enforced by `commitlint`. Commits will fail if format is incorrect.

- **Format**: `<type>(<scope>): <subject>` (Scope is optional but recommended)
- **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- **Subject Rules**:
  - Must be **lower case**
  - Must **NOT** end with a period
  - Keep header under 100 characters
- **Body/Footer**:
  - Separate from header with a blank line
  - No line length limit (configured in `commitlint.config.js`)

## Code Style & Conventions

### TypeScript
- **Strictness**: No `any` (unless absolutely necessary), no non-null assertions (`!`).
- **Imports**: All imports at top. Auto-sorted by Biome.
- **Naming**:
  - Classes/Interfaces/Types: `PascalCase`
  - Variables/Functions/Methods: `camelCase`
  - Constants: `UPPER_SNAKE_CASE` (global) or `camelCase` (local)
- **TSDoc**: Mandatory for all exported functions/classes. Summary first, then params/returns.

### Error Handling
- **Boundaries**: Use `try/catch` at API/CLI boundaries.
- **Logging**: Log errors via `logger.error` with `❌` prefix.
- **Response**: Return standard HTTP codes (e.g., 500) for API errors.
- **Safety**: Sanitize binary content from error logs.

### Web UI (AlpineJS + HTMX)
- **Components**: AlpineJS with TSX (`kitajs`).
- **Conditionals**: Use ternary `foo ? <Bar/> : null` (avoid `foo && <Bar/>`).
- **Styling**: TailwindCSS utility classes.

## Documentation Guidelines

### File Targets
- `README.md`: User-facing (install, config, usage).
- `ARCHITECTURE.md`: Developer-facing (concepts, system design).
- `docs/*.md`: Deep dives into specific subsystems.

### Writing Principles
- **Tone**: Declarative, present tense.
- **Focus**: "What it does", not "what it doesn't do".
- **Diagrams**: Mermaid for workflows/state. No markdown formatting in diagram titles.

## Logging Strategy

- **User Output**: `console.*` (CLI results).
- **App Events**: `logger.info` (meaningful state changes).
- **Debugging**: `logger.debug` (granular flow, disabled by default).
- **Formats**: Prefix meaningful logs with emojis (e.g., `🔗`, `❌`, `✅`). **Never** use emojis in `debug` logs.

## Testing Approach

### Philosophy
- **Behavior-Driven**: Test observable contracts, not internal state.
- **Levels**: E2E (highest value) > Integration > Unit (complex logic only).
- **Files**:
  - **Single File Policy**: `src/foo.ts` -> `src/foo.test.ts`. Combine unit and integration tests in one file.
  - **No Fragmentation**: Do NOT create separate `*.integration.test.ts` or `*.spec.ts` files.
  - **E2E**: Place system-wide end-to-end tests in `test/*-e2e.test.ts`.

### Best Practices
- **Environment**: Node 22. Use `test/setup-env.ts` for polyfills.
- **Isolation**: Each test should check **one** behavior.
- **Performance**: Keep unit tests <100ms.
- **Mocks**: Use `vi.mock()` sparingly; prefer real dependencies where feasible.

### Test Inventory

Unit + integration tests live next to the code they cover (`src/foo.ts` ↔ `src/foo.test.ts`) — the single-file policy above. The table below catalogues the system-wide E2E suites under `test/`. Run a single suite with `npx vitest run test/<file>`.

| Suite | Covers | Requirements | In default `npm test`? |
|---|---|---|---|
| `cli-e2e.test.ts` | CLI smoke: help, version, unknown-arg handling | none | yes |
| `mcp-stdio-e2e.test.ts` | MCP server over stdio: spawn, protocol handshake, basic tools | none | yes |
| `mcp-http-e2e.test.ts` | MCP server over HTTP/SSE (legacy `/sse` endpoint included) | none | yes |
| `auth-e2e.test.ts` | OAuth2/OIDC end-to-end against a real provider | `.env` with auth config; skips otherwise | yes (skips if no env) |
| `telemetry-e2e.test.ts` | `DOCS_MCP_TELEMETRY` env var controls PostHog init | none (parses debug logs) | yes |
| `html-pipeline-basic-e2e.test.ts` | HTML scrape pipeline against stable endpoints (httpbin.org) | network | yes |
| `html-pipeline-nonhtml-e2e.test.ts` | Non-HTML content (text/plain) bypasses Playwright cleanly | none | yes |
| `html-pipeline-live-e2e.test.ts` | HTML pipeline against real documentation sites (anti-scrape, JS-heavy) | network; slow & flaky | **no** — `npm run test:live` |
| `refresh-pipeline-e2e.test.ts` | Refresh handling: 200/304/404, broken links, etag flow | none (mock server) | yes |
| `archive-integration.test.ts` | `LocalFileStrategy` archive (zip) traversal and extraction | fixture archive | yes |
| `local-file-pdf-e2e.test.ts` | PDF in a `file://` directory is indexed alongside `.txt`/`.md` (regression for issue #394) | Kreuzberg native deps | yes |
| `vector-persistence-e2e.test.ts` | Embeddings land in `documents_vec` virtual table | MSW-mocked OpenAI | yes |
| `vector-search-e2e.test.ts` | Full pipeline: scrape → split → embed → index → search | MSW-mocked OpenAI | yes |
| `github-private-repo-e2e.test.ts` | Auth flow for private GitHub repo scraping | `GITHUB_TOKEN`; skips otherwise | yes (skips if no token) |
| `docker-e2e.test.ts` | Production image: non-root user, Chromium present, Playwright scrape, Kreuzberg PDF, bind-mounted docs folder recursively indexed via `file:///` | Docker daemon; `DOCKER_IMAGE_TAG` to reuse a prebuilt image | **no** — `npm run test:docker` |

Notes:
- The "live" and "docker" suites are excluded from `npm test` / `npm run test:e2e` because they need external network or a Docker daemon. CI runs `docker-e2e.test.ts` in a dedicated `docker-test` job.
- Suites that "skip gracefully" check for their required env at startup and short-circuit when it's missing — safe to leave in the default run.
- Fixtures (sample PDF, docx, xlsx, archive, etc.) live in `test/fixtures/`. Reuse them rather than generating new files on the fly.
