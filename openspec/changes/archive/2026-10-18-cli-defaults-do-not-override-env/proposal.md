# Proposal

## Why

Setting `DOCS_MCP_AUTH_ENABLED=true` starts an unauthenticated server with no warning (issue #494). The `server` and `mcp` commands give their `--auth-enabled`, `--read-only` and `--protocol` options a built-in value, and the configuration loader cannot tell that value apart from one the user typed, so it outranks the environment and the config file. Three documented settings (`auth.enabled`, `app.readOnly`, `server.protocol`) therefore cannot be changed through environment variables or the config file on those commands. Two of them are security controls.

## What Changes

- A CLI option the user did not pass on the command line no longer counts as a CLI override. Its value comes from the next layer down: environment, then config file, then default.
- `DOCS_MCP_AUTH_ENABLED`, `DOCS_MCP_READ_ONLY` and `DOCS_MCP_PROTOCOL`, and their config-file equivalents (including values written with `config set`), take effect on `server` and `mcp`, where until now they were silently discarded.
- A flag passed explicitly still wins over the environment, including a negated one (`--no-read-only`, `--auth-enabled=false`).
- The rule applies to every setting a CLI option maps to, not only the three affected today, and a test enforces it so a future option cannot reintroduce the defect.
- **BREAKING (behavioral)**: a deployment that sets one of these variables, or the matching config-file key, and was silently running with the built-in value will now get the value it configured. For `DOCS_MCP_AUTH_ENABLED=true` that means clients without a valid token start receiving `401`. This is the intended fix, but operators may notice it on upgrade.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `configuration`: the "Environment Variable Precedence" requirement defines what counts as a CLI override. Only an option the user actually passes outranks environment and file values; an omitted option contributes nothing.

## Impact

- **Code**: `src/cli/commands/default.ts` and `src/cli/commands/mcp.ts` (option declarations, and where the transport protocol is resolved relative to configuration loading); `src/cli/utils.ts` (a stale comment in the auth config parser). The loader in `src/utils/config.ts` is already correct and does not change.
- **Tests**: a regression test for the three settings through the real command path, plus a guard that no CLI option mapped to a configuration setting declares a built-in value.
- **Docs**: `docs/infrastructure/authentication.md` and `docs/infrastructure/deployment-modes.md` already document these variables as working. They become accurate and need no rewrite. The CHANGELOG is generated from commits, so the fix commit's body states the behavioral change above; it reaches the release notes that way.
- **Out of scope**: which endpoints authentication protects, OAuth discovery metadata, and serving under a base path. Each is tracked as a separate change.
