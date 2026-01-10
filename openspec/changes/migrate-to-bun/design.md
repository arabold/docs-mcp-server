## Context
The project currently uses Node.js with standard ecosystem libraries (`axios`, `better-sqlite3`, `memfs`, `ws`, `fastify`). Migrating to Bun offers performance and tooling advantages but requires careful replacement of these with native Bun APIs where appropriate.

## Goals / Non-Goals
- **Goals:**
  - Reduce dependency count by using Bun native APIs.
  - Improve startup time and test execution speed.
  - Simplify tooling (one binary for runtime, package manager, test runner).
- **Non-Goals:**
  - Changing the high-level architecture of the application.
  - Replacing the `fastify` web framework (Phase 1).

## Decisions
- **Decision:** Use `bun:sqlite` instead of `better-sqlite3`.
  - **Rationale:** Native performance, no compilation steps for native bindings.
- **Decision:** Use `Bun.file` for I/O.
  - **Rationale:** Faster async I/O.
- **Decision:** Retain `fastify` and `ws` for WebSockets in Phase 1.
  - **Rationale:** `Bun.serve` is incompatible with `fastify` on the same port. To avoid a complete rewrite of the web layer, we will continue using `ws` (which is compatible with Bun) until a full migration away from Fastify is planned.
- **Decision:** Use Real Temporary Files for testing instead of `memfs`.
  - **Rationale:** Bun does not support `memfs` interception. Real I/O in Bun is fast enough for tests.

## Risks / Trade-offs
- **Risk:** `sqlite-vec` ABI compatibility with `bun:sqlite`.
  - **Mitigation:** Test early. Fallback to `better-sqlite3` (which works in Bun) if native `bun:sqlite` fails to load the extension.
- **Risk:** `axios` vs `fetch` parity.
  - **Mitigation:** Implement explicit status checking and redirect handling in a fetch wrapper.
- **Risk:** Test refactoring effort.
  - **Mitigation:** Introduce `withTempDir` helper to mechanize file system test setup/teardown.

## Migration Plan
See `tasks.md` for the step-by-step execution plan.
