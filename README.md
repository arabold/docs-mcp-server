[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/arabold-docs-mcp-server-badge.png)](https://mseep.ai/app/arabold-docs-mcp-server)

# Docs MCP Server: Your AI's Up-to-Date Documentation Expert

AI coding assistants often struggle with outdated documentation and hallucinations. The **Docs MCP Server** solves this by providing a personal, always-current knowledge base for your AI. It **indexes 3rd party documentation** from various sources (websites, GitHub, npm, PyPI, local files) and offers powerful, version-aware search tools via the Model Context Protocol (MCP).

This enables your AI agent to access the **latest official documentation**, dramatically improving the quality and reliability of generated code and integration details. It's **free**, **open-source**, runs **locally** for privacy, and integrates seamlessly into your development workflow.

## Why Use the Docs MCP Server?

LLM-assisted coding promises speed and efficiency, but often falls short due to:

- 🌀 **Stale Knowledge:** LLMs train on snapshots of the internet and quickly fall behind new library releases and API changes.
- 👻 **Code Hallucinations:** AI can invent plausible-looking code that is syntactically correct but functionally wrong or uses non-existent APIs.
- ❓ **Version Ambiguity:** Generic answers rarely account for the specific version dependencies in your project, leading to subtle bugs.
- ⏳ **Verification Overhead:** Developers spend valuable time double-checking AI suggestions against official documentation.

**Docs MCP Server solves these problems by:**

- ✅ **Providing Up-to-Date Context:** Fetches and indexes documentation directly from official sources (websites, GitHub, npm, PyPI, local files) on demand.
- 🎯 **Delivering Version-Specific Answers:** Search queries can target exact library versions, ensuring information matches your project's dependencies.
- 💡 **Reducing Hallucinations:** Grounds the LLM in real documentation for accurate examples and integration details.
- ⚡ **Boosting Productivity:** Get trustworthy answers faster, integrated directly into your AI assistant workflow.

## ✨ Key Features

- **Accurate & Version-Aware AI Responses:** Provides up-to-date, version-specific documentation to reduce AI hallucinations and improve code accuracy.
- **Broad Source Compatibility:** Scrapes documentation from websites, GitHub repos, package manager sites (npm, PyPI), and local file directories.
- **Advanced Search & Processing:** Intelligently chunks documentation semantically, generates embeddings, and combines vector similarity with full-text search.
- **Flexible Embedding Models:** Supports various providers including OpenAI (and compatible APIs), Google Gemini/Vertex AI, Azure OpenAI, and AWS Bedrock.
- **Web Interface:** Easy-to-use web interface for searching and managing documentation.
- **Local & Private:** Runs entirely on your machine, ensuring data and queries remain private.
- **Free & Open Source:** Community-driven and freely available.
- **Simple Deployment:** Easy setup via Docker or `npx`.
- **Seamless Integration:** Works with MCP-compatible clients (like Claude, Cline, Roo).

> **What is semantic chunking?**
>
> Semantic chunking splits documentation into meaningful sections based on structure—like headings, code blocks, and tables—rather than arbitrary text size. Docs MCP Server preserves logical boundaries, keeps code and tables intact, and removes navigation clutter from HTML docs. This ensures LLMs receive coherent, context-rich information for more accurate and relevant answers.

## How to Run the Docs MCP Server

Get started quickly:

- [Recommended: Docker Desktop](#recommended-docker-desktop)
- [Alternative: Using Docker](#alternative-using-docker)
- [Alternative: Using npx](#alternative-using-npx)

## Recommended: Docker Desktop

Run the server and web interface together using Docker Compose.

1. **Install Docker and Docker Compose.**
2. **Clone the repository:**
   ```bash
   git clone https://github.com/arabold/docs-mcp-server.git
   cd docs-mcp-server
   ```
3. **Set up your environment:**
   Copy the example environment file and add your OpenAI API key:
   ```bash
   cp .env.example .env
   # Edit .env and set your OpenAI API key
   ```
4. **Start the services:**
   ```bash
   docker compose up -d
   ```
   - Use `-d` for detached mode. Omit to see logs in your terminal.
   - To rebuild after updates: `docker compose up -d --build`.
5. **Configure your MCP client:**
   Add this to your MCP settings:
   ```json
   {
     "mcpServers": {
       "docs-mcp-server": {
         "url": "http://localhost:6280/sse",
         "disabled": false,
         "autoApprove": []
       }
     }
   }
   ```
   Restart your AI assistant after updating the config.
6. **Access the Web Interface:**
   Open `http://localhost:6281` in your browser.

**Benefits:**

- One command runs both server and web UI
- Persistent data storage via Docker volume
- Easy config via `.env`

To stop, run `docker compose down`.

### Adding Library Documentation

1. Open the Web Interface at `http://localhost:6281`.
2. Use the "Queue New Scrape Job" form.
3. Enter the documentation URL, library name, and (optionally) version.
4. Click "Queue Job". Monitor progress in the Job Queue.
5. Repeat for each library you want indexed.

Once a job completes, the docs are searchable via your AI assistant or the Web UI.

![Docs MCP Server Web Interface](docs/docs-mcp-server.png)

## Scraping Local Files and Folders

You can index documentation from your local filesystem by using a `file://` URL as the source. This works in both the Web UI and CLI.

**Examples:**

- Web: `https://react.dev/reference/react`
- Local file: `file:///Users/me/docs/index.html`
- Local folder: `file:///Users/me/docs/my-library`

**Requirements:**

- All files with a MIME type of `text/*` are processed. This includes HTML, Markdown, plain text, and source code files such as `.js`, `.ts`, `.tsx`, `.css`, etc. Binary files, PDFs, images, and other non-text formats are ignored.
- You must use the `file://` prefix for local files/folders.
- The path must be accessible to the server process.
- **If running in Docker or Docker Compose:**
  - You must mount the local folder into the container and use the container path in your `file://` URL.
  - Example Docker run:
    ```bash
    docker run --rm \
      -e OPENAI_API_KEY="your-key" \
      -v /absolute/path/to/docs:/docs:ro \
      -v docs-mcp-data:/data \
      ghcr.io/arabold/docs-mcp-server:latest \
      scrape mylib file:///docs/my-library
    ```
  - In the Web UI, enter the path as `file:///docs/my-library` (matching the container path).

See the tooltips in the Web UI and CLI help for more details.

## Alternative: Using Docker

> **Note:** The published Docker images support both x86_64 (amd64) and Mac Silicon (arm64).

This method is simple and doesn't require cloning the repository.

1. **Install and start Docker.**
2. **Configure your MCP client:**
   Add this block to your MCP settings (adjust as needed):
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
           "OPENAI_API_KEY": "sk-proj-..." // Your OpenAI API key
         },
         "disabled": false,
         "autoApprove": []
       }
     }
   }
   ```
   Replace `sk-proj-...` with your OpenAI API key. Restart your application.
3. **Done!** The server is now available to your AI assistant.

**Docker Container Settings:**

- `-i`: Keeps STDIN open for MCP communication.
- `--rm`: Removes the container on exit.
- `-e OPENAI_API_KEY`: **Required.**
- `-v docs-mcp-data:/data`: **Required for persistence.**

You can pass any configuration environment variable (see [Configuration](#configuration)) using `-e`.

**Examples:**

```bash
# OpenAI embeddings (default)
docker run -i --rm \
  -e OPENAI_API_KEY="your-key" \
  -e DOCS_MCP_EMBEDDING_MODEL="text-embedding-3-small" \
  -v docs-mcp-data:/data \
  ghcr.io/arabold/docs-mcp-server:latest

