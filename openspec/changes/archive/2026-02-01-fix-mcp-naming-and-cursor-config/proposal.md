# Change: Fix MCP Naming and Cursor Config

## Why
Consistency in naming the MCP server ("docs-mcp-server") avoids confusion. Cursor specifically works better with `streamableHttp` transport type, so documentation should reflect this best practice.

## What Changes
- Update `docs/guides/mcp-clients.md`:
  - Replace all occurrences of `"docs": {` with `"docs-mcp-server": {`.
  - Change Cursor configuration to use `"type": "streamableHttp"`.
- Update `docs/setup/installation.md`:
  - Replace `"docs": {` with `"docs-mcp-server": {` in the configuration example.
  - Update the Cursor example to use `"type": "streamableHttp"`.

## Impact
- Affected specs: `documentation`
- Affected code: `docs/guides/mcp-clients.md`, `docs/setup/installation.md`
