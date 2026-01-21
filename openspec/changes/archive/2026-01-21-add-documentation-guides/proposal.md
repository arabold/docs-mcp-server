# Change: Add Documentation Guides

## Why
Documentation was reorganized recently, causing the loss of critical configuration details for embedding models. Additionally, users need comprehensive guides for connecting various MCP clients to the server.

## What Changes
- Restore "Embedding Model Configuration" guide with provider-specific examples (OpenAI, Ollama, Gemini, etc.).
- Expand "MCP Clients" guide with detailed installation instructions for 20+ clients (sourced from Nia/Grounded docs), adapted for localhost.
- Update `docs/setup/configuration.md` to link to the new embedding guide.
- Add "Configure Embedding Model" section to `README.md` with a simple example and link to the full guide.

## Impact
- Affected specs: `documentation` (new capability)
- Affected code: `docs/` directory (markdown files only)
