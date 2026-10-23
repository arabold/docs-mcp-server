# Installation

The server runs with Node.js or Docker. Either way it runs as one of two things:

- an HTTP server with the web UI, the API and the MCP endpoint, which any number of clients connect to;
- an MCP server on stdio that an AI client starts itself (see [Embedded Server](#embedded-server)).

## Quick Start

### Option 1: Node.js (npx)

Requires Node.js 22 or later.

```bash
npx @arabold/docs-mcp-server@latest
```

Started from a terminal, this runs the HTTP server on port 6280:

- Web UI: `http://localhost:6280`
- MCP endpoint: `http://localhost:6280/mcp`

The server listens on `127.0.0.1` only. [Configuration](configuration.md) covers the host, the port and every other setting.

On its first start, the server installs Playwright's Chromium, which it uses for pages that need JavaScript. To use a Chromium you already have, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable.

To get a `docs-mcp-server` command instead of calling npx each time, install the package globally:

```bash
npm install -g @arabold/docs-mcp-server
docs-mcp-server
```

### Option 2: Docker

```bash
docker run --rm \
  -v docs-mcp-data:/data \
  -v docs-mcp-config:/config \
  -p 6280:6280 \
  ghcr.io/arabold/docs-mcp-server:latest
```

The web UI and the MCP endpoint are at the same addresses as with npx. The image runs on `linux/amd64` and `linux/arm64`. Besides `latest`, each release has a tag for its version (such as `3.2.1`), its minor version (`v3.2`) and its major version (`v3`).

**Volumes:** `/data` holds the database and `/config` holds `docs-mcp-server/config.yaml`. Keep both on volumes so they survive restarts.

**Server defaults:** The image starts the HTTP server on `0.0.0.0:6280` with the web UI, API and MCP endpoint, including when you pass other options such as `--verbose`. It sets these environment variables:

| Variable | Value | Effect |
|:---------|:------|:-------|
| `DOCS_MCP_PROTOCOL` | `http` | Serve HTTP even without a terminal |
| `HOST` | `0.0.0.0` | Listen on all interfaces |
| `PORT` | `6280` | Server port |
| `DOCS_MCP_STORE_PATH` | `/data` | Data directory |
| `XDG_CONFIG_HOME` | `/config` | Config directory |

**Overrides:** Pass `--protocol`, `--host` or `--port` after the image name, or set `DOCS_MCP_SERVER_PROTOCOL`, `DOCS_MCP_SERVER_HOST` or `DOCS_MCP_SERVER_PORTS_DEFAULT` with `-e`. Both win over the image's variables, and the image's variables win over `config.yaml`, so change the protocol, host and port with flags or `-e`. The alias variables `DOCS_MCP_HOST` and `DOCS_MCP_PORT` also work. [Precedence](configuration.md#precedence) lists the full order. When you change the port, change the container port in `-p` to match.

**Stdio clients:** Select stdio and keep stdin open with `-i` (without `-t`):

```bash
docker run --rm -i \
  -v docs-mcp-data:/data \
  -v docs-mcp-config:/config \
  ghcr.io/arabold/docs-mcp-server:latest --protocol stdio
```

`-e DOCS_MCP_SERVER_PROTOCOL=stdio` has the same effect. `-e DOCS_MCP_SERVER_PROTOCOL=auto` selects stdio when the container has no terminal and HTTP otherwise.

**Changing the embedding model:** A container has no terminal to confirm a [model change](../guides/embedding-models.md#changing-the-model), so the server refuses to start. Add `-e DOCS_MCP_ACCEPT_MODEL_CHANGE=true` for one start (with Docker Compose, put it in `.env`) to confirm the change and delete the stored vectors, then remove it again.

**Local folders:** A container reads only the folders you mount into it, and the image has no `Documents` folder for the default allowed root. Mount the folder and set `DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_ALLOWED_ROOTS` to its path inside the container. [Basic Usage](../guides/basic-usage.md#docker) shows the command.

**Non-root runtime:** The container runs as the unprivileged `node` user (uid 1000). Named volumes, such as `docs-mcp-data` and `docs-mcp-config` above, take this ownership automatically. If you bind-mount a host directory instead (`-v ./data:/data`), make it writable by uid 1000: run `chown 1000:1000 ./data` once, or start the container with `--user "$(id -u):$(id -g)"` to match your host user.

### Vector Search

Without an embedding model, search uses full-text matching. Vector search also finds passages by meaning. To turn it on with OpenAI, set `OPENAI_API_KEY`:

```bash
OPENAI_API_KEY="sk-proj-..." npx @arabold/docs-mcp-server@latest
```

With Docker, add `-e OPENAI_API_KEY="sk-proj-..."`. [Embedding Models](../guides/embedding-models.md) covers Ollama, Gemini, Azure OpenAI and other providers.

### Connect a Client

Point MCP clients that connect over HTTP at `http://localhost:6280/mcp`. [Connecting MCP Clients](../guides/mcp-clients.md) has the settings for Claude Code, Claude Desktop, Zed and other clients.

---

## Embedded Server

An MCP client can start the server itself and talk to it over stdio. The server then runs only while the client runs, and serves no web UI. Add this to the client's MCP settings:

```json
{
  "mcpServers": {
    "docs-mcp-server": {
      "command": "npx",
      "args": ["-y", "@arabold/docs-mcp-server@latest"],
      "env": {
        "OPENAI_API_KEY": "sk-proj-..."
      }
    }
  }
}
```

Leave out `env` to run with full-text search only. The server selects stdio because the client connects through pipes rather than a terminal; add `"--protocol", "stdio"` to `args` to select it explicitly.

The embedded server, the CLI and a server you start yourself all use the same data directory, so they see the same documentation. To manage it in a browser, start the web UI separately (see [Basic Usage](../guides/basic-usage.md)).

---

## Docker Compose

The repository's `docker-compose.yml` runs the server as three containers from the same image:

| Service | Command | Port | Role |
|:--------|:--------|:-----|:-----|
| `worker` | `worker` | 8080 | Runs the scrape jobs and owns the database (`docs-mcp-data` volume). |
| `mcp` | `mcp --server-url http://worker:8080/api` | 6280 | MCP endpoint at `http://localhost:6280/mcp`. |
| `web` | `web --server-url http://worker:8080/api` | 6281 | Web UI at `http://localhost:6281`. |

1. Clone the repository:

    ```bash
    git clone https://github.com/arabold/docs-mcp-server.git
    cd docs-mcp-server
    ```

2. Create a `.env` file in the repository root. All three services read their environment from it, and Compose requires the file to exist. Put your embedding provider credentials in it, or leave it empty for full-text search only:

    ```bash
    echo 'OPENAI_API_KEY=sk-proj-...' > .env
    ```

    `.env.example` lists the variables you can set. Copy only the lines you need: its placeholder credentials would make the server try providers you have not set up.

3. Start the services:

    ```bash
    docker compose up -d
    ```

[Deployment Modes](../infrastructure/deployment-modes.md) explains how the worker and the coordinators work together and how to scale them.

---

## Next Steps

- [Basic Usage](../guides/basic-usage.md): add documentation in the web UI, use the CLI and the bundled Agent Skills.
- [Configuration](configuration.md): config file, environment variables and every setting.
- [Embedding Models](../guides/embedding-models.md): set up vector search.
