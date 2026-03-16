# Basic Usage

Once the server is running, you can interact with it via the Web Interface, CLI, or your AI Assistant.

## 🌐 Web Interface

If you are running the Standalone Server (Docker or npx), the web interface is available at:

**`http://localhost:6280`**

Use this interface to:
-   **Add New Documentation:** Submit URLs for indexing.
-   **Monitor Jobs:** Watch the scraping and indexing progress.
-   **Manage Library:** View and delete indexed documentation.
-   **Search:** Manually test search queries to see what the AI will see.

### Launching Web UI for Embedded Server

If you are using the [Embedded Server](../setup/installation.md#embedded-server) (running inside your AI tool), it does not expose a web interface by default. You can launch a temporary web UI that connects to the same database:

```bash
OPENAI_API_KEY="your-key" npx @arabold/docs-mcp-server@latest web --port 6281
```

Open `http://localhost:6281`. Stop the process (`Ctrl+C`) when finished.

## 💻 CLI Usage

The CLI lets you index and query documentation directly from the command line — no running server required. This is ideal for scripting, CI pipelines, and AI coding agents.

**Note:** If you are using the Embedded Server, ensure you don't run concurrent write operations (scraping) if the database is locked.

### Index Documentation

Download and index documentation from a URL or local directory:

```bash
npx @arabold/docs-mcp-server@latest scrape react https://react.dev/reference/react
```

You can tag a specific version, limit crawl depth, and more:

```bash
npx @arabold/docs-mcp-server@latest scrape react https://react.dev/reference/react \
  --version 19.0.0 --max-pages 200 --max-depth 3
```

Local files are also supported using the `file://` URL scheme:

```bash
npx @arabold/docs-mcp-server@latest scrape mylib file:///Users/me/docs/my-library
```

### Search the Index

Query indexed documentation by library name and a natural-language query:

```bash
npx @arabold/docs-mcp-server@latest search react "useEffect cleanup" --output yaml
```

Use `--version` to target a specific version and `--limit` to control the number of results:

```bash
npx @arabold/docs-mcp-server@latest search react "server components" --version 19.x --limit 3
```

### Fetch a Single Page

Fetch any URL and convert it to Markdown without adding it to the index:

```bash
npx @arabold/docs-mcp-server@latest fetch-url https://react.dev/reference/react/useEffect
```

### Other Commands

| Command | Description |
|---------|-------------|
| `list` | List all indexed libraries and their versions |
| `find-version <library>` | Resolve the best matching version for a library |
| `refresh <library>` | Re-scrape an existing library, skipping unchanged pages |
| `remove <library>` | Delete a library or version from the index |

Run `npx @arabold/docs-mcp-server@latest --help` for the full command reference.

### Output Behavior

- Structured commands (`list`, `search`, `find-version`) default to **JSON** on stdout in non-interactive runs.
- Use `--output json|yaml|toon` to pick a format.
- Plain-text commands (`fetch-url`, `scrape`, `refresh`, `remove`) write their output directly to stdout.
- Use `--quiet` to suppress non-error diagnostics or `--verbose` for debug output.
- In non-interactive runs, diagnostics stay off stdout so agents and scripts can parse results safely.

### Using CLI and Server Together

Starting the server without any command runs both the MCP endpoint and the web interface:

```bash
npx @arabold/docs-mcp-server@latest
```

You can then use the CLI in parallel to query the same local database, for example from an AI coding agent, while managing documentation through the web UI at **[http://localhost:6280](http://localhost:6280)**.

### Agent Skills

The repository ships with ready-made [Agent Skills](https://agentskills.io) in the [`skills/`](https://github.com/arabold/docs-mcp-server/tree/main/skills) directory. Agent Skills are an open format for giving AI coding agents new capabilities — they contain structured instructions that teach an agent how to use the CLI commands above.

**Bundled skills:**

| Skill | Purpose |
|-------|---------|
| **docs-search** | Search and query the documentation index (`list`, `search`, `find-version`) |
| **docs-manage** | Manage the index — scrape, refresh, and remove documentation |
| **fetch-url** | Fetch a single URL and convert it to Markdown |

Each skill folder contains a `SKILL.md` file with structured instructions, command references, flag tables, and example workflows. Compatible agents discover these files automatically and load the relevant skill when a matching task is detected.

Skills are supported by a growing number of agents including Claude Code, Gemini CLI, Cursor, OpenCode, Roo Code, and many others. Copy the skill folders from the [`skills/`](https://github.com/arabold/docs-mcp-server/tree/main/skills) directory into the appropriate location for your agent. Consult your agent's documentation for the correct path — for example, [Claude Code](https://code.claude.com/docs/en/skills), [Gemini CLI](https://geminicli.com/docs/cli/skills/), or [Cursor](https://cursor.com/docs/context/skills).

See **[agentskills.io](https://agentskills.io)** for the full specification and a list of all compatible agents.

## 📂 Scraping Local Files

You can index documentation from your local filesystem using `file://` URLs. This works in both the Web UI and CLI.

### Requirements
-   Supports text files (HTML, Markdown, source code, etc.) and documents (PDF, Word, Excel, PowerPoint, and more). See [Supported Formats](../concepts/supported-formats.md) for the full list.
-   Unsupported binary files (images, videos, executables) are skipped.
-   **Docker Users:** You must mount the local directory into the container first.

### Examples

**Web UI / CLI Input:**
-   `file:///Users/me/docs/index.html` (Single file)
-   `file:///Users/me/docs/my-library` (Directory)

**Docker Example:**

If your docs are in `/absolute/path/to/docs` on your host:

1.  **Mount the volume:**
    ```bash
    docker run --rm \
      -v /absolute/path/to/docs:/docs:ro \
      ... (other args) ...
      ghcr.io/arabold/docs-mcp-server:latest
    ```

2.  **Scrape using the container path:**
    URL: `file:///docs`

## 🤖 AI Assistant Usage

Once connected, your AI assistant (Claude, Cline, etc.) will have access to tools like `scrape_docs` and `search_docs`.

**Example Prompt:**
> "Please scrape the React documentation from https://react.dev/reference/react for library 'react' version '18.x'"

**Example Query:**
> "How does the useState hook work in React? Please check the documentation."
