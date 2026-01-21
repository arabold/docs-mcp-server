# Embedding Model Configuration

This guide details how to configure the embedding models used for vector search. You can set the embedding model using the `embeddings.model` configuration key, the `DOCS_MCP_EMBEDDING_MODEL` environment variable, or the `--embedding-model` CLI flag.

## Model Selection

If you leave the model empty but provide `OPENAI_API_KEY`, the server defaults to `text-embedding-3-small`.

**Supported Options:**

- `text-embedding-3-small` (default, OpenAI)
- `openai:snowflake-arctic-embed2` (OpenAI-compatible, e.g., Ollama)
- `vertex:text-embedding-004` (Google Vertex AI)
- `gemini:embedding-001` (Google Gemini)
- `aws:amazon.titan-embed-text-v1` (AWS Bedrock)
- `microsoft:text-embedding-ada-002` (Azure OpenAI)
- Or any OpenAI-compatible model name

## Provider Configuration

Provider credentials use the provider-specific environment variables listed below.

| Variable                           | Description                                           |
| ---------------------------------- | ----------------------------------------------------- |
| `DOCS_MCP_EMBEDDING_MODEL`         | Embedding model to use.                               |
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

### Examples

Here are complete configuration examples for different embedding providers.

#### OpenAI (Default)

```bash
OPENAI_API_KEY="sk-proj-your-openai-api-key" \
DOCS_MCP_EMBEDDING_MODEL="text-embedding-3-small" \
npx @arabold/docs-mcp-server@latest
```

#### Ollama (Local)

Run local models compatible with the OpenAI API format.

```bash
OPENAI_API_KEY="ollama" \
OPENAI_API_BASE="http://localhost:11434/v1" \
DOCS_MCP_EMBEDDING_MODEL="nomic-embed-text" \
npx @arabold/docs-mcp-server@latest
```

#### LM Studio (Local)

Connect to LM Studio's local inference server.

```bash
OPENAI_API_KEY="lmstudio" \
OPENAI_API_BASE="http://localhost:1234/v1" \
DOCS_MCP_EMBEDDING_MODEL="text-embedding-qwen3-embedding-4b" \
npx @arabold/docs-mcp-server@latest
```

#### Google Gemini

Use Google's Gemini API directly.

```bash
GOOGLE_API_KEY="your-google-api-key" \
DOCS_MCP_EMBEDDING_MODEL="gemini:embedding-001" \
npx @arabold/docs-mcp-server@latest
```

#### Google Vertex AI

For enterprise GCP deployments.

```bash
GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/gcp-service-account.json" \
DOCS_MCP_EMBEDDING_MODEL="vertex:text-embedding-004" \
npx @arabold/docs-mcp-server@latest
```

#### AWS Bedrock

Use Amazon Titan or other Bedrock-hosted models.

```bash
AWS_ACCESS_KEY_ID="your-aws-access-key-id" \
AWS_SECRET_ACCESS_KEY="your-aws-secret-access-key" \
AWS_REGION="us-east-1" \
DOCS_MCP_EMBEDDING_MODEL="aws:amazon.titan-embed-text-v1" \
npx @arabold/docs-mcp-server@latest
```

#### Azure OpenAI

Connect to your private Azure OpenAI deployment.

```bash
AZURE_OPENAI_API_KEY="your-azure-openai-api-key" \
AZURE_OPENAI_API_INSTANCE_NAME="your-instance-name" \
AZURE_OPENAI_API_DEPLOYMENT_NAME="your-deployment-name" \
AZURE_OPENAI_API_VERSION="2024-02-01" \
DOCS_MCP_EMBEDDING_MODEL="microsoft:text-embedding-ada-002" \
npx @arabold/docs-mcp-server@latest
```
