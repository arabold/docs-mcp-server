# Deployment Modes

## Overview

The system supports two deployment patterns with automatic protocol detection for seamless integration with different environments.

## Standalone Server Mode

Single process containing all services on one port (default: 6280). This mode combines:

- MCP server accessible via the `/mcp` endpoint (Streamable HTTP, protocol revision 2026-07-28)
- Web interface for job management
- Embedded worker for document processing
- API (tRPC over HTTP) for programmatic access

### Use Cases

- Development environments
- Single-container deployments
- Simple production setups
- Local documentation indexing

### Service Configuration

Services can be selectively enabled via AppServerConfig:

- `enableMcpServer`: MCP protocol endpoint
- `enableWebInterface`: Web UI and management API
- `enableApiServer`: HTTP API for pipeline and data operations (served at `/api`)

Jobs run in the server's own process unless it is started with `--server-url`; the backend the server serves (see `openBackend()`) decides this.

## Distributed Mode

Separate coordinator and worker processes for scaling. The coordinator handles interfaces while the worker processes jobs.

### Architecture

- **Coordinator**: Runs MCP server, web interface, and API; stateless, so multiple replicas can run at once
- **Worker**: A single process that executes document processing jobs and owns the SQLite-backed document store
- **Communication**: Coordinators use the API (tRPC over HTTP) to talk to the worker

### Use Cases

- High-volume processing
- Container orchestration (Kubernetes, Docker Swarm)
- Scaling coordinator (web/MCP) replicas independently of the worker
- Resource isolation

### Worker Management

The worker may expose a simple `/health` or container-level healthcheck for monitoring. Coordinators communicate with the worker via Pipeline RPC.

### Upgrading

Upgrade the worker together with, or before, its coordinators. The worker owns the document store and applies database migrations, and newer coordinators may send request options an older worker does not know. An older worker ignores them silently: for example, it would overwrite an existing library version that a newer coordinator asked it to protect.

## Protocol Auto-Detection

Outside Docker, the system automatically selects communication protocol based on execution environment. The Docker image defaults to HTTP regardless of TTY status; runtime environment variables or CLI flags can select another protocol.

### Detection Logic

```
if (!process.stdin.isTTY && !process.stdout.isTTY) {
  return "stdio";  // AI tools, CI/CD
} else {
  return "http";   // Interactive terminals
}
```

### Stdio Mode

- Direct MCP communication via stdin/stdout
- Used by VS Code, Claude Desktop, other AI tools
- No HTTP server required
- Minimal resource usage

### HTTP Mode

- Streamable HTTP transport for MCP at `/mcp` (protocol revision 2026-07-28)
- Full web interface available
- API accessible at `/api`
- Suitable for browser access

### Manual Override

Protocol can be explicitly set via `--protocol stdio|http` flag, bypassing auto-detection.

## Configuration

Deployment mode, ports, and embedding settings are resolved through the shared configuration loader (defaults → `docs-mcp.config.yaml` or `DOCS_MCP_CONFIG` → legacy envs → generic env `DOCS_MCP_<KEY>` → CLI flags for the current run). Override with YAML or env keys such as `DOCS_MCP_PROTOCOL`, `DOCS_MCP_PORT`, and `DOCS_MCP_EMBEDDING_MODEL`; use CLI flags like `--protocol`, `--port`, `--server-url`, or `--resume` when you need per-invocation changes.

## Job Recovery

Job recovery behavior depends on deployment mode:

### Standalone Server

- Embedded worker recovers pending jobs from database
- Enabled by default for persistent job processing
- Prevents job loss during server restarts

### Distributed Mode

- The worker handles its own job recovery
- Coordinators do not recover jobs to avoid conflicts
- The worker maintains its own job state, independent of any coordinator

### CLI Commands

- No job recovery to prevent conflicts
- Immediate execution model
- Safe for concurrent CLI usage

## Container Deployment

Behind a reverse proxy, set `--public-url` (or `DOCS_MCP_SERVER_PUBLIC_URL`) to the URL clients use, including any path such as `https://example.com/docs`. See [Reverse Proxy Deployment](./reverse-proxy.md).

The server answers to IP addresses, `localhost` and single-label names such as a Compose service name. If clients reach the container under a dotted name, such as `nas.local`, set the public URL to it. See [Host Names the Server Answers To](../setup/configuration.md#host-names-the-server-answers-to).

### Single Container

```bash
docker run --rm \
  -v docs-mcp-data:/data \
  -v docs-mcp-config:/config \
  -p 6280:6280 \
  ghcr.io/arabold/docs-mcp-server:latest
```

The image starts the unified HTTP server on `0.0.0.0:6280` with the Web UI, API, and MCP endpoint enabled. Its `DOCS_MCP_PROTOCOL=http` and `HOST=0.0.0.0` environment defaults remain active with unrelated arguments such as `--verbose`. Override them with runtime environment variables or CLI flags; image environment values take precedence over config-file values. Both supported aliases and generic environment overrides remain available.

Docker stdio clients use `docker run --rm -i ghcr.io/arabold/docs-mcp-server:latest --protocol stdio`, keeping stdin open without allocating a TTY. `DOCS_MCP_SERVER_PROTOCOL=auto` restores TTY-based protocol selection. See [Installation](../setup/installation.md#option-2-docker) for the complete override and persistence options.

### Multi-Container (Docker Compose)

```yaml
services:
  coordinator:
    image: ghcr.io/arabold/docs-mcp-server:latest
    ports: ["6280:6280"]
  command: ["mcp", "--server-url", "http://worker:8080/api"]

  worker:
    image: ghcr.io/arabold/docs-mcp-server:latest
    ports: ["8080:8080"]
    command: ["worker", "--port", "8080"]
```

The worker URL may include a path when a reverse proxy serves the worker under one, such as `https://example.com/docs/api`. The coordinator's API calls and its event WebSocket both use that URL.

## Scaling

### Coordinators Scale Horizontally

Coordinator (`web`/`mcp`) processes are stateless: both document reads and job dispatch proxy to the worker over tRPC. Run multiple coordinator replicas behind a load balancer (or DNS), each started with `--server-url` pointing at the same worker.

### The Worker Does Not Scale Horizontally

The worker owns the in-memory job queue and the SQLite-backed document store. There is no supported way to run multiple worker replicas against shared state today: a second worker has no visibility into jobs queued on the first, and SQLite's WAL-based locking model is designed for concurrent processes on one host's local filesystem, not multiple hosts sharing a file over a network volume. Scale the worker vertically instead.

### Health Checks

Expose a lightweight `/health` endpoint or container healthcheck for coordinator and worker monitoring.

### Scaling Strategies

- Horizontal: Add more coordinator (`web`/`mcp`) replicas in front of the one worker
- Vertical: Increase worker concurrency (`maxConcurrency`) and resource allocation
