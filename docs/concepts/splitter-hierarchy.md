# Splitter Hierarchy

Every chunk records where it sits in its page. Search uses that position to put a matched chunk back into context (see [Search Result Reassembly](search-result-reassembly.md)), and the embedding of each chunk includes it (see [Data Storage](data-storage.md#writing-a-page)). This document describes what the position means for each kind of content, how merging changes it, and how the store turns it into relationships between chunks.

## Level and path

A chunk (`Chunk` in [src/splitter/types.ts](../../src/splitter/types.ts)) carries a `section` with two values:

- `path` lists the names of the structures that enclose the chunk, outermost first. The empty path is the page root.
- `level` is the depth of the structure the chunk belongs to. `0` is the root.

It also carries `types`, the kinds of content it holds, such as `heading`, `text`, `code` or `structural`. The store keeps all three in the chunk's metadata.

Several chunks can share a path. A section's heading, paragraphs and code blocks all carry the section's path, and so do the pieces of a block that was too large for one chunk. Relationships between chunks come from `path` alone; `level` matters only while chunks are merged.

## What each splitter records

Each splitter fills in the position from the structure it understands.

| Splitter | Used for | Path | Level |
|---|---|---|---|
| `SemanticMarkdownSplitter` | Markdown, HTML, converted documents | Titles of the enclosing headings | The heading's level, 1 to 6 |
| `TreesitterSourceCodeSplitter` | Source code | Names of the enclosing declarations | Path length |
| `JsonDocumentSplitter` | JSON | `root`, then property names and `[index]` positions | Path length |
| `TextDocumentSplitter` | Plain text | Always empty | Always 0 |

In Markdown, text before the first heading and the frontmatter sit at the root. Because the level comes from the heading markup rather than from nesting, it can differ from the path length:

```text
Intro paragraph   -> level 0, path []
# Guide           -> level 1, path ["Guide"]
### Setup         -> level 3, path ["Guide", "Setup"]
```

In source code, code outside any declaration sits at the root. The first chunk of a class, interface, enum or namespace is typed `structural`; the rest of its lines carry the same path without that type. Source code in a language without a parser, or that fails to parse, stays at the root. [Source Code Splitter](source-code-splitter.md) covers how boundaries are found.

In JSON, a value nested deeper than `splitter.json.maxNestingDepth` stays one chunk at its own path. A file that would produce more than `splitter.json.maxChunks` chunks is split as plain text instead.

## Merging

Markdown, HTML, converted documents and plain text pass through `GreedySplitter` ([src/splitter/GreedySplitter.ts](../../src/splitter/GreedySplitter.ts)), which joins neighbouring chunks until they reach a useful size for embedding. Source code and JSON skip it. Their pipelines (`SourceCodePipeline`, `JsonPipeline`) keep one chunk per structure, so that search can rebuild the exact structure around a match.

A merged chunk needs one position. It takes the lower, more general level of the two. Its path depends on how the two paths relate:

- Equal paths stay as they are.
- When one path contains the other, the merged chunk takes the deeper path.
- Otherwise it takes their common prefix, which is the root when they share nothing.

Merging a heading with the content of its subsection therefore yields a chunk whose level is lower than its path length. This is the second way level and path length differ.

Merging stays within major sections. Once the current chunk has reached `splitter.minChunkSize`, a level 1 or level 2 chunk from a different section starts a new chunk. The size settings are listed under Splitter in [Configuration](../setup/configuration.md).

## Relationships

The store derives relationships from paths, always within one page and in document order (`sort_order`). The queries are `findParentChunk`, `findPrecedingSiblingChunks`, `findSubsequentSiblingChunks` and `findChildChunks` in [src/store/DocumentStore.ts](../../src/store/DocumentStore.ts).

- The parent is the nearest earlier chunk whose path is this chunk's path without its last element. A chunk at the root or with a one-element path has no parent.
- Siblings are chunks with the same path, before or after this one. In Markdown they are the other chunks of the same section.
- Children are later chunks whose path extends this chunk's path by one element.

Since all chunks of a section share its path, the parent is the enclosing section's chunk closest to this one, which is not necessarily that section's heading.
