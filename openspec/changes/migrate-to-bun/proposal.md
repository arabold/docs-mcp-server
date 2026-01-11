# Change: Migrate to Bun Runtime

## Why
To leverage Bun's performance benefits (startup time, execution speed), built-in tooling (test runner, package manager), and native APIs to reduce dependency bloat.

## What Changes
- **Runtime:** Switch from Node.js (v20+) to Bun (latest).
- **Package Management:** Switch from `npm` to `bun install`.
- **Core Libraries:**
  - `axios` → Native `fetch`.
  - `better-sqlite3` → Native `bun:sqlite`.
  - `node:fs` → Native `Bun.file` / `Bun.write` (where applicable).
  - `dotenv` → Native `.env` support.
  - `ws` → Native `Bun.serve` (WebSockets).
- **Tooling:**
  - `vitest` → `bun:test`.

## Impact
- **Affected capabilities:** `runtime` (new).
- **Affected code:** `src/store/`, `src/scraper/`, `src/utils/`, `package.json`, `Dockerfile`.
