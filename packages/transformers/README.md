# @arabold/docs-mcp-server-transformers

Optional companion package for [`@arabold/docs-mcp-server`](https://www.npmjs.com/package/@arabold/docs-mcp-server).

It bundles [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers) (Transformers.js + ONNX runtime) so the main server can generate embeddings **locally and offline**, without any API keys or external services.

Because this dependency is large (the ONNX runtime ships native binaries for all platforms), it is kept out of the default server install. Install this companion only if you want to use the `transformers:` embedding provider:

```bash
npm install -g @arabold/docs-mcp-server @arabold/docs-mcp-server-transformers
```

Then select a local model:

```bash
DOCS_MCP_EMBEDDING_MODEL="transformers:BAAI/bge-small-en-v1.5" docs-mcp-server
```

The official Docker image already includes this package, so no extra step is needed there.

> Install both packages into the **same** `node_modules` tree (e.g. both global, or both local in the same project). The server resolves this companion as a sibling package.
