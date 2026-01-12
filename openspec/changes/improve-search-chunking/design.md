# Design: Smart Chunking Logic

## Problem
The current `DocumentRetrieverService` groups all chunks by URL and merges them.
`[Chunk A (order 1), Chunk B (order 100)]` from `page.html` becomes one result: `Chunk A \n ... \n Chunk B`.
If these chunks are semantically distinct and far apart, merging them dilutes the context window with potentially irrelevant content between them (if filled) or presents a disjointed context (if concatenated directly).

## Solution
We introduce a clustering step *before* assembly.

### Algorithm
1.  **Group by URL**: (Existing logic) `Map<URL, Chunk[]>`.
2.  **Sort**: For each URL group, sort chunks by `sort_order` ASC.
3.  **Cluster**:
    - Iterate through sorted chunks.
    - If `chunk[i].sort_order - chunk[i-1].sort_order <= maxChunkDistance`:
        - Add `chunk[i]` to current cluster.
    - Else:
        - Finalize current cluster.
        - Start new cluster with `chunk[i]`.
4.  **Assemble**: Process each cluster as if it were a distinct search result.
    - Apply `ContentAssemblyStrategy` (Hierarchical or Markdown) to the cluster.
    - Calculate score (max score of chunks in cluster).
5.  **Flatten & Sort**:
    - Collect all assembled results from all clusters.
    - Sort globally by `score` DESC.

### Configuration
`assembly.maxChunkDistance` (int, default: 3).
- `sort_order` is typically incremented by 1 for adjacent chunks.
- A distance of 1 means they are adjacent.
- A distance of 3 allows for a small gap (e.g., 1 missing chunk) to still be bridged.

### Edge Cases
- **Structured Content**: For code, `HierarchicalAssemblyStrategy` might already do complex tree walking. The clustering happens *on the initial search hits*. The assembly strategy then expands context around those hits. If we split hits into two clusters, the assembly strategy runs independently on each. This is desired: we get two distinct snippets of code instead of one large file with a gap.
