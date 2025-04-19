# docs-mcp-server MCP Server

A MCP server for fetching and searching 3rd party package documentation.

## ✨ Key Features

- 🌐 **Versatile Scraping:** Fetch documentation from diverse sources like websites, GitHub, npm, PyPI, or local files.
- 🧠 **Intelligent Processing:** Automatically split content semantically and generate embeddings using your choice of models (OpenAI, Google Gemini, Azure OpenAI, AWS Bedrock, Ollama, and more).
- 💾 **Optimized Storage:** Leverage SQLite with `sqlite-vec` for efficient vector storage and FTS5 for robust full-text search.
- 🔍 **Powerful Hybrid Search:** Combine vector similarity and full-text search across different library versions for highly relevant results.
- ⚙️ **Asynchronous Job Handling:** Manage scraping and indexing tasks efficiently with a background job queue and MCP/CLI tools.
- 🐳 **Simple Deployment:** Get up and running quickly using Docker or npx.

## Overview

This project provides a Model Context Protocol (MCP) server designed to scrape, process, index, and search documentation for various software libraries and packages. It fetches content from specified URLs, splits it into meaningful chunks using semantic splitting techniques, generates vector embeddings using OpenAI, and stores the data in an SQLite database. The server utilizes `sqlite-vec` for efficient vector similarity search and FTS5 for full-text search capabilities, combining them for hybrid search results. It supports versioning, allowing documentation for different library versions (including unversioned content) to be stored and queried distinctly.

The server exposes MCP tools for:

- Starting a scraping job (`scrape_docs`): Returns a `jobId` immediately.
- Checking job status (`get_job_status`): Retrieves the current status and progress of a specific job.
- Listing active/completed jobs (`list_jobs`): Shows recent and ongoing jobs.
- Cancelling a job (`cancel_job`): Attempts to stop a running or queued job.
- Searching documentation (`search_docs`).
- Listing indexed libraries (`list_libraries`).
- Finding appropriate versions (`find_version`).
- Removing indexed documents (`remove_docs`).
- Fetching single URLs (`fetch_url`): Fetches a URL and returns its content as Markdown.

## Configuration

The following environment variables are supported to configure the embedding model behavior:

### Embedding Model Configuration

- `DOCS_MCP_EMBEDDING_MODEL`: **Optional.** Format: `provider:model_name` or just `model_name` (defaults to `text-embedding-3-small`). Supported providers and their required environment variables:

  - `openai` (default): Uses OpenAI's embedding models

    - `OPENAI_API_KEY`: **Required.** Your OpenAI API key
    - `OPENAI_ORG_ID`: **Optional.** Your OpenAI Organization ID
    - `OPENAI_API_BASE`: **Optional.** Custom base URL for OpenAI-compatible APIs (e.g., Ollama, Azure OpenAI)

  - `vertex`: Uses Google Cloud Vertex AI embeddings

    - `GOOGLE_APPLICATION_CREDENTIALS`: **Required.** Path to service account JSON key file

  - `gemini`: Uses Google Generative AI (Gemini) embeddings

    - `GOOGLE_API_KEY`: **Required.** Your Google API key

  - `aws`: Uses AWS Bedrock embeddings

    - `AWS_ACCESS_KEY_ID`: **Required.** AWS access key
    - `AWS_SECRET_ACCESS_KEY`: **Required.** AWS secret key
    - `AWS_REGION` or `BEDROCK_AWS_REGION`: **Required.** AWS region for Bedrock

  - `microsoft`: Uses Azure OpenAI embeddings
    - `AZURE_OPENAI_API_KEY`: **Required.** Azure OpenAI API key
    - `AZURE_OPENAI_API_INSTANCE_NAME`: **Required.** Azure instance name
    - `AZURE_OPENAI_API_DEPLOYMENT_NAME`: **Required.** Azure deployment name
    - `AZURE_OPENAI_API_VERSION`: **Required.** Azure API version

### Vector Dimensions

The database schema uses a fixed dimension of 1536 for embedding vectors. Only models that produce vectors with dimension ≤ 1536 are supported, except for certain providers (like Gemini) that support dimension reduction.

For OpenAI-compatible APIs (like Ollama), use the `openai` provider with `OPENAI_API_BASE` pointing to your endpoint.

