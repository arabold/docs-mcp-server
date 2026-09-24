# Installation

This guide covers the various ways to install and run the Docs MCP Server.

## 🚀 Quick Start (Recommended)

The easiest way to get started is using the standalone server, which includes both the MCP endpoints and the web interface in a single process.

### Option 1: Node.js (npx)

If you have Node.js 22.x installed (recommended for local development), you can run the server directly with a single command. Use `nvm use 22` and run `npm rebuild` if you recently changed Node versions:

```bash
npx @arabold/docs-mcp-server@latest
```

This runs the server on port 6280 by default. Open **[http://localhost:6280](http://localhost:6280)** to access the web interface.

**Optional:** Prefix with `OPENAI_API_KEY="your-openai-api-key"` to enable vector search for improved results.

### Option 2: Docker

Running via Docker ensures you have all dependencies without polluting your host system.

```bash
docker run --rm \
  -v docs-mcp-data:/data \
  -v docs-mcp-config:/config \
  -p 6280:6280 \
  ghcr.io/arabold/docs-mcp-server:latest \
  --protocol http --host 0.0.0.0 --port 6280
```

**Configuration:** The server writes its configuration to `/config/docs-mcp-server/config.yaml`. Mounting the `/config` volume ensures your settings persist across restarts.

**Non-root runtime (this branch's image):** The container uses uid 65534 (`nobody`, primary gid 65534). Following LiteLLM's OpenShift pattern, writable runtime paths are owned by `nobody`, assigned to group 0, and receive matching group permissions for arbitrary OpenShift UIDs. The dedicated home/cache path is `/app/.runtime`; application code under `/app` remains read-only. Data, configuration, and temporary files use `/data`, `/config`, and `/tmp`. Empty named volumes inherit image ownership, while bind mounts replace it. Prepare bind-mounted directories for uid 65534, for example with `sudo chown -R 65534:65534 ./data ./config && sudo chmod -R u+rwX ./data ./config`. On OpenShift, the storage driver and SCC-assigned `fsGroup` must make mounted volumes writable. Existing volumes retain their old ownership and may need a one-time permissions adjustment.

**Optional:** Add `-e OPENAI_API_KEY="your-openai-api-key"` to enable vector search for improved results.

### Option 3: Kubernetes or OpenShift with Helm

The starter chart deploys one unified Docs MCP Server image with persistent
volumes for `/data` and `/config`:

Build and publish this branch's image first, following the
[chart README](../../deployment/helm/docs-mcp-server/README.md#install).
The chart defaults to `ghcr.io/brtydse100/docs-mcp-server:nonroot`.

```bash
helm upgrade --install docs-mcp ./deployment/helm/docs-mcp-server \
  --namespace docs-mcp --create-namespace
```

On ordinary Kubernetes the chart defaults to `runAsUser: 65534`,
`runAsGroup: 65534`, and `fsGroup: 65534` for writable volumes. The root
filesystem is read-only; the chart mounts writable storage at `/data`,
`/config`, `/tmp`, and `/app/.runtime`.
On OpenShift, set `openshift.enabled: true` to omit these identity defaults and
let the Security Context Constraint assign the namespace's permitted UID and group.

Enable an OpenShift Route with a values file:

```yaml
openshift:
  enabled: true
route:
  enabled: true
  host: docs-mcp.apps.example.com
  tls:
    enabled: true
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
```

The chart also accepts `extraResources`, a list of administrator-supplied
Kubernetes objects whose strings may reference the Helm release context. See
the [chart README](../../deployment/helm/docs-mcp-server/README.md) for storage,
Route, local-document mount, and extension examples.

### Configure Your Client

Once the server is running (on port 6280), you need to tell your AI client where to find it.

**Example: Cursor**

Add this to your MCP settings:

```json
{
  "mcpServers": {
    "docs-mcp-server": {
      "type": "streamableHttp",
      "url": "http://localhost:6280/mcp"
    }
  }
}
```

See **[Connecting MCP Clients](../guides/mcp-clients.md)** for instructions for **Claude**, **Cline**, **Zed**, and others.

**Optional:** To improve search quality, see **[Embedding Models](../guides/embedding-models.md)** to configure OpenAI, Ollama, or other providers.

---

## 🔌 Embedded Server

You can run the MCP server directly embedded in your AI assistant without a separate process or web interface. This provides MCP integration only.

Add this to your MCP settings (VS Code, Claude Desktop, etc.):

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

**With Vector Search (API Key):**

```json
{
  "mcpServers": {
    "docs-mcp-server": {
      "command": "npx",
      "args": ["@arabold/docs-mcp-server@latest"],
      "env": {
        "OPENAI_API_KEY": "sk-proj-..."
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

**Note:** When running in embedded mode, you lose access to the Web Interface unless you launch it separately (see [Basic Usage](../guides/basic-usage.md)).

---

## 💻 CLI Usage

For agents and scripts, the CLI is the simplest way to use Grounded Docs — no running server required.

```bash
# Index documentation
npx @arabold/docs-mcp-server@latest scrape react https://react.dev/reference/react

# Query the index
npx @arabold/docs-mcp-server@latest search react "useEffect cleanup" --output yaml

# Fetch a single page as Markdown
npx @arabold/docs-mcp-server@latest fetch-url https://react.dev/reference/react/useEffect
```

The server and CLI share the same local database. Start the server without arguments to run the MCP endpoint and web interface, then use the CLI in parallel to query from an agent or script.

See **[Basic Usage](../guides/basic-usage.md#-cli-usage)** for the full command reference and output formats.

---

## 🤖 Agent Skills

The repository includes ready-made [Agent Skills](https://agentskills.io) in the [`skills/`](https://github.com/arabold/docs-mcp-server/tree/main/skills) directory. These are structured instruction files (`SKILL.md`) that teach AI coding agents how to use the CLI — covering documentation search, index management, and URL fetching.

To install them, copy the skill folders into the appropriate location for your agent. Consult your agent's documentation for the correct path — for example, [Claude Code](https://code.claude.com/docs/en/skills), [Gemini CLI](https://geminicli.com/docs/cli/skills/), or [Cursor](https://cursor.com/docs/context/skills).

See **[Basic Usage](../guides/basic-usage.md#agent-skills)** for the full list of bundled skills and **[agentskills.io](https://agentskills.io)** for the specification and all compatible agents.

---

## 🐳 Advanced: Docker Compose (Scaling)

For production deployments or when you need to scale processing, use Docker Compose to run separate services. The system selects either a local in-process worker or a remote worker client based on the configuration.

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/arabold/docs-mcp-server.git
    cd docs-mcp-server
    ```

2.  **Set your environment variables:**

    ```bash
    export OPENAI_API_KEY="your-key-here"
    ```

3.  **Start all services:**

    ```bash
    docker compose up -d
    ```

### Service Architecture

-   **Worker** (port 8080): Handles documentation processing jobs.
-   **MCP Server** (port 6280): Provides `/sse` endpoint for AI tools.
-   **Web Interface** (port 6281): Browser-based management interface.

See [Deployment Modes](../infrastructure/deployment-modes.md) for more architectural details.
