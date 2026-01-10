# Project Context

## Project Purpose & Goals
The **Docs MCP Server** provides a personal, always-current knowledge base for AI agents. It indexes 3rd party documentation from various sources (websites, GitHub, npm, PyPI, local files) and offers powerful, version-aware search tools via the Model Context Protocol (MCP).

**Key Goals:**
- **Reduce Hallucinations:** Ground LLM answers in real, up-to-date documentation.
- **Version Awareness:** Provide answers specific to project dependency versions.
- **Privacy:** Run locally with persistent storage.
- **Compatibility:** Integrate with any MCP-compatible client (Claude, Cline, etc.).

## Repository Structure
- `src/`: Source code (TypeScript).
  - `app/`: Server entry point and configuration.
  - `store/`: Database logic (SQLite) and embeddings.
  - `scraper/`: Documentation fetching and processing pipelines.
  - `mcp/`: MCP protocol implementation.
  - `cli/`: CLI commands.
- `db/`: SQL migration files.
- `docs/`: User and architecture documentation.
- `test/`: End-to-end tests.
- `packages/`: Monorepo packages (if applicable).

## Key Tech Stack
- **Runtime:** Node.js v20+ (Migrating to Bun).
- **Language:** TypeScript.
- **Database:** SQLite (better-sqlite3 → bun:sqlite).
- **Web Server:** Fastify.
- **Protocol:** Model Context Protocol (MCP), tRPC.
- **Frontend:** AlpineJS + TailwindCSS.

## Development Guidelines
- Follow [AGENTS.md](../AGENTS.md) for coding standards.
- Use `openspec` for significant changes (features, architecture, breaking changes).
- Maintain 100% test coverage for critical paths.
