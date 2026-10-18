# Connecting MCP Clients

The Docs MCP Server works with any client that supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). This page shows how to connect common clients and lists the tools they get.

## Transports

A client connects in one of two ways:

- **Streamable HTTP** to a running server at `http://localhost:6280/mcp`. Use this when you run the server yourself, with Docker or with `npx @arabold/docs-mcp-server@latest` in a terminal. The same process serves the web UI at `http://localhost:6280`.
- **stdio**, where the client starts the server itself with `npx -y @arabold/docs-mcp-server@latest`. Without a terminal attached, the server selects stdio on its own. This embedded server has no web UI; [Basic Usage](basic-usage.md#launching-web-ui-for-embedded-server) shows how to open one next to it.

Both transports serve MCP protocol revision 2026-07-28, and clients on the earlier revisions from 2024-11-05 to 2025-11-25.

Behind a reverse proxy, the endpoint is the public URL plus `/mcp`, for example `https://example.com/docs/mcp`. See [Reverse Proxy Deployment](../infrastructure/reverse-proxy.md). With authentication enabled, clients need a bearer token for the HTTP endpoint; see [Authentication](../infrastructure/authentication.md).

## Standard Configuration

Most clients read an `mcpServers` object. For stdio:

```json
{
  "mcpServers": {
    "docs-mcp-server": {
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

For a running server over HTTP:

```json
{
  "mcpServers": {
    "docs-mcp-server": {
      "url": "http://localhost:6280/mcp"
    }
  }
}
```

To turn on vector search in an embedded server, add an `env` object to the stdio entry, for example `"env": { "OPENAI_API_KEY": "sk-proj-..." }`. See [Embedding Models](embedding-models.md) for other providers.

These clients take the standard blocks. Some name the HTTP fields differently:

| Client | Where the configuration goes | HTTP entry |
|---|---|---|
| Cursor | `~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project | `"url"` |
| VS Code (GitHub Copilot) | `.mcp.json` in the workspace root | `"type": "http"` and `"url"` |
| Cline | `cline_mcp_settings.json`, opened from Cline's MCP Servers view | `"type": "streamableHttp"` and `"url"` |
| Roo Code | `.roo/mcp.json` in a project, or **Edit Global MCP** | `"type": "streamable-http"` and `"url"` |
| Windsurf (Devin Desktop) | `mcp_config.json`; see the [Cascade MCP docs](https://docs.windsurf.com/windsurf/cascade/mcp) for its location | `"serverUrl"` |
| Gemini CLI | `~/.gemini/settings.json` | `"httpUrl"` |
| JetBrains AI Assistant | **Settings → Tools → AI Assistant → Model Context Protocol (MCP)**, then **Add** | `"url"` |
| LM Studio | **Program** tab → **Install** → **Edit mcp.json** | `"url"` |

Cline needs the `type` field: without it, Cline uses the deprecated SSE transport.

## Claude Code

```bash
# A running server
claude mcp add --transport http docs-mcp-server http://localhost:6280/mcp

# Embedded server (stdio)
claude mcp add docs-mcp-server -- npx -y @arabold/docs-mcp-server@latest
```

Add `--scope user` to make the server available in all projects.

## Claude Desktop

Claude Desktop reads local stdio servers from its configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the standard stdio block and restart Claude Desktop.

To use a server you run yourself, bridge it with the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) package. Custom connectors in Claude's settings connect from Anthropic's cloud, so they cannot reach `localhost`.

```json
{
  "mcpServers": {
    "docs-mcp-server": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:6280/mcp"]
    }
  }
}
```

## Visual Studio

Visual Studio 2022 (17.14 or later) and Visual Studio 2026 read `%USERPROFILE%\.mcp.json` or `.mcp.json` in the solution folder, under a `servers` key:

```json
{
  "servers": {
    "docs-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

For a running server, use `"url": "http://localhost:6280/mcp"` in place of `type`, `command` and `args`.

## Zed

Add the server to `context_servers` in Zed's `settings.json`:

```json
{
  "context_servers": {
    "docs-mcp-server": {
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

For a running server, use `"url": "http://localhost:6280/mcp"` in place of `command` and `args`.

## Continue

Continue reads MCP servers from YAML, for example `.continue/mcpServers/docs-mcp-server.yaml` in the workspace. MCP tools are available in agent mode.

```yaml
name: Docs MCP Server
version: 0.0.1
schema: v1
mcpServers:
  - name: docs-mcp-server
    type: stdio
    command: npx
    args:
      - "-y"
      - "@arabold/docs-mcp-server@latest"
```

For a running server, use `type: streamable-http` and `url: http://localhost:6280/mcp` in place of `command` and `args`.

## opencode

In `opencode.json`:

```json
{
  "mcp": {
    "docs-mcp-server": {
      "type": "local",
      "command": ["npx", "-y", "@arabold/docs-mcp-server@latest"],
      "enabled": true
    }
  }
}
```

For a running server, use `"type": "remote"` and `"url": "http://localhost:6280/mcp"` in place of `command`.

## GitHub Copilot CLI

```bash
copilot mcp add --transport http docs-mcp-server http://localhost:6280/mcp
```

The command stores the server in `~/.copilot/mcp-config.json`. For an embedded server, add an entry there:

```json
{
  "mcpServers": {
    "docs-mcp-server": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"],
      "tools": ["*"]
    }
  }
}
```

## Docker over stdio

A client can start the Docker image as a stdio server. The image serves HTTP unless told otherwise, so pass `--protocol stdio` and keep stdin open with `-i`:

```json
{
  "mcpServers": {
    "docs-mcp-server": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "docs-mcp-data:/data",
        "ghcr.io/arabold/docs-mcp-server:latest",
        "--protocol", "stdio"
      ]
    }
  }
}
```

## Available Tools

| Tool | Purpose | Parameters (defaults) |
|---|---|---|
| `search_docs` | Search an indexed library | `library`, `query`, `version`, `limit` (5) |
| `read_page` | Read a whole indexed page, in parts for long pages | `library`, `pathOrUrl`, `version`, `startChunk` (0), `maxChars` (30000) |
| `list_pages` | List the indexed pages of a version | `library`, `version`, `contains`, `limit` (50, at most 200), `offset` (0) |
| `list_libraries` | List indexed libraries | none |
| `find_version` | Resolve the best matching version | `library`, `targetVersion` |
| `fetch_url` | Fetch one URL as Markdown without indexing it | `url`, `followRedirects` (true) |
| `scrape_docs` | Index a library version | `url`, `library`, `version`, `maxPages` (1000), `maxDepth` (3), `scope` (`subpages`), `followRedirects` (true), `replace` (false), `preserveHashes`, `includePatterns`, `excludePatterns` |
| `refresh_version` | Re-index an existing version, skipping unchanged pages | `library`, `version` |
| `list_jobs` | List indexing jobs | `status` |
| `get_job_info` | Show one indexing job | `jobId` |
| `cancel_job` | Cancel a queued or running job | `jobId` |
| `remove_docs` | Remove a library version | `library`, `version` |

`version` accepts an exact version or a range such as `18.x`. An exact version also matches the closest older one, and an omitted version means the newest. For `refresh_version` and `remove_docs`, an omitted version means the unversioned documentation.

`scrape_docs` and `refresh_version` start a background job and return its ID. Follow it with `get_job_info` or `list_jobs`. `scrape_docs` rejects a version that already exists unless `replace` is true.

The server also offers the resources `docs://libraries` and `docs://libraries/{library}/versions`, plus `docs://jobs` and `docs://jobs/{jobId}`.

In read-only mode (`--read-only` or `DOCS_MCP_READ_ONLY=true`), the server registers only `search_docs`, `read_page`, `list_pages`, `list_libraries`, `find_version` and `fetch_url`, and leaves out the job resources.

## Legacy SSE Transport (Deprecated)

Older clients that only speak the HTTP+SSE transport can connect at `http://localhost:6280/sse` (or the public URL plus `/sse`). The server offers this transport only while authentication is disabled, and a future major release removes it. Move these clients to `/mcp` or stdio. The server logs a deprecation warning when the first such client connects.