# OpenAI-compatible API (Ollama)
docker run -i --rm \
  -e OPENAI_API_KEY="your-key" \
  -e OPENAI_API_BASE="http://localhost:11434/v1" \
  -e DOCS_MCP_EMBEDDING_MODEL="embeddings" \
  -v docs-mcp-data:/data \
  ghcr.io/arabold/docs-mcp-server:latest

# Google Vertex AI
docker run -i --rm \
  -e DOCS_MCP_EMBEDDING_MODEL="vertex:text-embedding-004" \
  -e GOOGLE_APPLICATION_CREDENTIALS="/app/gcp-key.json" \
  -v docs-mcp-data:/data \
  -v /path/to/gcp-key.json:/app/gcp-key.json:ro \
  ghcr.io/arabold/docs-mcp-server:latest

# Google Gemini
docker run -i --rm \
  -e DOCS_MCP_EMBEDDING_MODEL="gemini:embedding-001" \
  -e GOOGLE_API_KEY="your-google-api-key" \
  -v docs-mcp-data:/data \
  ghcr.io/arabold/docs-mcp-server:latest

# AWS Bedrock
docker run -i --rm \
  -e AWS_ACCESS_KEY_ID="your-aws-key" \
  -e AWS_SECRET_ACCESS_KEY="your-aws-secret" \
  -e AWS_REGION="us-east-1" \
  -e DOCS_MCP_EMBEDDING_MODEL="aws:amazon.titan-embed-text-v1" \
  -v docs-mcp-data:/data \
  ghcr.io/arabold/docs-mcp-server:latest

# Azure OpenAI
docker run -i --rm \
  -e AZURE_OPENAI_API_KEY="your-azure-key" \
  -e AZURE_OPENAI_API_INSTANCE_NAME="your-instance" \
  -e AZURE_OPENAI_API_DEPLOYMENT_NAME="your-deployment" \
  -e AZURE_OPENAI_API_VERSION="2024-02-01" \
  -e DOCS_MCP_EMBEDDING_MODEL="microsoft:text-embedding-ada-002" \
  -v docs-mcp-data:/data \
  ghcr.io/arabold/docs-mcp-server:latest
