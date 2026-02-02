<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# Agent Instructions for docs-mcp-server

## Repository Context

- **Repository**: `arabold/docs-mcp-server`
- **Core Stack**: Node.js 22.x, TypeScript, Vite, AlpineJS, TailwindCSS, SQLite (better-sqlite3)
  - **Node Version**: Always use **Node.js v22** for local development and builds, even if `package.json` allows older versions.
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
