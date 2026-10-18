# Embedding Models

An embedding model turns each chunk of documentation into a vector, so that search finds passages by meaning as well as by their words. Search combines these vector results with full-text results. Without an embedding model, the server runs full-text search only.

## Choosing a Model

Set the model with one of these, listed from highest to lowest precedence:

- the `--embedding-model` flag;
- the `DOCS_MCP_APP_EMBEDDING_MODEL` or `DOCS_MCP_EMBEDDING_MODEL` environment variable;
- `app.embeddingModel` in the config file (see [Configuration](../setup/configuration.md)).

The default is OpenAI's `text-embedding-3-small`, which needs `OPENAI_API_KEY`. When the credentials of the selected provider are missing, the server starts anyway, logs a warning and runs full-text search only.

A model is written as `provider:model`:

| Prefix | Provider | Example |
|:-------|:---------|:--------|
| none or `openai` | OpenAI or an OpenAI-compatible server (Ollama, LM Studio, llama.cpp and others) | `text-embedding-3-small`, `nomic-embed-text:latest` |
| `vertex` | Google Vertex AI | `vertex:text-embedding-004` |
| `gemini` | Google Gemini API | `gemini:gemini-embedding-001` |
| `aws` | AWS Bedrock | `aws:amazon.titan-embed-text-v1` |
| `microsoft` | Azure OpenAI | `microsoft:text-embedding-ada-002` |

A prefix counts as a provider only when it is one of these names, in any letter case. Any other name goes to the OpenAI-compatible endpoint unchanged. Names with a namespace, tag or quantization suffix, as Ollama, LM Studio and llama.cpp write them, work as written and need no `openai:` prefix: `nomic-embed-text:latest`, `second-state/jina-embeddings-v3-GGUF:Q4_K_M`.

## Provider Credentials

Each provider reads its credentials from environment variables:

| Provider | Required | Optional |
|:---------|:---------|:---------|
| OpenAI and compatible | `OPENAI_API_KEY` | `OPENAI_API_BASE`: base URL of an OpenAI-compatible API |
| Vertex AI | `GOOGLE_APPLICATION_CREDENTIALS`: path to a service account JSON key | |
| Gemini | `GOOGLE_API_KEY` | |
| AWS Bedrock | `BEDROCK_AWS_REGION` or `AWS_REGION` (the first wins), and either `AWS_PROFILE` or both `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` | `AWS_SESSION_TOKEN` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_INSTANCE_NAME`, `AZURE_OPENAI_API_DEPLOYMENT_NAME`, `AZURE_OPENAI_API_VERSION` | |

An OpenAI-compatible server that needs no key still needs `OPENAI_API_KEY` set, to any value.

Where the variables go depends on how you run the server: prefix the command, pass `-e` to `docker run`, write them to `.env` for Docker Compose, or list them under `env` in an MCP client's settings. [Installation](../setup/installation.md) shows each.

## Examples

### OpenAI

```bash
OPENAI_API_KEY="sk-proj-your-openai-api-key" \
DOCS_MCP_EMBEDDING_MODEL="text-embedding-3-small" \
npx @arabold/docs-mcp-server@latest
```

### Ollama

Pull the model in Ollama first (`ollama pull nomic-embed-text`).

```bash
OPENAI_API_KEY="ollama" \
OPENAI_API_BASE="http://localhost:11434/v1" \
DOCS_MCP_EMBEDDING_MODEL="nomic-embed-text:latest" \
npx @arabold/docs-mcp-server@latest
```

### LM Studio

Start LM Studio's local server with an embedding model loaded.

```bash
OPENAI_API_KEY="lmstudio" \
OPENAI_API_BASE="http://localhost:1234/v1" \
DOCS_MCP_EMBEDDING_MODEL="text-embedding-qwen3-embedding-4b" \
npx @arabold/docs-mcp-server@latest
```

### Google Gemini

```bash
GOOGLE_API_KEY="your-google-api-key" \
DOCS_MCP_EMBEDDING_MODEL="gemini:gemini-embedding-001" \
npx @arabold/docs-mcp-server@latest
```

Gemini models produce vectors that can be shortened. With an explicit [vector dimension](#vector-dimension) below the model's own, the server keeps the first part of each vector.

### Google Vertex AI

```bash
GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/gcp-service-account.json" \
DOCS_MCP_EMBEDDING_MODEL="vertex:text-embedding-004" \
npx @arabold/docs-mcp-server@latest
```

### AWS Bedrock

```bash
AWS_ACCESS_KEY_ID="your-aws-access-key-id" \
AWS_SECRET_ACCESS_KEY="your-aws-secret-access-key" \
AWS_REGION="us-east-1" \
DOCS_MCP_EMBEDDING_MODEL="aws:amazon.titan-embed-text-v1" \
npx @arabold/docs-mcp-server@latest
```

With a named AWS profile, set `AWS_PROFILE` instead of the two keys. The model name is the full Bedrock model ID, colons included, such as `aws:amazon.titan-embed-text-v2:0`.

### Azure OpenAI

```bash
AZURE_OPENAI_API_KEY="your-azure-openai-api-key" \
AZURE_OPENAI_API_INSTANCE_NAME="your-instance-name" \
AZURE_OPENAI_API_DEPLOYMENT_NAME="your-deployment-name" \
AZURE_OPENAI_API_VERSION="2024-02-01" \
DOCS_MCP_EMBEDDING_MODEL="microsoft:text-embedding-ada-002" \
npx @arabold/docs-mcp-server@latest
```

The deployment named in `AZURE_OPENAI_API_DEPLOYMENT_NAME` answers the requests. After `microsoft:`, give the model that deployment runs: the server uses the name to look up the vector dimension and to detect a model change.

## Vector Dimension

Every vector in the database has the same length, the vector dimension. By default the server uses the model's own dimension. It knows the dimension of common models, such as 1536 for `text-embedding-3-small`. For any other model, it sends one test embedding at startup, within `embeddings.initTimeoutMs`, and stores the result in the database so later starts skip the test.

To fix the dimension instead, set `embeddings.vectorDimension` in the config file or `DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION` in the environment. The value must be a positive integer. Shorter vectors are padded with zeros to that length. A model whose vectors are longer fails to start, except Gemini, whose vectors are shortened.

## Changing the Model

Vectors from different models, or of different dimensions, cannot be compared. The database records the model and dimension in use, and the server checks them at every start.

When they changed, a server started in a terminal (the default command or `mcp`) asks for confirmation:

```
⚠️  Embedding model change detected:
   Previous: text-embedding-3-small (1536 dimensions)
   Current:  text-embedding-3-large (3072 dimensions)

   All existing embedding vectors will be invalidated.
   Libraries must be re-scraped to restore vector search.
   Full-text search will continue working for all existing documents.

   Proceed with model change? (y/N)
```

Answering anything but `y` stops startup and changes nothing.

A server without a terminal, as under an MCP client or in a container, fails to start with an error that describes the change, and so does every other command, such as `worker`, `web` or `scrape`. Start the server (`docs-mcp-server` or `docs-mcp-server mcp`) once in a terminal with the new model to confirm the change. For Docker, run the image's default command once with `-it` on the same volumes.

After you confirm:

- the server deletes all stored vectors and recreates the vector index with the new dimension;
- full-text search keeps working for all documents;
- vector search returns results for a library again once you scrape it again, for example with `scrape --replace`. A `refresh` skips unchanged pages and leaves them without vectors.
