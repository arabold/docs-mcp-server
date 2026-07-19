# Deployment Modes

## Overview

The system supports two deployment patterns with automatic protocol detection for seamless integration with different environments.

## Standalone Server Mode

Single process containing all services on one port (default: 6280). This mode combines:

- MCP server accessible via `/mcp` and `/sse` endpoints
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
- `enableWorker`: Embedded job processing
- `enableApiServer`: HTTP API for pipeline and data operations (served at `/api`)

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

## Protocol Auto-Detection

The system automatically selects communication protocol based on execution environment:

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

- Server-Sent Events transport for MCP
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

### Single Container

```dockerfile
FROM ghcr.io/arabold/docs-mcp-server:latest
EXPOSE 6280
CMD ["--protocol", "http", "--port", "6280"]
```

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
