# Basic Usage

You work with the Docs MCP Server through the web interface, the command line, or an AI assistant connected over MCP. All three use the same local document store.

## Web Interface

Starting the server without a command (`npx @arabold/docs-mcp-server@latest`, or the Docker image) serves the web interface at **`http://localhost:6280`**. It has these pages:

- **Overview**: totals, recent indexing activity, system health and running jobs.
- **Libraries**: every indexed library. **Add library** starts indexing a new one, and **Refresh** updates all its versions.
- **A library's page**: its versions, with **Add version** and **Refresh all**. For each version it shows the scrape settings, the stored chunks, and the actions **Refresh (incremental)**, **Edit & re-index** and **Remove version**.
- **Jobs & Queue**: running, queued, failed and finished jobs. Cancel a job, retry a failed one, or clear finished jobs.
- **Search Playground**: runs a query against a library and version and shows the results an AI assistant would get.
- **Settings**: the running server's configuration, read-only.

The web interface has no sign-in of its own. To expose it beyond your machine, put it behind a reverse proxy with sign-in; see [Reverse Proxy Deployment](../infrastructure/reverse-proxy.md#protecting-the-web-ui-and-api).

### Launching Web UI for Embedded Server

The [embedded server](../setup/installation.md#embedded-server) that an AI tool starts over stdio serves no web interface. To manage its documentation, start the web interface on its own:

```bash
OPENAI_API_KEY="your-key" npx @arabold/docs-mcp-server@latest web
```

It opens at `http://localhost:6281` and uses the same document store. Pass it the same settings as the embedded server, such as the embedding API key and any `--store-path`. Stop it with `Ctrl+C` when you are done.

## CLI Usage

The CLI indexes and searches documentation without a running server, which suits scripts, CI pipelines and AI coding agents. It reads and writes the same document store as the server.

### Index Documentation

Index documentation from a URL:

```bash
npx @arabold/docs-mcp-server@latest scrape react https://react.dev/reference/react
```

Name a version and limit the crawl:

```bash
npx @arabold/docs-mcp-server@latest scrape react https://react.dev/reference/react \
  --version 19.0.0 --max-pages 200 --max-depth 3
```

By default, a crawl indexes up to 1000 pages, at most 3 links deep, within the starting URL's path (`--scope subpages`). The page and depth defaults come from the [scraper configuration](../setup/configuration.md#scraper-scraper). `npx @arabold/docs-mcp-server@latest scrape --help` lists all options, including include and exclude patterns, custom headers and `--scrape-mode`.

Local folders and files use `file://` URLs; see [Scraping Local Files](#scraping-local-files).

Scraping a library version that already exists fails and leaves it untouched. To re-index it from scratch, pass `--replace`. To update it in place, skipping unchanged pages, use `refresh`. To add more documents to it, pass `--no-clean`.

```bash
npx @arabold/docs-mcp-server@latest scrape react https://react.dev/reference/react --version 19.0.0 --replace
npx @arabold/docs-mcp-server@latest refresh react --version 19.0.0
```

### Library Names

- A library keeps the name as you entered it (`React`, `Next.js Docs`), and names match case-insensitively, so `react` and `REACT` reach the same library.
- In the web interface, **Add library** refuses a name that already exists. Add a version to the existing library instead.
- A new library's name must not be empty, must not contain control characters (such as tabs or line breaks), and can be at most 100 characters.
- No character in a name has a special meaning: `react@18` is a library named `react@18`. Use `--version 18` to index a version.

### Search the Index

Search a library with a natural-language query:

```bash
npx @arabold/docs-mcp-server@latest search react "useEffect cleanup" --output yaml
```

Without `--version`, the search uses the newest version. `--version` takes an exact version or a range such as `19.x`. An exact version also matches the closest older version; add `--exact-match` to prevent that. `--limit` sets the number of results (5 by default, at most 100).

```bash
npx @arabold/docs-mcp-server@latest search react "server components" --version 19.x --limit 3
```

Each result is one passage: its page's `url`, the matching text with surrounding context as `content`, and a relevance `score`. Matches far apart in one page come back as separate results, so a `url` can appear more than once.

### Fetch a Single Page

Fetch one URL and print it as Markdown, without adding it to the index:

```bash
npx @arabold/docs-mcp-server@latest fetch-url https://react.dev/reference/react/useEffect
```

HTML pages and documents such as PDFs come back as Markdown; JSON, XML and plain text come back unchanged. `fetch-url` also accepts `file://` URLs, and takes `--header`, `--scrape-mode` and `--no-follow-redirects`.

### Other Commands

| Command | Description |
|---------|-------------|
| `list` | List indexed libraries with each version's status, source URL and counts. |
| `find-version <library>` | Resolve the version that best matches `--version` (the newest when omitted). |
| `refresh <library>` | Re-index an existing version, skipping unchanged pages. Without `--version`, it refreshes the unversioned documentation. |
| `remove <library>` | Remove the version given by `--version`, or the unversioned documentation without it. Removing a library's last version removes the library. |
| `compact` | Reclaim unused space in the store file. It takes an exclusive lock, may block searches while it runs, and needs free disk space for a temporary copy of the store. |

The server commands `mcp`, `web` and `worker` are described in [Deployment Modes](../infrastructure/deployment-modes.md#commands), and `config` in [Configuration](../setup/configuration.md#the-config-command). `npx @arabold/docs-mcp-server@latest <command> --help` shows each command's options.

`list`, `search`, `find-version`, `scrape`, `refresh`, `remove` and `compact` accept `--server-url` (for example `http://localhost:8080/api`) to work against a separate worker process instead of the local store.

### Output Behavior

- `list`, `search` and `find-version` print JSON on stdout. Use `--output json|yaml|toon` to pick another format.
- `fetch-url`, `scrape`, `refresh`, `remove` and `compact` print plain text on stdout and ignore `--output`.
- Logs go to stderr. In a terminal they include progress messages; otherwise only errors appear, so scripts and agents can parse stdout. Set `LOG_LEVEL=INFO` to see progress messages anyway.
- `--verbose` adds debug output, and `--quiet` limits logs to errors.
- A failed command exits with a non-zero status and prints the error on stderr.

### Using CLI and Server Together

Starting the server without a command runs the MCP endpoint and the web interface:

```bash
npx @arabold/docs-mcp-server@latest
```

The CLI can run alongside it on the same store, for example from an AI coding agent, while you manage documentation in the web interface at `http://localhost:6280`.

### Agent Skills

The [`skills/`](https://github.com/arabold/docs-mcp-server/tree/main/skills) directory holds [Agent Skills](https://agentskills.io): instruction files that teach AI coding agents to use the CLI commands above.

| Skill | Purpose |
|-------|---------|
| `docs-search` | Find indexed libraries and search them (`list`, `search`, `find-version`) |
| `docs-manage` | Index, refresh, remove and compact documentation (`scrape`, `refresh`, `remove`, `compact`) |
| `fetch-url` | Fetch a single URL as Markdown |

Each skill is a folder with a `SKILL.md` file. Copy the folders to the skills location your agent reads, for example for [Claude Code](https://code.claude.com/docs/en/skills), [Gemini CLI](https://geminicli.com/docs/cli/skills/) or [Cursor](https://cursor.com/docs/skills). The agent then loads a skill when a task matches it. [agentskills.io](https://agentskills.io) has the specification and the list of compatible agents.

## Scraping Local Files

The web interface, the CLI and the `scrape_docs` tool index local files and folders through `file://` URLs:

- `file:///Users/me/Documents/docs/index.html` indexes one file.
- `file:///Users/me/Documents/docs/my-library` indexes a folder and its subfolders, including the contents of ZIP and TAR archives.

Text files such as HTML, Markdown and source code are indexed, and so are documents such as PDF, Word, Excel and PowerPoint files. Files of other types, hidden files and symbolic links are skipped. See [Supported Formats](../concepts/supported-formats.md) for the full list.

By default, the server reads local files only inside your Documents folder. To index another folder, add it to the allowed roots of the process that runs the scrape, for example:

```bash
DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_ALLOWED_ROOTS=/srv/docs \
  npx @arabold/docs-mcp-server@latest scrape mylib file:///srv/docs/my-library
```

The list replaces the default, so name the Documents folder too if you still need it: `'["$DOCUMENTS", "/srv/docs"]'`. [File Access](../setup/configuration.md#file-access-scrapersecurityfileaccess) describes the setting and how to keep it in the configuration file.

### Docker

A container sees only the folders you mount into it. Mount the folder and allow its path inside the container:

```bash
docker run --rm \
  -v docs-mcp-data:/data \
  -v docs-mcp-config:/config \
  -v /absolute/path/to/docs:/docs:ro \
  -e DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_ALLOWED_ROOTS=/docs \
  -p 6280:6280 \
  ghcr.io/arabold/docs-mcp-server:latest
```

Then index `file:///docs` from the web interface or an AI assistant.

## AI Assistant Usage

A connected AI assistant uses the server's MCP tools, such as `search_docs` to look things up and `scrape_docs` to index new documentation. [Connecting MCP Clients](mcp-clients.md#available-tools) lists every tool and how to connect your client.

Example requests:

> "Index the React documentation from https://react.dev/reference/react as library 'react', version '19.0.0'."

> "How does the useState hook work in React? Check the documentation."