```

### Web Interface via Docker

Access the web UI at `http://localhost:6281`:

```bash
docker run --rm \
  -e OPENAI_API_KEY="your-openai-api-key" \
  -v docs-mcp-data:/data \
  -p 6281:6281 \
  ghcr.io/arabold/docs-mcp-server:latest \
  web --port 6281
```

- Use the same volume name as your server.
- Map port 6281 with `-p 6281:6281`.
- Pass config variables with `-e` as needed.

### CLI via Docker

Run CLI commands by appending them after the image name:

```bash
docker run --rm \
  -e OPENAI_API_KEY="your-openai-api-key" \
  -v docs-mcp-data:/data \
  ghcr.io/arabold/docs-mcp-server:latest \
  <command> [options]
```

Example:

```bash
docker run --rm \
  -e OPENAI_API_KEY="your-openai-api-key" \
  -v docs-mcp-data:/data \
  ghcr.io/arabold/docs-mcp-server:latest \
  list
```

Use the same volume for data sharing. For command help, run:

```bash
docker run --rm ghcr.io/arabold/docs-mcp-server:latest --help
```

## Alternative: Using npx

You can run the Docs MCP Server without installing or cloning the repo:

1. **Run the server:**
   ```bash
   npx @arabold/docs-mcp-server@latest
   ```
2. **Set your OpenAI API key:**
   - Use the `OPENAI_API_KEY` environment variable.
   - Example:
     ```bash
     OPENAI_API_KEY="sk-proj-..." npx @arabold/docs-mcp-server@latest
     ```
3. **Configure your MCP client:**
   - Use the same settings as in the Docker example, but replace the `command` and `args` with the `npx` command above.

**Note:** Data is stored in a temporary directory and will not persist between runs. For persistent storage, use Docker or a local install.

### CLI via npx

You can run CLI commands directly with npx, without installing the package globally:

```bash
npx @arabold/docs-mcp-server@latest <command> [options]
```

Example:

```bash
npx @arabold/docs-mcp-server@latest list
```

For command help, run:

```bash
npx @arabold/docs-mcp-server@latest --help
```

## Configuration

The Docs MCP Server is configured via environment variables. Set these in your shell, Docker, or MCP client config.

| Variable                           | Description                                           |
| ---------------------------------- | ----------------------------------------------------- |
| `DOCS_MCP_EMBEDDING_MODEL`         | Embedding model to use (see below for options).       |
| `OPENAI_API_KEY`                   | OpenAI API key for embeddings.                        |
| `OPENAI_API_BASE`                  | Custom OpenAI-compatible API endpoint (e.g., Ollama). |
| `GOOGLE_API_KEY`                   | Google API key for Gemini embeddings.                 |
| `GOOGLE_APPLICATION_CREDENTIALS`   | Path to Google service account JSON for Vertex AI.    |
| `AWS_ACCESS_KEY_ID`                | AWS key for Bedrock embeddings.                       |
| `AWS_SECRET_ACCESS_KEY`            | AWS secret for Bedrock embeddings.                    |
| `AWS_REGION`                       | AWS region for Bedrock.                               |
| `AZURE_OPENAI_API_KEY`             | Azure OpenAI API key.                                 |
| `AZURE_OPENAI_API_INSTANCE_NAME`   | Azure OpenAI instance name.                           |
| `AZURE_OPENAI_API_DEPLOYMENT_NAME` | Azure OpenAI deployment name.                         |
| `AZURE_OPENAI_API_VERSION`         | Azure OpenAI API version.                             |
| `DOCS_MCP_DATA_DIR`                | Data directory (default: `./data`).                   |
| `DOCS_MCP_PORT`                    | Server port (default: `6281`).                        |

See [examples above](#alternative-using-docker) for usage.

### Embedding Model Options

Set `DOCS_MCP_EMBEDDING_MODEL` to one of:

- `text-embedding-3-small` (default, OpenAI)
- `openai:llama2` (OpenAI-compatible, Ollama)
- `vertex:text-embedding-004` (Google Vertex AI)
- `gemini:embedding-001` (Google Gemini)
- `aws:amazon.titan-embed-text-v1` (AWS Bedrock)
- `microsoft:text-embedding-ada-002` (Azure OpenAI)
- Or any OpenAI-compatible model name

For more, see the [ARCHITECTURE.md](ARCHITECTURE.md) and [examples above](#alternative-using-docker).

## Development

To develop or contribute to the Docs MCP Server:

- Fork the repository and create a feature branch.
- Follow the code conventions in [ARCHITECTURE.md](ARCHITECTURE.md).
- Write clear commit messages (see Git guidelines above).
- Open a pull request with a clear description of your changes.

For questions or suggestions, open an issue.

### Architecture

For details on the project's architecture and design principles, please see [ARCHITECTURE.md](ARCHITECTURE.md).

_Notably, the vast majority of this project's code was generated by the AI assistant Cline, leveraging the capabilities of this very MCP server._

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
