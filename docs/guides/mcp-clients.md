# Connecting MCP Clients

The Docs MCP Server is compatible with any client that supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). Below are configuration instructions for popular AI assistants and IDEs.

## General Configuration

Most clients support two connection modes:
1.  **Remote/HTTP**: Connects to a running server instance (e.g., via Docker).
    *   **SSE URL**: `http://localhost:6280/sse`
    *   **HTTP URL**: `http://localhost:6280/mcp` (Streamable HTTP)
2.  **Local/Stdio**: Spawns the server process directly.
    *   **Command**: `npx`
    *   **Args**: `["-y", "@arabold/docs-mcp-server@latest"]`

---

## 🤖 Desktop Apps

### Claude Desktop
Edit your configuration file:
*   **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
*   **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

**Remote (Recommended if running Docker):**
```json
{
  "mcpServers": {
    "docs": {
      "type": "sse",
      "url": "http://localhost:6280/sse"
    }
  }
}
```

**Local (Embedded):**
```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

### Cursor
1. Go to **Settings** → **Cursor Settings** → **MCP**.
2. Click **Add new MCP server**.

**Remote:**
*   **Type**: SSE
*   **URL**: `http://localhost:6280/sse`

**Local:**
*   **Type**: stdio
*   **Command**: `npx -y @arabold/docs-mcp-server@latest`

### Windsurf
Open your Windsurf MCP configuration:
*   **macOS**: `~/.windsurf/mcp.json`
*   **Windows**: `%APPDATA%\Windsurf\mcp.json`

```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

### Zed
Add to your Zed `settings.json`:

```json
{
  "context_servers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

### LM Studio
Go to **Program** → **Install** → **Edit mcp.json**:

```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

---

## 💻 VS Code Extensions

### Cline
1. Open **Cline**.
2. Click the **MCP Servers** icon.
3. Choose **Remote Servers** (if running Docker) or **Local Servers**.

**Remote:**
```json
{
  "mcpServers": {
    "docs": {
      "url": "http://localhost:6280/mcp",
      "type": "streamableHttp"
    }
  }
}
```

**Local:**
```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

### Roo Code
Edit your Roo Code MCP config:

```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

### Continue.dev
Edit `~/.continue/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "docs",
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  ]
}
```

### Trae
See [Trae documentation](https://docs.trae.ai/ide/model-context-protocol) for details.

```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

---

## 🛠️ CLI Tools

### Claude Code
```bash
# Current project
claude mcp add docs -- npx -y @arabold/docs-mcp-server@latest

# Global (all projects)
claude mcp add --scope user docs -- npx -y @arabold/docs-mcp-server@latest
```

### Opencode
```json
{
  "mcp": {
    "docs": {
      "type": "local",
      "command": ["npx", "-y", "@arabold/docs-mcp-server@latest"],
      "enabled": true
    }
  }
}
```

### Gemini CLI
Open `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

### Amazon Q Developer CLI
See [Amazon Q Developer docs](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-mcp-configuration.html).

```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

### Copilot CLI
Open `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "docs": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

---

## ☁️ Other Integrations

### JetBrains AI Assistant
1. Go to **Settings** → **Tools** → **AI Assistant** → **Model Context Protocol**.
2. Click **+ Add**.
3. Select **As JSON**:

```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

### Visual Studio 2022
See [Microsoft Docs](https://learn.microsoft.com/visualstudio/ide/mcp-servers).

```json
{
  "servers": {
    "docs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"]
    }
  }
}
```

### Smithery
To install via Smithery:

```bash
npx -y @smithery/cli@latest install @arabold/docs-mcp-server --client <CLIENT_NAME>
```

---

## 🐋 Docker Configuration

If you prefer using Docker for the client connection:

```json
{
  "mcpServers": {
    "docs": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "docs-mcp-data:/data",
        "ghcr.io/arabold/docs-mcp-server:latest"
      ]
    }
  }
}
```
