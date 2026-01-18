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

You can manage the server using command-line tools.

**Note:** If you are using the Embedded Server, ensure you don't run concurrent write operations (scraping) if the database is locked.

```bash
# List indexed libraries
npx @arabold/docs-mcp-server@latest list

# Search documentation
npx @arabold/docs-mcp-server@latest search react "useState hook"

# Scrape new documentation
# (Note: Requires a running server URL if you want to offload processing,
# otherwise it runs locally)
npx @arabold/docs-mcp-server@latest scrape react https://react.dev/reference/react
```

## 📂 Scraping Local Files

You can index documentation from your local filesystem using `file://` URLs. This works in both the Web UI and CLI.

### Requirements
-   Files must be text-based (HTML, Markdown, JS, TS, etc.).
-   Binary files (PDF, images) are ignored.
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
