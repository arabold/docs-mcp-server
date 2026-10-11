## Why

The MCP server can now send `instructions` during initialization, but it sends nothing unless an operator writes their own text. Each tool description stands on its own, so the model never learns how the tools fit together: that it should search the indexed documentation before answering from memory, how to find the exact library names and versions that are indexed, and that indexing a missing library is a background job it can follow. A short built-in default gives every installation that guidance without any configuration.

## What Changes

- When neither `server.instructions` nor `server.instructionsFile` is configured, the MCP `initialize` result includes built-in default instructions instead of omitting the field.
- The default describes the cross-tool workflow: search first, pass a version when the project pins one, find the exact library names and versions when a search cannot resolve the library, and read the documentation of a library that is not indexed (with the option to index it and follow the job).
- The default only names tools that are registered in the current mode. In read-only mode it leaves out indexing, job, and removal tools and says that this server cannot index new documentation.
- Configured instructions (inline or from a file) replace the default entirely. The default is not appended to them.
- The default is not a configuration value. It never appears in the loaded configuration, in `config get`, or in the auto-saved configuration file, so it cannot conflict with `server.instructionsFile`.
- There is no setting to turn instructions off. A blank value still means "unset", so the default applies; operators who want different guidance configure their own text.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `configuration`: adds a requirement for the built-in default instructions that the MCP server sends when no instructions are configured, next to the existing "Server Identity Configuration" requirement.

## Impact

- Affected code: `src/mcp/mcpServer.ts` (`resolveServerInstructions()` falls back to the default), plus a new module in `src/mcp/` that builds the default text for a given mode.
- Affected tests: `src/mcp/mcpServer.test.ts` (default content, read-only variant, replacement by configured text, named tools match registered tools) and `test/mcp-stdio-e2e.test.ts` (default instructions reach a real client).
- Affected docs: `docs/setup/configuration.md` (the `instructions` default is no longer "-") and the MCP section of `ARCHITECTURE.md`.
- Every MCP session carries the default text in the model context. It is kept short to limit that cost.
- No dependency or configuration schema changes.