These variables can be set regardless of how you run the server (Docker, npx, or from source).

## Running the MCP Server

There are two ways to run the docs-mcp-server:

### Option 1: Using Docker (Recommended)

This is the recommended approach for most users. It's easy, straightforward, and doesn't require Node.js to be installed.

1. **Ensure Docker is installed and running.**
2. **Configure your MCP settings:**

   **Claude/Cline/Roo Configuration Example:**
   Add the following configuration block to your MCP settings file (adjust path as needed):

   ```json
   {
     "mcpServers": {
       "docs-mcp-server": {
         "command": "docker",
         "args": [
           "run",
           "-i",
           "--rm",
           "-e",
           "OPENAI_API_KEY",
           "-v",
           "docs-mcp-data:/data",
           "ghcr.io/arabold/docs-mcp-server:latest"
         ],
         "env": {
           "OPENAI_API_KEY": "sk-proj-..." // Required: Replace with your key
         },
         "disabled": false,
         "autoApprove": []
       }
     }
   }
   ```

   Remember to replace `"sk-proj-..."` with your actual OpenAI API key and restart the application.

3. **That's it!** The server will now be available to your AI assistant.

**Docker Container Settings:**

- `-i`: Keep STDIN open, crucial for MCP communication over stdio.
- `--rm`: Automatically remove the container when it exits.
- `-e OPENAI_API_KEY`: **Required.** Set your OpenAI API key.
- `-v docs-mcp-data:/data`: **Required for persistence.** Mounts a Docker named volume `docs-mcp-data` to store the database. You can replace with a specific host path if preferred (e.g., `-v /path/on/host:/data`).

