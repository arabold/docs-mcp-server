# Tasks

## 1. Failing regression tests

- [x] 1.1 In `src/cli/commands/mcp.test.ts`, add a test that sets `DOCS_MCP_AUTH_ENABLED=true` (plus issuer/audience), parses `mcp --protocol http` with `--config` pointed at an empty temp file, and asserts the `appConfig` passed to `startAppServer` has `auth.enabled === true`. Verify it fails on the current code.
- [x] 1.2 In `src/cli/commands/mcp.test.ts`, add a test that sets `DOCS_MCP_PROTOCOL=http`, mocks `process.stdin.isTTY`/`process.stdout.isTTY` as `false`, parses `mcp` with no `--protocol`, and asserts `startAppServer` is called and `startStdioServer` is not. Verify it fails on the current code.
- [x] 1.3 In `src/cli/commands/default.test.ts`, add tests that (a) a config file setting `app.readOnly: true`, with no flag and no env, reaches `startAppServer` as `app.readOnly === true`, and (b) `DOCS_MCP_READ_ONLY=true` plus `--no-read-only` yields `app.readOnly === false`. Verify (a) fails on the current code and (b) passes.
- [x] 1.4 In `src/cli/commands/default.test.ts`, add a test that with no flag, env var, or config entry, `startAppServer` receives `auth.enabled === false`, `app.readOnly === false`, `server.protocol === "auto"`. Verify it passes both before and after the fix.

## 2. Fix the two commands

- [x] 2.1 In `src/cli/commands/default.ts` and `src/cli/commands/mcp.ts`, remove `default:` from the `protocol`, `read-only` and `auth-enabled` options and add `defaultDescription` with the same value. Verify `node dist/index.js mcp --help` still shows the defaults after `npm run build`.
- [x] 2.2 In both handlers, move `loadConfig` ahead of `resolveProtocol` and the log-level setup, and pass `appConfig.server.protocol` to `resolveProtocol`. Verify tests 1.2 and 1.4 pass and the existing `test/mcp-stdio-e2e.test.ts` suite still passes, which shows the stdio stream is not corrupted.
- [x] 2.3 In both handlers, move the `CLI_COMMAND` telemetry call after `loadConfig` and report `protocol`, `readOnly` and `authEnabled` from `appConfig`. Verify existing telemetry assertions in `default.test.ts`/`mcp.test.ts` still pass; update any that asserted the raw `argv` values.
- [x] 2.4 Remove the stale `createOptionWithEnv` sentence from the `parseAuthConfig` TSDoc in `src/cli/utils.ts`. Verify `grep -rn createOptionWithEnv src` returns nothing.
- [x] 2.5 Verify tests 1.1–1.3 now pass.

## 3. Structural guard

- [x] 3.1 Export `getConfigMappedCliKeys(): ReadonlySet<string>` from `src/utils/config.ts`, derived from `configMappings`, with TSDoc. Verify with a unit test in `src/utils/config.test.ts` that it contains `authEnabled`, `readOnly` and `protocol`.
- [x] 3.2 In `src/cli/index.test.ts`, add a guard that runs every command factory registered by `createCli`, and the root builder's global options, against a recording yargs stub. It fails for any option whose camelCased name or alias is in `getConfigMappedCliKeys()` and declares `default`. Also fail if a factory records nothing: no option and no positional (`config` declares only positionals). Verify it passes now, then temporarily re-add `default: false` to `read-only` and confirm the guard fails naming that option.

## 4. Verification

- [x] 4.1 Run `npm run lint`, `npm run typecheck` (with a cold cache: delete `*.tsbuildinfo` first) and `npm test` on Node 22. Verify all pass.
- [x] 4.2 Manually verify the end-to-end symptom from issue #494: `DOCS_MCP_AUTH_ENABLED=true DOCS_MCP_AUTH_ISSUER_URL=… DOCS_MCP_AUTH_AUDIENCE=… node dist/index.js mcp --protocol http`, then `curl -X POST` to `/mcp` without a token. Verify a `401` comes back. On the unfixed build the same request returns `200`.
- [x] 4.3 Run `openspec validate cli-defaults-do-not-override-env --strict`. Verify it reports no issues.
