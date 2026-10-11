# Design

## Context

See proposal.md for the motivation. The configuration loader already has the right behavior: `mapCliToConfig` in `src/utils/config.ts` copies an argument into the CLI layer only when it is not `undefined`, and the merge order is defaults, then file, then environment, then CLI. The defect is upstream of the loader. yargs fills every option that declares a `default:` into `argv`, so on `server` and `mcp` the arguments `protocol: "auto"`, `readOnly: false` and `authEnabled: false` are always present and win the merge.

A second constraint shapes the fix. Both handlers call `resolveProtocol(argv.protocol)` and set the log level *before* `loadConfig` runs, so the transport is chosen from `argv` alone. Once the yargs default is gone, `argv.protocol` is `undefined` when the flag is omitted, and `resolveProtocol` throws on it.

## Goals / Non-Goals

**Goals:**
- An omitted option contributes nothing to configuration, on every command and for every mapped setting.
- `--help` still shows each option's default.
- A test fails when an option mapped to a setting declares a built-in value again.

**Non-Goals:**
- Changing the loader's merge order or its handling of environment aliases.
- Tidying the unrelated commented-out port validation in the two handlers.

## Decisions

**Remove the built-in value from mapped options; leave the loader alone.** `DEFAULT_CONFIG` already holds the same defaults (`protocol: "auto"`, `readOnly: false`, `auth.enabled: false`). Removing them from yargs puts each default back in its own layer.
- *Alternative: filter defaulted keys inside the loader using yargs' `parsed.defaulted`.* Rejected. It couples the config module to parser internals, `argv` does not carry that information into the handler, and the built-in values would still exist in two places that can drift apart.
- *Alternative: rank environment above CLI.* Rejected. It breaks the explicit-flag-wins rule that the spec keeps.

**Keep the help text with `defaultDescription`.** yargs prints `defaultDescription` in `--help` without injecting a value into `argv`, so the user-visible help stays the same.

**Resolve the transport from loaded configuration.** Move `loadConfig` ahead of `resolveProtocol` and pass it `appConfig.server.protocol`. This is safe for stdio because the logger writes to stderr (`src/utils/logger.ts`). Anything `loadConfig` logs before the level is set cannot land in the stdout JSON-RPC stream.

**Report resolved values to telemetry.** The `CLI_COMMAND` event currently sends `argv.protocol`, `argv.readOnly` and `!!argv.authEnabled`. Once `argv` omits these, telemetry would report `false` for a server that env-enabled auth. The track call moves after `loadConfig` and sends the resolved values for these three fields; the rest of its payload is unchanged.

**Guard structurally, not per setting.** The guard test drives each command factory's builder against a recording stub. The stub captures `.option(name, opts)` and fails for any option whose name or alias is a mapped CLI key and whose `opts` sets `default`. This covers future mappings without needing a sample value per setting.
- *Alternative: a behavioral test per mapping (set env, parse, assert).* Rejected as the guard: it needs a valid value for every mapped setting and silently skips mappings nobody adds a case for. Behavioral tests stay for the three settings the proposal names.

## Program Design

```
src/
  cli/
    commands/
~     default.ts        # no built-in value on protocol/read-only/auth-enabled; protocol + telemetry from loaded config
~     default.test.ts   # env and config-file values reach the server; --no-read-only beats env
~     mcp.ts            # same changes as default.ts
~     mcp.test.ts       # same, plus DOCS_MCP_PROTOCOL=http selects HTTP with no TTY
~   index.ts            # export COMMAND_FACTORIES and registerGlobalOptions, which createCli uses
~   index.test.ts       # guard: no option mapped to a setting declares a built-in value
~   utils.ts            # drop the stale createOptionWithEnv comment in parseAuthConfig
  utils/
~   config.ts           # export the CLI keys that map onto settings, for the guard
```

New export in `src/utils/config.ts`, derived from `configMappings` so the table stays the single source:

```ts
/** CLI option keys (camelCase) that map onto a configuration setting. */
export function getConfigMappedCliKeys(): ReadonlySet<string>;
```

It is pure and cannot fail. Keys are the camelCase `cli` values (`authEnabled`, `readOnly`, `protocol`, …). The guard therefore camelCases each option's name before comparing, and also compares its `alias`, so a dashed option declared without an alias still matches. The guard also covers the global options that `createCli` declares on the root builder (`store-path` is mapped), not only the options inside command factories.

Handler order, identical in `default.ts` and `mcp.ts`:

```
command handler(argv)
-   telemetry.track(CLI_COMMAND, { protocol: argv.protocol, readOnly: argv.readOnly, authEnabled: !!argv.authEnabled, … })
-   resolveProtocol(argv.protocol)            # always "auto": env and file ignored
-   setLogLevel(ERROR) | applyGlobalCliOutputMode(…)
    loadConfig(argv, …)                       # argv no longer carries un-passed options
+   telemetry.track(CLI_COMMAND, { protocol: appConfig.server.protocol, readOnly: appConfig.app.readOnly, authEnabled: appConfig.auth.enabled, … })
+   resolveProtocol(appConfig.server.protocol)
+   setLogLevel(ERROR) | applyGlobalCliOutputMode(…)   # invariant: still before the stdio transport writes to stdout
    parseAuthConfig(appConfig.auth…)          # unchanged: already reads loaded config
```

Regression tests use the existing harness in `mcp.test.ts` and `default.test.ts`. That harness runs a real `yargs()` against the command factory with `startAppServer` and `startStdioServer` mocked. Assertions read the `appConfig` argument (5th for `startAppServer`, 2nd for `startStdioServer`) and check which of the two was called. Each test sets and restores its own env vars and points `--config` at an empty temp file, so the machine's real config file cannot leak in.

## Risks / Trade-offs

- [A deployment that set `DOCS_MCP_AUTH_ENABLED=true` and has been running open starts returning `401` after upgrade] → Intended. semantic-release builds the CHANGELOG from commits, so the fix commit's body states the change plainly and it reaches the release notes. It uses no `BREAKING CHANGE:` footer, because that would force a major version bump for a bug fix.
- [An invalid `DOCS_MCP_PROTOCOL` value that used to be ignored now stops startup with "Invalid protocol"] → Also correct behavior, and the error names the bad value. Mention it next to the auth note.
- [`auth.enabled` from env or config file now also reaches stdio launches (`mcp` over stdio, the default for editor integrations). Until `modernize-mcp-http-surface` lands, the existing auth validation then fails startup when the issuer or audience is missing, although auth never applies to stdio] → The two changes ship in the same release. `modernize-mcp-http-surface` makes stdio ignore auth with a warning. If this change ever ships alone, it needs that same stdio exemption.
- [`defaultDescription` drifts from `DEFAULT_CONFIG`] → Low cost: it is display text only, and all three values are single literals next to each other.
- [The guard only sees options declared with `.option()` inside a command builder] → Every command registers options that way today. The guard asserts that it recorded at least one declaration (an option or a positional) per factory, so a builder that moved to another pattern fails loudly instead of passing vacuously. It reads the factories from `COMMAND_FACTORIES` and the root options from `registerGlobalOptions`, both exported by `src/cli/index.ts`, so it covers exactly what `createCli` registers.

## Migration Plan

No data or configuration migration. Rollback is a plain revert.