Any of the configuration environment variables (see [Configuration](#configuration) above) can be passed to the container using the `-e` flag. For example:

```bash
# Example 1: Using OpenAI embeddings (default)
docker run -i --rm \
  -e OPENAI_API_KEY="your-key-here" \
  -e DOCS_MCP_EMBEDDING_MODEL="text-embedding-3-small" \
  -v docs-mcp-data:/data \
  ghcr.io/arabold/docs-mcp-server:latest

# Example 2: Using OpenAI-compatible API (like Ollama)
docker run -i --rm \
  -e OPENAI_API_KEY="your-key-here" \
  -e OPENAI_API_BASE="http://localhost:11434/v1" \
  -e DOCS_MCP_EMBEDDING_MODEL="embeddings" \
  -v docs-mcp-data:/data \
  ghcr.io/arabold/docs-mcp-server:latest

# Example 3a: Using Google Cloud Vertex AI embeddings
docker run -i --rm \
  -e OPENAI_API_KEY="your-openai-key" \  # Keep for fallback to OpenAI
  -e DOCS_MCP_EMBEDDING_MODEL="vertex:text-embedding-004" \
  -e GOOGLE_APPLICATION_CREDENTIALS="/app/gcp-key.json" \
  -v docs-mcp-data:/data \
  -v /path/to/gcp-key.json:/app/gcp-key.json:ro \
  ghcr.io/arabold/docs-mcp-server:latest

# Example 3b: Using Google Generative AI (Gemini) embeddings
docker run -i --rm \
  -e OPENAI_API_KEY="your-openai-key" \  # Keep for fallback to OpenAI
  -e DOCS_MCP_EMBEDDING_MODEL="gemini:embedding-001" \
  -e GOOGLE_API_KEY="your-google-api-key" \
  -v docs-mcp-data:/data \
  ghcr.io/arabold/docs-mcp-server:latest

# Example 4: Using AWS Bedrock embeddings
docker run -i --rm \
  -e AWS_ACCESS_KEY_ID="your-aws-key" \
  -e AWS_SECRET_ACCESS_KEY="your-aws-secret" \
  -e AWS_REGION="us-east-1" \
  -e DOCS_MCP_EMBEDDING_MODEL="aws:amazon.titan-embed-text-v1" \
  -v docs-mcp-data:/data \
  ghcr.io/arabold/docs-mcp-server:latest

# Example 5: Using Azure OpenAI embeddings
docker run -i --rm \
  -e AZURE_OPENAI_API_KEY="your-azure-key" \
  -e AZURE_OPENAI_API_INSTANCE_NAME="your-instance" \
  -e AZURE_OPENAI_API_DEPLOYMENT_NAME="your-deployment" \
  -e AZURE_OPENAI_API_VERSION="2024-02-01" \
  -e DOCS_MCP_EMBEDDING_MODEL="microsoft:text-embedding-ada-002" \
  -v docs-mcp-data:/data \
  ghcr.io/arabold/docs-mcp-server:latest
```

### Option 2: Using npx

This approach is recommended when you need local file access (e.g., indexing documentation from your local file system). While this can also be achieved by mounting paths into a Docker container, using npx is simpler but requires a Node.js installation.

1. **Ensure Node.js is installed.**
2. **Configure your MCP settings:**

   **Claude/Cline/Roo Configuration Example:**
   Add the following configuration block to your MCP settings file:

   ```json
   {
     "mcpServers": {
       "docs-mcp-server": {
         "command": "npx",
         "args": ["-y", "--package=@arabold/docs-mcp-server", "docs-server"],
         "env": {
           "OPENAI_API_KEY": "sk-proj-..." // Required: Replace with your key
         },
         "disabled": false,
         "autoApprove": []
       }
     }
   }
   ```

   Remember to replace `"sk-proj-..."` with your actual OpenAI API key and restart the application.

3. **That's it!** The server will now be available to your AI assistant.

## Using the CLI

You can use the CLI to manage documentation directly, either via Docker or npx. **Important: Use the same method (Docker or npx) for both the server and CLI to ensure access to the same indexed documentation.**

### Using Docker CLI

If you're running the server with Docker, use Docker for the CLI as well:

```bash
docker run --rm \
  -e OPENAI_API_KEY="your-openai-api-key-here" \
  -v docs-mcp-data:/data \
  ghcr.io/arabold/docs-mcp-server:latest \
  docs-cli <command> [options]
```

Make sure to use the same volume name (`docs-mcp-data` in this example) as you did for the server. Any of the configuration environment variables (see [Configuration](#configuration) above) can be passed using `-e` flags, just like with the server.

### Using npx CLI

If you're running the server with npx, use npx for the CLI as well:

```bash
npx -y --package=@arabold/docs-mcp-server docs-cli <command> [options]
```

The npx approach will use the default data directory on your system (typically in your home directory), ensuring consistency between server and CLI.

(See "CLI Command Reference" below for available commands and options.)

### CLI Command Reference

The `docs-cli` provides commands for managing the documentation index. Access it either via Docker (`docker run -v docs-mcp-data:/data ghcr.io/arabold/docs-mcp-server:latest docs-cli ...`) or `npx` (`npx -y --package=@arabold/docs-mcp-server docs-cli ...`).

**General Help:**

```bash
docs-cli --help
# or
npx -y --package=@arabold/docs-mcp-server docs-cli --help
```

**Command Specific Help:** (Replace `docs-cli` with the `npx...` command if not installed globally)

```bash
docs-cli scrape --help
docs-cli search --help
docs-cli fetch-url --help
docs-cli find-version --help
docs-cli remove --help
docs-cli list --help
```

### Fetching Single URLs (`fetch-url`)

Fetches a single URL and converts its content to Markdown. Unlike `scrape`, this command does not crawl links or store the content.

```bash
docs-cli fetch-url <url> [options]
```

**Options:**

- `--no-follow-redirects`: Disable following HTTP redirects (default: follow redirects).
- `--scrape-mode <mode>`: HTML processing strategy: 'fetch' (fast, less JS), 'playwright' (slow, full JS), 'auto' (default).

**Examples:**

```bash
# Fetch a URL and convert to Markdown
docs-cli fetch-url https://example.com/page.html
```

### Scraping Documentation (`scrape`)

Scrapes and indexes documentation from a given URL for a specific library.

```bash
docs-cli scrape <library> <url> [options]
```

**Options:**

- `-v, --version <string>`: The specific version to associate with the scraped documents.
  - Accepts full versions (`1.2.3`), pre-release versions (`1.2.3-beta.1`), or partial versions (`1`, `1.2` which are expanded to `1.0.0`, `1.2.0`).
  - If omitted, the documentation is indexed as **unversioned**.
- `-p, --max-pages <number>`: Maximum pages to scrape (default: 1000).
- `-d, --max-depth <number>`: Maximum navigation depth (default: 3).
- `-c, --max-concurrency <number>`: Maximum concurrent requests (default: 3).
- `--scope <scope>`: Defines the crawling boundary: 'subpages' (default), 'hostname', or 'domain'.
- `--no-follow-redirects`: Disable following HTTP redirects (default: follow redirects).
- `--scrape-mode <mode>`: HTML processing strategy: 'fetch' (fast, less JS), 'playwright' (slow, full JS), 'auto' (default).
- `--ignore-errors`: Ignore errors during scraping (default: true).

**Examples:**

```bash
# Scrape React 18.2.0 docs
docs-cli scrape react --version 18.2.0 https://react.dev/
```

### Searching Documentation (`search`)

Searches the indexed documentation for a library, optionally filtering by version.

```bash
docs-cli search <library> <query> [options]
```

**Options:**

- `-v, --version <string>`: The target version or range to search within.
  - Supports exact versions (`18.0.0`), partial versions (`18`), or ranges (`18.x`).
  - If omitted, searches the **latest** available indexed version.
  - If a specific version/range doesn't match, it falls back to the latest indexed version _older_ than the target.
  - To search **only unversioned** documents, explicitly pass an empty string: `--version ""`. (Note: Omitting `--version` searches latest, which _might_ be unversioned if no other versions exist).
- `-l, --limit <number>`: Maximum number of results (default: 5).
- `-e, --exact-match`: Only match the exact version specified (disables fallback and range matching) (default: false).

**Examples:**

```bash
# Search latest React docs for 'hooks'
docs-cli search react 'hooks'
```

### Finding Available Versions (`find-version`)

Checks the index for the best matching version for a library based on a target, and indicates if unversioned documents exist.

```bash
docs-cli find-version <library> [options]
```

**Options:**

- `-v, --version <string>`: The target version or range. If omitted, finds the latest available version.

**Examples:**

```bash
# Find the latest indexed version for react
docs-cli find-version react
```

### Listing Libraries (`list`)

Lists all libraries currently indexed in the store.

```bash
docs-cli list
```

### Removing Documentation (`remove`)

Removes indexed documents for a specific library and version.

```bash
docs-cli remove <library> [options]
```

**Options:**

- `-v, --version <string>`: The specific version to remove. If omitted, removes **unversioned** documents for the library.

**Examples:**

```bash
# Remove React 18.2.0 docs
docs-cli remove react --version 18.2.0
```

### Version Handling Summary

- **Scraping:** Requires a specific, valid version (`X.Y.Z`, `X.Y.Z-pre`, `X.Y`, `X`) or no version (for unversioned docs). Ranges (`X.x`) are invalid for scraping.
- **Searching/Finding:** Accepts specific versions, partials, or ranges (`X.Y.Z`, `X.Y`, `X`, `X.x`). Falls back to the latest older version if the target doesn't match. Omitting the version targets the latest available. Explicitly searching `--version ""` targets unversioned documents.
- **Unversioned Docs:** Libraries can have documentation stored without a specific version (by omitting `--version` during scrape). These can be searched explicitly using `--version ""`. The `find-version` command will also report if unversioned docs exist alongside any semver matches.

## Development & Advanced Setup

This section covers running the server/CLI directly from the source code for development purposes. The primary usage method is now via the public Docker image as described in "Method 2".

### Running from Source (Development)

This provides an isolated environment and exposes the server via HTTP endpoints.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/arabold/docs-mcp-server.git # Replace with actual URL if different
    cd docs-mcp-server
    ```
2.  **Create `.env` file:**
    Copy the example and add your OpenAI key (see "Environment Setup" below).
    ```bash
    cp .env.example .env
    # Edit .env and add your OPENAI_API_KEY
    ```
3.  **Build the Docker image:**
    ```bash
    docker build -t docs-mcp-server .
    ```
4.  **Run the Docker container:**

    ```bash
    # Option 1: Using a named volume (recommended)
    # Docker automatically creates the volume 'docs-mcp-data' if it doesn't exist on first run.
    docker run -i --env-file .env -v docs-mcp-data:/data --name docs-mcp-server docs-mcp-server

    # Option 2: Mapping to a host directory
    # docker run -i --env-file .env -v /path/on/your/host:/data --name docs-mcp-server docs-mcp-server
    ```

    - `-i`: Keep STDIN open even if not attached. This is crucial for interacting with the server over stdio.
    - `--env-file .env`: Loads environment variables (like `OPENAI_API_KEY`) from your local `.env` file.
    - `-v docs-mcp-data:/data` or `-v /path/on/your/host:/data`: **Crucial for persistence.** This mounts a Docker named volume (Docker creates `docs-mcp-data` automatically if needed) or a host directory to the `/data` directory inside the container. The `/data` directory is where the server stores its `documents.db` file (as configured by `DOCS_MCP_STORE_PATH` in the Dockerfile). This ensures your indexed documentation persists even if the container is stopped or removed.
    - `--name docs-mcp-server`: Assigns a convenient name to the container.

    The server inside the container now runs directly using Node.js and communicates over **stdio**.

This method is useful for contributing to the project or running un-published versions.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/arabold/docs-mcp-server.git # Replace with actual URL if different
    cd docs-mcp-server
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Build the project:**
    This compiles TypeScript to JavaScript in the `dist/` directory.
    ```bash
    npm run build
    ```
4.  **Setup Environment:**
    Create and configure your `.env` file as described in "Environment Setup" below. This is crucial for providing the `OPENAI_API_KEY`.

5.  **Run:**
    - **Server (Development Mode):** `npm run dev:server` (builds, watches, and restarts)
    - **Server (Production Mode):** `npm run start` (runs pre-built code)
    - **CLI:** `npm run cli -- <command> [options]` or `node dist/cli.js <command> [options]`

### Environment Setup (for Source/Docker)

**Note:** This `.env` file setup is primarily needed when running the server from source or using the Docker method. When using the `npx` integration method, the `OPENAI_API_KEY` is set directly in the MCP configuration file.

1. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```
2. Update your OpenAI API key in `.env`:

   ```
   # Required: Your OpenAI API key for generating embeddings.
   OPENAI_API_KEY=your-api-key-here

   # Optional: Your OpenAI Organization ID (handled automatically by LangChain if set)
   OPENAI_ORG_ID=

   # Optional: Custom base URL for OpenAI API (e.g., for Azure OpenAI or compatible APIs)
   OPENAI_API_BASE=

   # Optional: Embedding model name (defaults to "text-embedding-3-small")
   # Examples: text-embedding-3-large, text-embedding-ada-002
   DOCS_MCP_EMBEDDING_MODEL=

   # Optional: Specify a custom directory to store the SQLite database file (documents.db).
   # If set, this path takes precedence over the default locations.
   # Default behavior (if unset):
   # 1. Uses './.store/' in the project root if it exists (legacy).
   # 2. Falls back to OS-specific data directory (e.g., ~/Library/Application Support/docs-mcp-server on macOS).
   # DOCS_MCP_STORE_PATH=/path/to/your/desired/storage/directory
   ```

### Debugging (from Source)

Since MCP servers communicate over stdio when run directly via Node.js, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script after building:

```bash
npx @modelcontextprotocol/inspector node dist/server.js
```

The Inspector will provide a URL to access debugging tools in your browser.

### Releasing

This project uses [semantic-release](https://github.com/semantic-release/semantic-release) and [Conventional Commits](https://www.conventionalcommits.org/) to automate the release process.

**How it works:**

1.  **Commit Messages:** All commits merged into the `main` branch **must** follow the Conventional Commits specification.
2.  **Manual Trigger:** The "Release" GitHub Actions workflow can be triggered manually from the Actions tab when you're ready to create a new release.
3.  **`semantic-release` Actions:** Determines version, updates `CHANGELOG.md` & `package.json`, commits, tags, publishes to npm, and creates a GitHub Release.

**What you need to do:**

- Use Conventional Commits.
- Merge changes to `main`.
- Trigger a release manually when ready from the Actions tab in GitHub.

**Automation handles:** Changelog, version bumps, tags, npm publish, GitHub releases.

### Architecture

For details on the project's architecture and design principles, please see [ARCHITECTURE.md](ARCHITECTURE.md).

_Notably, the vast majority of this project's code was generated by the AI assistant Cline, leveraging the capabilities of this very MCP server._
