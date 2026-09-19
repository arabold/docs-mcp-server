# Production reranking deployment

This Compose stack runs one search-owning worker and three credential-free
proxies: the web UI, read-only MCP, and administrative MCP. The repository-wide
reranker default stays disabled. The production Compose file enables reranking
only in the worker environment.

## Build and pin the image

Build the repository Dockerfile with Node.js 22, push the source-specific tag,
and record its registry manifest digest before changing the stack:

```bash
docker build -t registry.example/docs-mcp-server:issue-9-<git-sha> .
docker push registry.example/docs-mcp-server:issue-9-<git-sha>
docker buildx imagetools inspect \
  registry.example/docs-mcp-server:issue-9-<git-sha>
```

Set `DOCS_MCP_IMAGE` only to the recorded `name@sha256:...` digest. Do not deploy
the mutable source-specific tag. The operator validates the full registry
manifest digest; Compose verifies that an explicit image reference is present.

## Place the Voyage secret

Use `worker.env.example` as a reference. Update the existing untracked
`deploy/remote-grounded/.env.worker` in place so its deployed embedding model,
dimension, base URL, and credential remain intact while adding the Voyage
credential. Only when `.env.worker` is absent, create it without overwriting an
existing file:

```bash
cd deploy/remote-grounded
if [ ! -e .env.worker ]; then
  install -m 600 worker.env.example .env.worker
else
  chmod 600 .env.worker
fi
```

For the ONEC production index, the model remains `openai:baai/bge-m3` at 1024
dimensions:

```dotenv
DOCS_MCP_EMBEDDING_MODEL=openai:baai/bge-m3
DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION=1024
OPENAI_API_BASE=<existing provider URL>
OPENAI_API_KEY=<existing embedding credential>
VOYAGE_API_KEY=<Voyage credential>
```

Keep these variables only in the deployment secret store consumed as
`.env.worker`; keep that file untracked. Merge the Voyage variable into the
existing file instead of replacing it. Before deployment, validate the Compose
configuration without rendering its credential-bearing environment. Verify the
model and dimension through an allowlisted status check that emits only their
names and safe non-secret values. The shell-wide Compose environment, shared
config volume, web service, and both MCP services stay credential-free. An
enabled local search process exits at startup and reports `VOYAGE_API_KEY` when
the variable is absent.

The production Compose file supplies
`DOCS_MCP_SEARCH_RERANKER_ENABLED=true` and the selected
`DOCS_MCP_SEARCH_RERANKER_CANDIDATE_LIMIT=30` only to `worker`. The shared
application configuration remains disabled by default, so credential-free
proxy processes run only as remote clients of the worker.

## Start and verify

```bash
export DOCS_MCP_IMAGE='registry.example/docs-mcp-server@sha256:<digest>'
docker compose -f deploy/remote-grounded/docker-compose.yml config --quiet
docker compose -f deploy/remote-grounded/docker-compose.yml up -d
docker compose -f deploy/remote-grounded/docker-compose.yml ps
```

Verify the worker healthcheck, the web health response, MCP initialization on
both MCP endpoints, and one normal search through each MCP endpoint. Both
searches execute on the worker and therefore use the worker-owned Reranker.

Safe operational evidence consists only of the image digest, process health,
MCP initialization status, candidate count, elapsed time, outcome, returned
count, usage-token count, and sanitized fallback category. Configure evidence
collection as an allowlist of these fields; credentials, Authorization headers,
Search Query text, Search Candidate content, provider response bodies, and raw
provider errors remain excluded.

## Preserve SQLite data

The worker reuses `grounded-docs-data:/data`. Reranking operates outside the
database schema and reuses the existing index unchanged. Before an image
change, record the SQLite `user_version`, schema, and row counts from a safe
backup or maintenance window. After startup and search, verify that they are
unchanged.

Keep exactly one worker attached to the data volume. Preserve the previous
immutable image reference and Compose configuration until verification is
complete.

## Roll back

1. Set `DOCS_MCP_IMAGE` back to the previous immutable registry manifest digest.
2. Recreate the four services with Docker Compose.
3. Reuse the existing `grounded-docs-data` volume unchanged.
4. Verify worker health, both MCP initializations, and a baseline search.
5. To disable reranking while retaining the new image, remove the worker-only
   `DOCS_MCP_SEARCH_RERANKER_ENABLED=true` override and recreate the worker.
