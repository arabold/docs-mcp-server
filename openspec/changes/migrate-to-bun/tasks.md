## 1. Environment & Setup
- [ ] 1.1 Update `Dockerfile` to use `oven/bun` base image.
- [ ] 1.2 Remove `package-lock.json`, `node_modules`, and run `bun install`.
- [ ] 1.3 Remove `dotenv` dependency.
- [ ] 1.4 Update `package.json` scripts to use `bun run` (replace `node`).
- [ ] 1.5 Update `dev:server` script to use `bun --watch` instead of `vite-node`.

## 2. Database Migration
- [ ] 2.1 Remove `better-sqlite3` dependency.
- [ ] 2.2 Refactor `DocumentStore.ts` to use `bun:sqlite`.
- [ ] 2.3 Verify `sqlite-vec` extension loading with `bun:sqlite`.

## 3. Networking Migration
- [ ] 3.1 Remove `axios` and `axios-retry` dependencies.
- [ ] 3.2 Refactor `HttpFetcher.ts` to use global `fetch`.
- [ ] 3.3 Implement `AbortController` for timeouts.
- [ ] 3.4 Implement manual retry logic.

## 4. File System & Config
- [ ] 4.1 Refactor config loading to use `Bun.file().text()`.
- [ ] 4.2 Replace `fs.readFile`/`writeFile` with `Bun.file` APIs where appropriate.
- [ ] 4.3 Update `existsSync` to async `Bun.file().exists()` where possible.

## 5. Server & WebSockets
- [ ] 5.1 Evaluate `fastify` replacement options. (Current Decision: Keep `ws` and `fastify` for Phase 1 compatibility).
- [ ] 5.2 (Future) Migrate to `Bun.serve` if Fastify is removed.

## 6. Testing
- [ ] 6.1 Switch to `bun test`.
- [ ] 6.2 Refactor `memfs` usage to use real temporary directories (`withTempDir` helper).
- [ ] 6.3 Verify all tests pass.
