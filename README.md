# Grounded Docs: Your AI's Up-to-Date Documentation Expert

The open-source alternative to **Context7**, **Nia**, and **Ref.Tools**.

**Docs MCP Server** solves the problem of AI hallucinations and outdated knowledge by providing a personal, always-current documentation index for your AI coding assistant. It fetches official docs from websites, GitHub, npm, PyPI, and local files, allowing your AI to query the exact version you are using.

![Docs MCP Server Web Interface](docs/docs-mcp-server.png)

## 🚀 Quick Start

Get running in seconds with Docker (Recommended):

```bash
docker run --rm \
  -v docs-mcp-data:/data \
  -v docs-mcp-config:/config \
  -p 6280:6280 \
  ghcr.io/arabold/docs-mcp-server:latest \
  --protocol http --host 0.0.0.0 --port 6280
```

Open **[http://localhost:6280](http://localhost:6280)** to start adding documentation.

---

## 📚 Documentation

### Getting Started
-   **[Installation](docs/setup/installation.md)**: Detailed setup guides for Docker, Node.js (npx), and Embedded mode.
-   **[Connecting Clients](docs/guides/mcp-clients.md)**: How to connect Claude, VS Code (Cline/Roo), and other MCP clients.
-   **[Basic Usage](docs/guides/basic-usage.md)**: Using the Web UI, CLI, and scraping local files.
-   **[Configuration](docs/setup/configuration.md)**: Full reference for config files and environment variables.

### Key Concepts & Architecture
-   **[Deployment Modes](docs/infrastructure/deployment-modes.md)**: Standalone vs. Distributed (Docker Compose).
-   **[Authentication](docs/infrastructure/authentication.md)**: Securing your server with OAuth2/OIDC.
-   **[Telemetry](docs/infrastructure/telemetry.md)**: Privacy-first usage data collection.
-   **[Architecture](ARCHITECTURE.md)**: Deep dive into the system design.

---

## ✨ Why Docs MCP Server?

-   ✅ **Up-to-Date Context:** Fetches documentation directly from official sources on demand.
-   🎯 **Version-Specific:** Queries target the exact library versions in your project.
-   💡 **Reduces Hallucinations:** Grounds LLMs in real documentation.
-   🔒 **Private & Local:** Runs entirely on your machine; your code never leaves your network.
-   🧩 **Broad Compatibility:** Works with any MCP-compatible client (Claude, Cline, etc.).
-   🛠️ **Flexible:** Supports local files, websites, and GitHub repositories.

## 🤝 Contributing

We welcome contributions! Please see **[CONTRIBUTING.md](CONTRIBUTING.md)** for development guidelines and setup instructions.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
