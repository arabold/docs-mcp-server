# Change: Update Installation Documentation

## Why
The installation guide describes how to run the server via Node.js or Docker but lacks instructions on how to configure an MCP client (like Cursor) to connect to this running instance. Users need a clear "next step" to make the server useful.

## What Changes
- Update `docs/setup/installation.md`:
  - Add a "Configure Your Client" section after the Quick Start options.
  - Provide a JSON configuration example for Cursor/VS Code connecting to the standalone server (HTTP/SSE).
  - Add links to `docs/guides/mcp-clients.md` for other clients.
  - Add a link to `docs/guides/embedding-models.md` for configuring embeddings.

## Impact
- Affected specs: `documentation`
- Affected code: `docs/setup/installation.md`
