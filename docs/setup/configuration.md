# Configuration

The Docs MCP Server uses a unified configuration system that aggregates settings from multiple sources, validating them against a strict schema. This ensures consistency whether you are running the server via CLI, Docker, or as a library.

## Loading Behavior

When any command is executed, the application resolves the configuration in the following order:

1.  **Bootstrap**: The CLI initializes and loads a "bootstrap" configuration to set up global services like logging and telemetry.
2.  **Command Execution**: The specific command (e.g., `serve`, `scrape`) re-loads the configuration to apply any command-specific context.

## Precedence Rules

Configuration values are merged from four layers, with **higher numbers taking precedence**:

1.  **Defaults**: Hardcoded application defaults (lowest priority).
2.  **Config File**: Settings loaded from a configuration file.
    - **Read-Only (Explicit)**: If you provide a path via `--config` or `DOCS_MCP_CONFIG`, the server treats this file as **read-only**. It will load settings from it but **never** modify it. Both `config.yaml` and `config.json` formats are supported.
    - **Read-Write (System Default)**: If no explicit config is provided, the server loads from the system default location (e.g., `~/Library/Preferences/docs-mcp-server/config.yaml`).
      - **Auto-Update**: The server **automatically updates** this file on startup with new defaults. **Note**: The system default file is always `config.yaml`.
3.  **Environment Variables**: Mapped system environment variables (e.g., `DOCS_MCP_PORT`).
4.  **CLI Arguments**: Flags passed directly to the command (e.g., `--port 8080`). These have the highest priority.

**Note:** Some CLI flags (like `--max-pages` for the `scrape` command) act as direct overrides and will always supercede values from other sources.

## Configuration Options

The configuration is structured into logical sections.

### App (`app`)

General application settings.

| Option             | Env Var                    | CLI Flag            | Default                  | Description                                       |
| :----------------- | :------------------------- | :------------------ | :----------------------- | :------------------------------------------------ |
| `storePath`        | `DOCS_MCP_STORE_PATH`      | `--store-path`      | `~/.docs-mcp-server`     | Directory for storing databases and logs.         |
| `telemetryEnabled` | `DOCS_MCP_TELEMETRY`       | `--telemetry`       | `true`                   | Enable anonymous usage telemetry.                 |
| `readOnly`         | `DOCS_MCP_READ_ONLY`       | `--read-only`       | `false`                  | Prevent modification of data (scraping/indexing). |
| `embeddingModel`   | `DOCS_MCP_EMBEDDING_MODEL` | `--embedding-model` | `text-embedding-3-small` | Model to use for vector embeddings.               |

### Server (`server`)

Settings for the API and MCP servers.

| Option          | Env Var             | CLI Flag     | Default     | Description                                   |
| :-------------- | :------------------ | :----------- | :---------- | :-------------------------------------------- |
| `protocol`      | `DOCS_MCP_PROTOCOL` | `--protocol` | `auto`      | Server protocol (`stdio`, `http`, or `auto`). |
| `host`          | `DOCS_MCP_HOST`     | `--host`     | `127.0.0.1` | Host interface to bind to.                    |
| `heartbeatMs`   | -                   | -            | `30000`     | MCP protocol heartbeat interval (ms).         |
| `ports.default` | `DOCS_MCP_PORT`     | `--port`     | `6280`      | Default port for the main server.             |
| `ports.worker`  | -                   | -            | `8080`      | Port for the background worker service.       |
| `ports.mcp`     | -                   | -            | `6280`      | Port for the specific MCP interface.          |
| `ports.web`     | `DOCS_MCP_WEB_PORT` | -            | `6281`      | Port for the web dashboard.                   |

### Authentication (`auth`)

Security settings for the HTTP server.

| Option      | Env Var                    | CLI Flag            | Default | Description                           |
| :---------- | :------------------------- | :------------------ | :------ | :------------------------------------ |
| `enabled`   | `DOCS_MCP_AUTH_ENABLED`    | `--auth-enabled`    | `false` | Enable JWT authentication.            |
| `issuerUrl` | `DOCS_MCP_AUTH_ISSUER_URL` | `--auth-issuer-url` | -       | OIDC Issuer URL (e.g., Clerk, Auth0). |
| `audience`  | `DOCS_MCP_AUTH_AUDIENCE`   | `--auth-audience`   | -       | Expected JWT audience claim.          |

### Scraper (`scraper`)

Settings controlling the web scraping behavior.

| Option                | Default | Description                               |
| :-------------------- | :------ | :---------------------------------------- |
| `maxPages`            | `1000`  | Maximum number of pages to crawl per job. |
| `maxDepth`            | `3`     | Maximum link depth to traverse.           |
| `maxConcurrency`      | `3`     | Number of concurrent page fetches.        |
| `pageTimeoutMs`       | `5000`  | Timeout for a single page load.           |
| `browserTimeoutMs`    | `30000` | Timeout for the browser instance.         |
| `fetcher.maxRetries`  | `6`     | Number of retries for failed requests.    |
| `fetcher.baseDelayMs` | `1000`  | Initial delay for exponential backoff.    |

_Note: Scraper settings are often overridden per-job via CLI arguments._

### Splitter (`splitter`)

Settings for chunking text for vector search.

| Option               | Default | Description                   |
| :------------------- | :------ | :---------------------------- |
| `minChunkSize`       | `500`   | Minimum characters per chunk. |
| `preferredChunkSize` | `1500`  | Target characters per chunk.  |
| `maxChunkSize`       | `5000`  | Maximum characters per chunk. |

### Embeddings (`embeddings`)

Settings for the vector embedding generation.

> **Detailed Guide:** See [Embedding Model Configuration](../guides/embedding-models.md) for provider-specific setup (OpenAI, Ollama, Gemini, etc.).

| Option            | Default | Description                                       |
| :---------------- | :------ | :------------------------------------------------ |
| `batchSize`       | `100`   | Number of chunks to embed in one request.         |
| `vectorDimension` | `1536`  | Dimension of the vector space (must match model). |

### Database (`db`)

Internal database settings.

| Option                | Default | Description                                 |
| :-------------------- | :------ | :------------------------------------------ |
| `migrationMaxRetries` | `5`     | Retries for database migrations on startup. |

### Assembly (`assembly`)

Settings for reassembling search results.

| Option                    | Default | Description                                                                                                      |
| :------------------------ | :------ | :--------------------------------------------------------------------------------------------------------------- |
| `maxChunkDistance`        | `3`     | Maximum sort_order difference to merge chunks; larger differences keep chunks separate (usually per-chunk = 1). |
| `maxParentChainDepth`     | `10`    | Maximum depth for parent context traversal.                                                                      |
| `childLimit`              | `3`     | Maximum number of child chunks to include.                                             |
| `precedingSiblingsLimit`  | `1`     | Number of preceding sibling chunks to include.                                         |
| `subsequentSiblingsLimit` | `2`     | Number of subsequent sibling chunks to include.                                        |

