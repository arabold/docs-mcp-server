# Configuration

The Docs MCP Server uses a unified configuration system that aggregates settings from multiple sources, validating them against a strict schema. This ensures consistency whether you are running the server via CLI, Docker, or as a library.

## Configuration File

By default, configuration is stored in your system's preferences directory:

- **macOS**: `~/Library/Preferences/docs-mcp-server/config.yaml`
- **Linux**: `~/.config/docs-mcp-server/config.yaml`
- **Windows**: `%APPDATA%\docs-mcp-server\config.yaml`

Example `config.yaml`:

```yaml
app:
  storePath: ~/.docs-mcp-server
  telemetryEnabled: true
  embeddingModel: text-embedding-3-small

scraper:
  maxPages: 1000
  maxDepth: 3
  document:
    maxSize: 10485760  # 10MB

splitter:
  preferredChunkSize: 1500
  maxChunkSize: 5000
```

The server **automatically updates** this file on startup with new defaults.

### Using an Explicit Config File

You can specify a custom config file with `--config` or `DOCS_MCP_CONFIG`:

```bash
docs-mcp-server --config /path/to/config.yaml
```

**Note:** Explicit config files are treated as **read-only**. The server will not modify them.

## Overriding Configuration

Configuration values are merged from multiple sources, with **later sources taking precedence**:

1. **Defaults** (lowest priority)
2. **Config File**
3. **Environment Variables**
4. **CLI Arguments** (highest priority)

### Environment Variables

Any configuration setting can be overridden via environment variables using the naming convention:

```
DOCS_MCP_<SECTION>_<SETTING>
```

Rules:
- Convert `camelCase` to `UPPER_SNAKE_CASE`
- Join nested paths with underscores

**Examples:**

```bash
# Override scraper settings
export DOCS_MCP_SCRAPER_MAX_PAGES=2000
export DOCS_MCP_SCRAPER_DOCUMENT_MAX_SIZE=52428800

# Override splitter settings
export DOCS_MCP_SPLITTER_PREFERRED_CHUNK_SIZE=2000

# Override app settings
export DOCS_MCP_APP_TELEMETRY_ENABLED=false
```

Some settings also have **legacy aliases** for convenience:

| Setting | Alias |
|---------|-------|
| `server.ports.default` | `PORT` |
| `server.host` | `HOST` |

### CLI Arguments

Common settings have dedicated CLI flags:

```bash
docs-mcp-server --port 8080 --host 0.0.0.0
docs-mcp-server --store-path /data/docs --read-only
```

## CLI Configuration Commands

Manage configuration directly from the command line:

```bash
# View current configuration (JSON format)
docs-mcp-server config

# View current configuration (YAML format)
docs-mcp-server config --yaml

# Get a specific value
docs-mcp-server config get scraper.maxPages
# Output: 1000

# Get a nested object
docs-mcp-server config get scraper.fetcher
# Output: { "maxRetries": 6, ... }

# Set a value (persists to config file)
docs-mcp-server config set scraper.maxPages 500
# Output: Updated scraper.maxPages = 500
```

**Note:** `config set` only modifies the system default configuration file. If you specify `--config`, the file is treated as read-only.

---

## Configuration Reference

### App (`app`)

General application settings.

| Option | Default | Description |
|:-------|:--------|:------------|
| `storePath` | `~/.docs-mcp-server` | Directory for storing databases and logs. |
| `telemetryEnabled` | `true` | Enable anonymous usage telemetry. |
| `readOnly` | `false` | Prevent modification of data (scraping/indexing). |
| `embeddingModel` | `text-embedding-3-small` | Model to use for vector embeddings. |

### Server (`server`)

Settings for the API and MCP servers.

| Option | Default | Description |
|:-------|:--------|:------------|
| `protocol` | `auto` | Server protocol (`stdio`, `http`, or `auto`). |
| `host` | `127.0.0.1` | Host interface to bind to. |
| `heartbeatMs` | `30000` | MCP protocol heartbeat interval (ms). |
| `ports.default` | `6280` | Default port for the main server. |
| `ports.worker` | `8080` | Port for the background worker service. |
| `ports.mcp` | `6280` | Port for the specific MCP interface. |
| `ports.web` | `6281` | Port for the web dashboard. |

### Authentication (`auth`)

Security settings for the HTTP server.

| Option | Default | Description |
|:-------|:--------|:------------|
| `enabled` | `false` | Enable JWT authentication. |
| `issuerUrl` | - | OIDC Issuer URL (e.g., Clerk, Auth0). |
| `audience` | - | Expected JWT audience claim. |

### Scraper (`scraper`)

Settings controlling the web scraping behavior.

| Option | Default | Description |
|:-------|:--------|:------------|
| `maxPages` | `1000` | Maximum number of pages to crawl per job. |
| `maxDepth` | `3` | Maximum link depth to traverse. |
| `maxConcurrency` | `3` | Number of concurrent page fetches. |
| `pageTimeoutMs` | `5000` | Timeout for a single page load (ms). |
| `browserTimeoutMs` | `30000` | Timeout for the browser instance (ms). |
| `fetcher.maxRetries` | `6` | Number of retries for failed requests. |
| `fetcher.baseDelayMs` | `1000` | Initial delay for exponential backoff (ms). |
| `document.maxSize` | `10485760` | Maximum size (bytes) for PDF/Office documents. |

_Note: Scraper settings are often overridden per-job via CLI arguments like `--max-pages`._

> **Migration Note:** In versions prior to 1.37, `document.maxSize` was a top-level setting. It has been moved to `scraper.document.maxSize`. Update your config files accordingly.

### Splitter (`splitter`)

Settings for chunking text for vector search.

| Option | Default | Description |
|:-------|:--------|:------------|
| `minChunkSize` | `500` | Minimum characters per chunk. |
| `preferredChunkSize` | `1500` | Target characters per chunk. |
| `maxChunkSize` | `5000` | Maximum characters per chunk. |

### Embeddings (`embeddings`)

Settings for the vector embedding generation.

> **Detailed Guide:** See [Embedding Model Configuration](../guides/embedding-models.md) for provider-specific setup (OpenAI, Ollama, Gemini, etc.).

| Option | Default | Description |
|:-------|:--------|:------------|
| `batchSize` | `100` | Number of chunks to embed in one request. |
| `vectorDimension` | `1536` | Dimension of the vector space (must match model). |

### Database (`db`)

Internal database settings.

| Option | Default | Description |
|:-------|:--------|:------------|
| `migrationMaxRetries` | `5` | Retries for database migrations on startup. |

### Assembly (`assembly`)

Settings for reassembling search results.

| Option | Default | Description |
|:-------|:--------|:------------|
| `maxChunkDistance` | `3` | Maximum sort_order difference to merge chunks. |
| `maxParentChainDepth` | `10` | Maximum depth for parent context traversal. |
| `childLimit` | `3` | Maximum number of child chunks to include. |
| `precedingSiblingsLimit` | `1` | Number of preceding sibling chunks to include. |
| `subsequentSiblingsLimit` | `2` | Number of subsequent sibling chunks to include. |
