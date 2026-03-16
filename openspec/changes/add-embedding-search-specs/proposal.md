# Change: Add embedding and search capability specifications

## Why
The project has extensive implementation of embedding model resolution, vector generation, hybrid search, and search result reassembly, but no OpenSpec coverage for any of it. The only existing spec is `markdown-features`. These capabilities are core to the product and need formal specifications to guide future development, prevent regressions, and document expected behavior.

## What Changes
- Add `embedding-resolution` spec: how the system selects and initializes embedding providers from user configuration
- Add `embedding-generation` spec: how chunks are prepared, embedded, batched, and stored with error recovery
- Add `hybrid-search` spec: how search queries execute in hybrid (vector + FTS) and FTS-only modes with RRF ranking
- Add `search-result-reassembly` spec: how raw search results are expanded with context, clustered, and assembled into coherent responses

All specs document **existing behavior** reverse-engineered from the implementation. No behavioral code changes are proposed.

## Impact
- Affected specs: `embedding-resolution` (new), `embedding-generation` (new), `hybrid-search` (new), `search-result-reassembly` (new)
- Affected code: Comment-only fix in `src/store/DocumentStore.ts` (stale JSDoc corrected)
- Affected docs: Several existing docs updated to match current implementation
