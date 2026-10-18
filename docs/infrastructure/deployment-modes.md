# Deployment Modes

The server runs as one process that does everything, or as a worker that runs jobs and holds the store, with coordinators in front of it that serve the web UI and MCP. [ARCHITECTURE.md](../../ARCHITECTURE.md#system-architecture) describes how the components work together in each mode. This page covers what to run.

## Commands

| Command | Serves | Port setting (default) | Jobs run |
|---|---|---|---|
| none (default) | Web UI, API (`/api`) and MCP (`/mcp`) over HTTP, or MCP over stdio | `server.ports.default` (6280) | In the process |
| `mcp` | MCP (`/mcp`) over HTTP, or MCP over stdio | `server.ports.mcp` (6280) | In the process, or on a worker with `--server-url` |
| `web` | Web UI and API | `server.ports.web` (6281) | In the process, or on a worker with `--server-url` |
| `worker` | API only | `server.ports.worker` (8080) | In the process |

`--port`, `DOCS_MCP_PORT` and `PORT` set the port of whichever command runs, and `DOCS_MCP_WEB_PORT` sets the `web` port ahead of the other two variables. The Docker image sets `PORT=6280`, so a `worker` container listens on 6280 unless it is given `--port`. Each of these commands binds `server.host`, which defaults to `127.0.0.1`; the Docker image sets `0.0.0.0`. See [Configuration](../setup/configuration.md) for how settings combine.

## Protocol Selection

The default command and `mcp` choose their MCP transport from `--protocol` (`server.protocol`, `DOCS_MCP_PROTOCOL`):

- `stdio` serves MCP on stdin and stdout and opens no port. AI clients that launch the server as a subprocess use it.
- `http` serves the HTTP endpoints in the table above.
- `auto`, the default, selects stdio when neither stdin nor stdout is a terminal, and HTTP otherwise.

The Docker image sets `DOCS_MCP_PROTOCOL=http`, so a container serves HTTP without a terminal. [Installation](../setup/installation.md#option-2-docker) shows how to run the image over stdio and how to override its defaults.

## Single Process

The default command serves the web UI, the API and MCP from one process, which also runs every job and holds the store. It suits local use and single-container deployments:

```bash
docker run --rm \
  -v docs-mcp-data:/data \
  -v docs-mcp-config:/config \
  -p 6280:6280 \
  ghcr.io/arabold/docs-mcp-server:latest
```

Behind a reverse proxy, set `--public-url` (`DOCS_MCP_SERVER_PUBLIC_URL`) to the URL clients use, including any path, such as `https://example.com/docs`. See [Reverse Proxy Deployment](./reverse-proxy.md).

The server answers to IP addresses, `localhost` and single-label names such as a Compose service name. When clients reach it under a dotted name, such as `nas.local`, set the public URL to that name. See [Host Names the Server Answers To](../setup/configuration.md#host-names-the-server-answers-to).

## Separate Worker

One `worker` process owns the store and runs every job. It needs the embedding settings and API keys; coordinators need neither. At startup it logs the URL to give coordinators, such as `Worker available at http://127.0.0.1:8080/api`.

Coordinators are `web` and `mcp` processes started with `--server-url` pointing at that URL. They keep no state: document reads, searches and job requests go to the worker over HTTP, and job events come back over a WebSocket at the same URL. Most CLI commands (`scrape`, `refresh`, `search`, `list`, `find-version`, `remove`, `compact`) also take `--server-url` and then work against the worker instead of a local store.

The worker URL may include a path when a reverse proxy serves the worker under one, such as `https://example.com/docs/api`. The proxy must pass WebSocket upgrades on that path. Without the event stream, the web UI gets no live updates and CLI commands that wait for a job poll the worker for its state instead.

The worker checks the `Host` header like every other process. Coordinators that reach it under a dotted name, such as `worker.internal`, need that name in the worker's `--public-url` or `server.allowedOrigins`.

The link between coordinators and the worker has no authentication. Keep the worker on a private network and don't publish its port. See [Infrastructure Security](./security.md).

A Docker Compose setup with one worker and both coordinators:

```yaml
services:
  worker:
    image: ghcr.io/arabold/docs-mcp-server:latest
    command: ["worker", "--port", "8080"]
    env_file: [.env] # embedding provider settings and keys
    volumes:
      - docs-mcp-data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/api/ping').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval: 5s
      retries: 10

  mcp:
    image: ghcr.io/arabold/docs-mcp-server:latest
    command: ["mcp", "--port", "6280", "--server-url", "http://worker:8080/api"]
    ports: ["6280:6280"]
    depends_on:
      worker:
        condition: service_healthy

  web:
    image: ghcr.io/arabold/docs-mcp-server:latest
    command: ["web", "--port", "6281", "--server-url", "http://worker:8080/api"]
    ports: ["6281:6281"]
    depends_on:
      worker:
        condition: service_healthy

volumes:
  docs-mcp-data:
```

A coordinator exits at startup when the worker doesn't answer, so it waits for the worker's health check. The repository's `docker-compose.yml` is a fuller version of this setup.

## Interrupted Jobs

A job that stops with its process, for example in a crash, leaves its version queued or running in the store. A `worker` runs such jobs again when it starts, unless it gets `--no-resume`. The default command marks them failed with "Job interrupted" unless it gets `--resume`. Coordinators with `--server-url` leave them to the worker. Every process that runs jobs marks them alive in the store, so a server acts only on jobs no live process runs: `web` started beside an embedded server or a worker leaves their jobs running, and a job that crashed moments before a server starts is handled about a minute later. [Interrupted Jobs](../concepts/pipeline-architecture.md#interrupted-jobs) lists what every command does with them.

## Scaling

Coordinators scale horizontally. Run as many `web` and `mcp` replicas as needed, behind a load balancer or DNS, each with `--server-url` pointing at the same worker.

The worker does not. It keeps the job queue in memory and the documents in SQLite. A second worker would not see the first one's queue, and SQLite's locking works for processes on one host's local filesystem, not for hosts sharing a file over a network volume. Scale the worker vertically instead: give it more CPU and memory, and raise `scraper.maxConcurrency`, which sets how many jobs run at once and how many pages each job fetches at once.

## Health Checks

`GET /api/ping` answers `200` on every process that serves the API: the default command, `web` and `worker`. The `mcp` command serves no API; check that its port accepts connections. The web UI of a `web` coordinator shows whether its connection to the worker is up.

## Upgrading

Upgrade the worker together with, or before, its coordinators. The worker owns the document store and applies database migrations, and newer coordinators may send request options an older worker does not know. An older worker ignores them silently: for example, it would overwrite an existing library version that a newer coordinator asked it to protect.
