-- Migration: Drop documents_vec so the app can recreate it at runtime with configurable embedding dimension.
-- Supports different embedding providers (e.g. 1536 vs 3584 dimensions). The table is recreated in
-- DocumentStore.ensureVectorTable() using config.embeddings.vectorDimension (env: DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION).
DROP TABLE IF EXISTS documents_vec;
