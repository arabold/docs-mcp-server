# Connecting MCP Clients

The Docs MCP Server is designed to work with any client that supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

## Connection Types

-   **SSE (Server-Sent Events):** The standard for HTTP-based connections.
-   **Stdio:** Direct process communication (used for Embedded Server).

## 🤖 Claude Desktop / Generic MCP Clients

Add the following configuration to your MCP settings file (typically `claude_desktop_config.json` or similar).

### Connecting to a Standalone Server

If you are running the server separately (via Docker or npx on port 6280):

```json
{
  "mcpServers": {
    "docs-mcp-server": {
      "type": "sse",
      "url": "http://localhost:6280/sse",
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### Running as a Subprocess (Embedded)

If you want the client to manage the server process:

```json
{
  "mcpServers": {
    "docs-mcp-server": {
      "command": "npx",
      "args": ["@arabold/docs-mcp-server@latest"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

## 💻 VS Code (Cline, Roo, etc.)

For VS Code extensions that support MCP:

1.  Open your extension settings.
2.  Locate the **MCP Servers** configuration section.
3.  Add the server configuration.

**Example for HTTP/SSE:**

```json
"docs-mcp-server": {
  "type": "sse",
  "url": "http://localhost:6280/sse"
}
```

**Example for Stdio (Embedded):**

```json
"docs-mcp-server": {
  "command": "npx",
  "args": ["@arabold/docs-mcp-server@latest"]
}
```

## 🔌 Alternative Connection: Streamable HTTP

Some clients may support a streamable HTTP endpoint instead of SSE:

```json
"type": "http",
"url": "http://localhost:6280/mcp"
```
