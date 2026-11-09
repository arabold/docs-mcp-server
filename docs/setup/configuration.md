# Configuration

The server reads its settings from built-in defaults, a config file, environment variables and command-line flags. Every command reads the same settings, whether it runs through npx, a global install or Docker.

The examples on this page call the `docs-mcp-server` command. With npx, run `npx @arabold/docs-mcp-server@latest` in its place.

## Configuration File

The server keeps its settings in `config.yaml` in the system configuration directory:

| Platform | Path |
|:---------|:-----|
| macOS | `~/Library/Preferences/docs-mcp-server/config.yaml` |
| Linux | `$XDG_CONFIG_HOME/docs-mcp-server/config.yaml`, which defaults to `~/.config/docs-mcp-server/config.yaml` |
| Windows | `%APPDATA%\docs-mcp-server\Config\config.yaml` |
| Docker image | `/config/docs-mcp-server/config.yaml` |

Every command writes this file when it starts. It adds settings that are new in this release with their defaults and keeps the values you set. `embeddings.vectorDimension` appears in the file only after you set it (see [Vector Dimension](../guides/embedding-models.md#vector-dimension)).

When the file does not match the schema, for example after a typo, the server renames it to `config.yaml.invalid-<timestamp>`, writes a fresh file with the defaults and logs a warning. An invalid `server.publicUrl`, `server.publicOrigin` or `server.allowedOrigins` stops startup with an error instead.

Example `config.yaml` that changes a few settings:

```yaml
scraper:
  maxPages: 500
  security:
    fileAccess:
      allowedRoots:
        - $DOCUMENTS
        - /srv/docs

splitter:
  maxChunkSize: 4000
```

### Using an Explicit Config File

`--config <path>` or the `DOCS_MCP_CONFIG` environment variable selects another file; the flag wins over the variable. The server reads this file and never writes to it. A path ending in `.json` is read as JSON, any other path as YAML.

```bash
docs-mcp-server --config /path/to/config.yaml
```

## Data Directory

The server keeps its database (`documents.db`) and the telemetry installation ID in one directory. Set it with `--store-path <dir>` or the `DOCS_MCP_STORE_PATH` environment variable; the flag wins. Without either, the server uses the system data directory:

| Platform | Path |
|:---------|:-----|
| macOS | `~/Library/Application Support/docs-mcp-server` |
| Linux | `$XDG_DATA_HOME/docs-mcp-server`, which defaults to `~/.local/share/docs-mcp-server` |
| Windows | `%LOCALAPPDATA%\docs-mcp-server\Data` |
| Docker image | `/data` |

Use an absolute path: a relative path resolves against the working directory. A checkout of this repository that has a `.store/documents.db` file in its root keeps using that `.store` directory. [Data Storage](../concepts/data-storage.md#location) describes how the directory is chosen and what the database holds.

Only the flag and `DOCS_MCP_STORE_PATH` choose the directory. The `app.storePath` value that `docs-mcp-server config` prints shows the directory in use.

## Precedence

Each setting takes its value from the first source in this list that sets it:

1. Command-line flags
2. Environment variables named after the setting, such as `DOCS_MCP_SERVER_PROTOCOL`
3. Alias environment variables, such as `DOCS_MCP_PROTOCOL` or `PORT` (see [Aliases](#aliases))
4. The config file
5. Built-in defaults

## Environment Variables

Every setting in the [Configuration Reference](#configuration-reference) except `app.storePath` has an environment variable. Its name is `DOCS_MCP_` followed by the setting's path: each part goes from `camelCase` to `UPPER_SNAKE_CASE`, and underscores join the parts.

```bash
export DOCS_MCP_SCRAPER_MAX_PAGES=2000                # scraper.maxPages
export DOCS_MCP_SCRAPER_DOCUMENT_MAX_SIZE=52428800    # scraper.document.maxSize
export DOCS_MCP_SPLITTER_PREFERRED_CHUNK_SIZE=2000    # splitter.preferredChunkSize
export DOCS_MCP_APP_TELEMETRY_ENABLED=false           # app.telemetryEnabled
export DOCS_MCP_SCRAPER_SECURITY_NETWORK_ALLOW_INVALID_TLS=true
export DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_FOLLOW_SYMLINKS=true
```

Boolean settings read `false`, `0`, `no`, `off` and an empty value as false, and any other value as true. List settings take a JSON or YAML inline array, or a single value:

```bash
export DOCS_MCP_SCRAPER_SECURITY_NETWORK_ALLOWED_HOSTS='["docs.internal.example","wiki.corp.local"]'
export DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_ALLOWED_ROOTS='["$DOCUMENTS", "/srv/docs"]'
```

### Aliases

Some settings also read shorter alias variables. When several aliases are set, the first one listed wins. The full `DOCS_MCP_<SECTION>_<SETTING>` name wins over every alias.

| Setting | Aliases |
|:--------|:--------|
| `app.telemetryEnabled` | `DOCS_MCP_TELEMETRY` |
| `app.readOnly` | `DOCS_MCP_READ_ONLY` |
| `app.embeddingModel` | `DOCS_MCP_EMBEDDING_MODEL` |
| `server.protocol` | `DOCS_MCP_PROTOCOL` |
| `server.host` | `DOCS_MCP_HOST`, `HOST` |
| `server.ports.default`, `server.ports.mcp`, `server.ports.worker` | `DOCS_MCP_PORT`, `PORT` |
| `server.ports.web` | `DOCS_MCP_WEB_PORT`, `DOCS_MCP_PORT`, `PORT` |

`DOCS_MCP_PORT` and `PORT` set the port of every server command, so one variable moves whichever command you start.

### Other Environment Variables

These variables are not settings in the config file:

| Variable | Description |
|:---------|:------------|
| `DOCS_MCP_CONFIG` | Path to an explicit config file (see [Using an Explicit Config File](#using-an-explicit-config-file)). |
| `DOCS_MCP_STORE_PATH` | Data directory (see [Data Directory](#data-directory)). |
| `DOCS_MCP_ACCEPT_MODEL_CHANGE` | Set to `true` to confirm a changed embedding model without a prompt, deleting all stored vectors. `--accept-model-change` wins over it. See [Changing the Model](../guides/embedding-models.md#changing-the-model). |
| `LOG_LEVEL` | `ERROR`, `WARN`, `INFO` or `DEBUG`. Without it, commands log at `INFO` in a terminal and `ERROR` otherwise. `--verbose` and `--quiet` win over it, and a server on stdio logs errors only. |
| `OPENAI_API_KEY` and other provider credentials | Credentials of the embedding provider. See [Embedding Models](../guides/embedding-models.md#provider-credentials). |
| `GITHUB_TOKEN`, `GH_TOKEN` | GitHub token for private repositories (see [GitHub Authentication](#github-authentication)). |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Path to a Chromium executable to use for browser rendering. When it is set and the file exists, the server does not install Playwright's Chromium. |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | Set to `1` to skip the automatic Chromium install on startup. |

## Command-Line Flags

These flags set a configuration value for one run. `docs-mcp-server <command> --help` lists the flags each command accepts.

| Flag | Setting |
|:-----|:--------|
| `--config <path>` | Explicit config file |
| `--store-path <dir>` | Data directory |
| `--protocol auto\|stdio\|http` | `server.protocol` |
| `--host <host>` | `server.host` |
| `--port <port>` | The port of the command you start (`server.ports.*`) |
| `--public-url <url>` | `server.publicUrl` |
| `--public-origin <url>` | `server.publicOrigin` (deprecated) |
| `--server-name <name>` | `server.name` |
| `--server-title <title>` | `server.title` |
| `--server-instructions <text>` | `server.instructions` |
| `--server-instructions-file <path>` | `server.instructionsFile` |
| `--embedding-model <model>` | `app.embeddingModel` |
| `--read-only` | `app.readOnly` |
| `--accept-model-change` | Confirm a changed embedding model without a prompt (default command, `mcp` and `worker`) |
| `--no-telemetry` | `app.telemetryEnabled` |
| `--auth-enabled` | `auth.enabled` |
| `--auth-issuer-url <url>` | `auth.issuerUrl` |
| `--auth-audience <audience>` | `auth.audience` |

```bash
docs-mcp-server --port 8080 --host 0.0.0.0
docs-mcp-server --host 0.0.0.0 --public-url https://example.com/docs
docs-mcp-server --store-path /data/docs --read-only
docs-mcp-server --server-name acme-docs --server-title "Acme Docs" --server-instructions-file /etc/acme/instructions.md
```

The `scrape` command also takes per-job options, such as `--max-pages`, `--max-depth` and `--max-concurrency`, which override the matching `scraper` settings for that job.

## The `config` Command

```bash
# Print the configuration in effect as JSON
docs-mcp-server config

# Print it as YAML
docs-mcp-server config --output yaml

# Print one value
docs-mcp-server config get scraper.maxPages
# 1000

# Print a section
docs-mcp-server config get scraper.fetcher
# { "maxRetries": 3, "baseDelayMs": 1000, ... }

# Change a value in the default config file
docs-mcp-server config set scraper.maxPages 500
# Updated scraper.maxPages = 500
# Saved to: <path of config.yaml>
```

`config` and `config get` print the values in effect, after environment variables and flags. `config set` changes one value (not a whole section) in the default config file. It fails when `--config` names an explicit file.

---

## Configuration Reference

### App (`app`)

General application settings.

| Option | Default | Description |
|:-------|:--------|:------------|
| `storePath` | System data directory | Directory of the database. See [Data Directory](#data-directory). |
| `telemetryEnabled` | `true` | Send usage events. [Telemetry](../infrastructure/telemetry.md) lists what they contain. |
| `readOnly` | `false` | Register only the MCP tools that read the index. The tools that scrape, refresh, remove documentation or manage jobs are left out. |
| `embeddingModel` | `text-embedding-3-small` | Model for vector embeddings. See [Embedding Models](../guides/embedding-models.md). |

### Server (`server`)

Settings for the HTTP server and the MCP endpoint.

| Option | Default | Description |
|:-------|:--------|:------------|
| `name` | `docs-mcp-server` | Server name reported to MCP clients during initialization. Set this to tell instances apart when running more than one. |
| `title` | - | Human-readable server title reported to MCP clients alongside `name`. Clients that support it display the title; others fall back to `name`. The same name labels the server in the OAuth protected resource metadata when authentication is enabled. |
| `instructions` | built-in | Instructions text sent to MCP clients during initialization. Clients inject it into the model's context, so use it to describe what this server indexes and how to use it. When neither `instructions` nor `instructionsFile` is set, the server sends built-in instructions that explain how its tools work together; configured text replaces them entirely. Mutually exclusive with `instructionsFile`. |
| `instructionsFile` | - | Path to a file whose contents are used as `instructions`. Use an absolute path: relative paths resolve against the working directory, which is often unpredictable when a desktop client launches the server over stdio. Read once at startup; a missing or unreadable file fails startup. Setting both `instructions` and `instructionsFile` also fails startup. |
| `protocol` | `auto` | `stdio`, `http` or `auto`, for the default command and `mcp`. `auto` selects stdio when neither stdin nor stdout is a terminal, as when an MCP client starts the server, and HTTP otherwise. |
| `host` | `127.0.0.1` | Host interface to bind to. Use `0.0.0.0` to listen on all IPv4 interfaces. |
| `publicUrl` | - | The URL clients use to reach the server, optionally with a path, such as `https://example.com/docs`. Every advertised URL derives from it, and the server serves its routes under the path. Required when authentication is enabled. See [Reverse Proxy Deployment](../infrastructure/reverse-proxy.md). |
| `publicOrigin` | - | Deprecated: use `publicUrl`. Accepted as a public URL without a path; ignored when `publicUrl` is set. |
| `allowedOrigins` | `[]` | Browser origins, beyond loopback and the public URL's origin, allowed to call the MCP endpoint, and the API when the server binds to a loopback address (e.g. `["https://inspector.example.com"]`). Their host names are also accepted as the server's own name (see below). |
| `ports.default` | `6280` | Port of the default command, which serves the web UI, the API and the MCP endpoint. |
| `ports.mcp` | `6280` | Port of the `mcp` command. |
| `ports.web` | `6281` | Port of the `web` command. |
| `ports.worker` | `8080` | Port of the `worker` command. |
| `heartbeatMs` | `30000` | Interval (ms) of the keep-alive comments on the deprecated SSE transport. |

#### Host Names the Server Answers To

To stop DNS rebinding, the server refuses (`403`) any request whose `Host` header names a host it doesn't know. It answers to:

- IP addresses, such as `127.0.0.1` or `192.168.1.20`;
- `localhost`;
- single-label names, such as the Docker service name `docs-mcp-server`;
- the host of `publicUrl`;
- the hosts of `allowedOrigins`.

If you reach the server under another name, such as `nas.local`, set `publicUrl` to it or add `http://nas.local:6280` to `allowedOrigins`. The server logs a warning naming each refused host.

### Authentication (`auth`)

Bearer-token authentication for the MCP endpoint over HTTP. See [Authentication](../infrastructure/authentication.md).

| Option | Default | Description |
|:-------|:--------|:------------|
| `enabled` | `false` | Require a JWT access token on the MCP endpoint. |
| `issuerUrl` | - | The identity provider's issuer identifier (e.g., Clerk, Auth0). Must match the provider's published `issuer` exactly. |
| `audience` | - | Expected token audience. Defaults to `<publicUrl>/mcp`; set it only for providers that issue a fixed audience. |

### Scraper (`scraper`)

Settings for fetching and crawling. The `scrape` command can override `maxPages`, `maxDepth` and `maxConcurrency` for one job, and the `scrape_docs` MCP tool `maxPages` and `maxDepth`.

| Option | Default | Description |
|:-------|:--------|:------------|
| `maxPages` | `1000` | Maximum number of pages to crawl per job. |
| `maxDepth` | `3` | Maximum link depth to traverse. |
| `maxConcurrency` | `3` | Pages fetched at the same time within a job. It also sets how many jobs run at the same time. |
| `jobHeartbeatMs` | `15000` | How often a process marks its running and queued jobs alive in the store (ms). A server that starts on the same store treats a job as interrupted only after four intervals without a mark, so use one value for every process on a store. |
| `abortOnFailureRate` | `0.5` | Share of failed pages, from 0 to 1, above which a crawl stops. The start page does not count, and the check begins once 10 pages have finished. |
| `preserveHashes` | `false` | Keep hash fragments as part of a page's identity, for documentation sites that route with hash URLs (see [Hash Route Behavior](#hash-route-behavior)). |
| `skipKnownTrackers` | `true` | While a page renders in the browser, block requests to a built-in list of analytics, session replay, chat widget, captcha and social embed hosts. |
| `htmlExtractor` | `cheerio` | How content is extracted from HTML pages: `cheerio` (the default) or `defuddle`, an alternative kept for comparison. See [Search Quality Benchmark](../guides/benchmarking.md). |
| `pageTimeoutMs` | `5000` | Timeout for each wait while a page renders (content, iframes, network idle) and for closing a page or the browser (ms). A browser that does not close in time is killed. |
| `browserTimeoutMs` | `30000` | Timeout for a page navigation in the browser, used by the browser fetcher and the Playwright renderer (ms). |
| `fetcher.maxRetries` | `3` | Retries for a failed HTTP request. |
| `fetcher.baseDelayMs` | `1000` | Initial delay for exponential backoff between retries (ms). A host that answers 429 without `Retry-After` is paused for five times as long (see [Throttling](../concepts/content-processing.md#throttling)). |
| `fetcher.timeoutMs` | `30000` | Timeout for an HTTP request made without the browser (ms). |
| `fetcher.maxCacheItemSizeBytes` | `512000` | Largest resource, in bytes, that the browser renderer keeps in its in-memory cache. |
| `document.maxSize` | `10485760` | Maximum size (bytes) of a PDF, Office or other binary document. |

### Hash Route Behavior

Use `preserveHashes` only for documentation sites that route with hash URLs such as `https://docs.example.com/#/guide`. Leave it off for other sites, where a hash points to an anchor within the same page.

- CLI: `scrape --preserve-hashes` turns it on for a job; `refresh --preserve-hashes` overrides the stored setting for that refresh.
- MCP: `scrape_docs` takes `preserveHashes: true`.
- Web UI: the add-documentation form has a "Preserve hash routes" checkbox under "Advanced options".
- Refresh reuses the setting stored with the version.
- When `preserveHashes` is on and `scrapeMode` is `fetch`, the job switches to `playwright`, because only the browser can follow hash routes.

### Scraper Security (`scraper.security`)

These settings control which network targets and local files a scrape may reach. The defaults keep a server away from private networks and limit local files to the documents folder. [Infrastructure Security](../infrastructure/security.md) explains how each check decides.

#### Network (`scraper.security.network`)

| Option | Default | Description |
|:-------|:--------|:------------|
| `mode` | `open` | `open` reaches public targets and blocks private and special-use ones unless allowed below. `allowlist` reaches only what `allowedHosts` and `allowedCidrs` name. |
| `allowPrivateNetworks` | `false` | In `open` mode, allow loopback, the RFC 1918 private ranges, link-local and the other special-use targets. No effect in `allowlist` mode. |
| `allowedHosts` | `[]` | Host names to allow: literal names (`docs.internal.example`), globs (`*.example.com`, `docs.*`), or regular expressions wrapped in `/.../`. |
| `allowedCidrs` | `[]` | IP ranges to allow, matched against IP targets and resolved host addresses. |
| `allowInvalidTls` | `false` | Accept invalid HTTPS certificates for targets the rules above allow. |

[Outbound Network Access](../infrastructure/security.md#outbound-network-access) describes how host names, DNS answers and IP targets are matched.

#### File Access (`scraper.security.fileAccess`)

| Option | Default | Description |
|:-------|:--------|:------------|
| `mode` | `allowedRoots` | `allowedRoots` reads files only inside `allowedRoots`. `disabled` reads no `file://` URL. `unrestricted` reads any directory. |
| `allowedRoots` | `[$DOCUMENTS]` | Directories that `file://` URLs may read in `allowedRoots` mode: absolute paths or the tokens `$HOME`, `$DOCUMENTS`, `$DOWNLOADS`, `$DESKTOP` and `$CWD`. An empty list blocks all local files. |
| `followSymlinks` | `false` | Read paths that go through a symbolic link, as long as the resolved path stays inside an allowed root. |
| `includeHidden` | `false` | Read files, directories and archive entries whose names start with a dot. |

[Local File Access](../infrastructure/security.md#local-file-access) describes the rules and what each token stands for.

`$DOCUMENTS` stands for the `Documents` folder in the home directory and grants nothing when that folder does not exist. Headless hosts and containers, including the Docker image, often have none, and every `file://` scrape there fails with an error such as:

```
Local file access is limited to configured roots, but none of its entries are available on this system ($DOCUMENTS did not resolve), so file:///srv/docs/ cannot be indexed. See https://github.com/arabold/docs-mcp-server/blob/main/docs/setup/configuration.md to configure the allowed roots.
```

Set `allowedRoots` to the folder you want to index:

```bash
export DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_ALLOWED_ROOTS=/srv/docs
```

### Security Examples

Internal documentation on a private network, served with a self-signed certificate:

```yaml
scraper:
  security:
    network:
      mode: open
      allowedHosts:
        - "*.internal.example"
      allowedCidrs:
        - 10.42.0.0/16
      allowInvalidTls: true
```

Only a fixed set of public documentation sites, and no local files:

```yaml
scraper:
  security:
    network:
      mode: allowlist
      allowedHosts:
        - docs.python.org
        - "*.rust-lang.org"
        - /^docs\d+\.example\.com$/
    fileAccess:
      mode: disabled
```

Local files from the documents folder and one more directory:

```yaml
scraper:
  security:
    fileAccess:
      mode: allowedRoots
      allowedRoots:
        - $DOCUMENTS
        - /srv/docs
```

A trusted workstation with access to every local file and private network:

```yaml
scraper:
  security:
    network:
      allowPrivateNetworks: true
    fileAccess:
      mode: unrestricted
      followSymlinks: true
      includeHidden: true
```

### GitHub Authentication

GitHub scrapes look for a token in this order and use the first one found:

1. An `Authorization` header passed with the scrape, such as `--header "Authorization: Bearer <token>"`
2. The `GITHUB_TOKEN` environment variable
3. The `GH_TOKEN` environment variable
4. The local GitHub CLI (`gh auth token`)

A token gives access to private repositories and GitHub's higher rate limit for authenticated requests. Without one, public repositories still work at the lower anonymous rate limit.

### Splitter (`splitter`)

Settings for splitting documents into chunks.

| Option | Default | Description |
|:-------|:--------|:------------|
| `minChunkSize` | `500` | Minimum characters per chunk body. Chunks below this threshold are merged with adjacent chunks by the greedy optimizer. |
| `preferredChunkSize` | `1500` | Soft target for chunk body size in characters. The greedy optimizer splits when combining two chunks would exceed this value, provided both sides are already above `minChunkSize`. |
| `maxChunkSize` | `5000` | Upper limit for chunk body size in characters. The splitters cut larger content, except inside a fenced code block and in JSON that does not parse, which can produce larger chunks. |
| `treeSitterSizeLimit` | `30000` | Source files longer than this many characters are parsed for structure only up to this point. |
| `json.maxNestingDepth` | `5` | JSON nested deeper than this is split as plain text. |
| `json.maxChunks` | `1000` | A JSON file that would produce more chunks than this is split as plain text. |

These limits apply to the text body of each chunk. Before embedding, the server prepends a short header (page title, URL, section path), so the text sent to the embedding model is longer. Token counts depend on the model's tokenizer. For a model with a small context window, lower `maxChunkSize` to leave room for the header.

### Embeddings (`embeddings`)

Settings for generating vector embeddings. [Embedding Models](../guides/embedding-models.md) covers providers and models.

| Option | Default | Description |
|:-------|:--------|:------------|
| `batchSize` | `100` | Maximum chunks per embedding request. |
| `batchChars` | `50000` | Maximum total characters per embedding request. Lower it when the provider rejects large requests (HTTP 413). |
| `requestTimeoutMs` | `30000` | Timeout for each request to OpenAI or an OpenAI-compatible server (ms). |
| `initTimeoutMs` | `30000` | Timeout for the test embedding that detects the dimension of a model the server does not know (ms). |
| `vectorDimension` | `1536` | Dimension of the stored vectors. A positive integer. Without an explicit value, the server uses the model's own dimension. Changing it asks for confirmation on the next start. See [Vector Dimension](../guides/embedding-models.md#vector-dimension). |

### Search (`search`)

Settings for the hybrid search ranking.

| Option | Default | Description |
|:-------|:--------|:------------|
| `overfetchFactor` | `2` | Multiplier on the search limit for full-text candidates (fetches `limit * overfetchFactor`). |
| `weightVec` | `1` | Reciprocal rank fusion weight of vector search results. |
| `weightFts` | `1` | Reciprocal rank fusion weight of full-text search results. |
| `vectorMultiplier` | `10` | Further multiplier for vector search candidates (`limit * overfetchFactor * vectorMultiplier`). |

### Assembly (`assembly`)

Settings for reassembling search results.

| Option | Default | Description |
|:-------|:--------|:------------|
| `maxChunkDistance` | `3` | Maximum sort order difference between chunks that are merged into one result. |
| `maxParentChainDepth` | `10` | Maximum depth for parent context traversal. |
| `childLimit` | `3` | Maximum number of child chunks to include. |
| `precedingSiblingsLimit` | `1` | Number of preceding sibling chunks to include. |
| `subsequentSiblingsLimit` | `2` | Number of subsequent sibling chunks to include. |

### Database (`db`)

| Option | Default | Description |
|:-------|:--------|:------------|
| `migrationMaxRetries` | `5` | Retries for database migrations on startup. |
| `migrationRetryDelayMs` | `300` | Delay between migration retries (ms). |
