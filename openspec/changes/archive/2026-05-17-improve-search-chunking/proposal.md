# Improve Search Chunking

## Summary
Refine the search result reassembly logic to split chunks from the same document if they are too far apart, improving the relevance and conciseness of search results.

## Motivation
Currently, all search hits from the same URL are merged into a single result, regardless of their distance in the document. This can lead to excessively long search results containing unrelated sections (e.g., matching a header at the top and a footer at the bottom). By splitting these into separate results based on a configurable distance, we provide more targeted context to the LLM.

## Overview
- Introduce a `maxChunkDistance` configuration option.
- Update `DocumentRetrieverService` to cluster chunks by `sort_order` within each URL group.
- Split clusters into separate search results.
- Re-sort the final list of results by score to ensure the most relevant clusters appear first.
