# search-result-reassembly Specification

## Purpose
Defines how search result chunks are grouped by URL, clustered by proximity, routed to content-type-specific assembly strategies, context-expanded, joined, and scored.

## Requirements

### Requirement: URL Grouping
The system SHALL group search result chunks by their source document URL before further processing. All matching chunks from the same URL SHALL be processed together, ensuring that same-document context is preserved during assembly.

**Code reference:** `src/store/DocumentRetrieverService.ts:44, 75-92`

#### Scenario: Multiple chunks from same URL
- **WHEN** a search returns 5 chunks from `https://react.dev/learn/setup` and 3 chunks from `https://react.dev/learn/hooks`
- **THEN** the system SHALL create two URL groups, one with 5 chunks and one with 3 chunks
- **AND** each group SHALL be processed independently

#### Scenario: Single chunk per URL
- **WHEN** a search returns 3 chunks, each from a different URL
- **THEN** the system SHALL create 3 separate URL groups with 1 chunk each

### Requirement: Distance-Based Clustering
Within each URL group, the system SHALL split chunks into clusters based on their `sort_order` proximity. When the gap in `sort_order` between two consecutive chunks (sorted ascending) exceeds `assembly.maxChunkDistance` (default 3), the system SHALL start a new cluster. Each cluster SHALL produce a separate search result.

Chunks within a URL group SHALL be sorted by `sort_order` ascending, with `id` string comparison as a tiebreaker for deterministic ordering. The `maxChunkDistance` value SHALL be floored at 0.

**Code reference:** `src/store/DocumentRetrieverService.ts:144-183`

#### Scenario: Chunks within distance threshold
- **WHEN** chunks have sort_order values `[0, 1, 2, 3]`
- **AND** `maxChunkDistance` is 3
- **THEN** the system SHALL produce 1 cluster containing all 4 chunks

#### Scenario: Chunks exceeding distance threshold
- **WHEN** chunks have sort_order values `[0, 1, 2, 10, 11, 12]`
- **AND** `maxChunkDistance` is 3
- **THEN** the system SHALL produce 2 clusters: `[0, 1, 2]` and `[10, 11, 12]`
- **AND** each cluster SHALL become a separate search result

#### Scenario: Single chunk in URL group
- **WHEN** a URL group contains only 1 chunk
- **THEN** the system SHALL produce 1 cluster containing that single chunk

### Requirement: Content-Type Strategy Routing
The system SHALL select a content assembly strategy based on the processed MIME type of the search result chunks. A factory SHALL evaluate strategies in priority order, returning the first strategy that can handle the MIME type:

1. **HierarchicalAssemblyStrategy** (checked first): Handles source code (all programming languages, shell scripts, Dockerfiles, Makefiles, SQL, etc.) and JSON content. YAML, TOML, and XML are also routed here because the source code detection path (`isSourceCode()` via `extractLanguageFromMimeType()`) classifies them as programming/config languages.
2. **MarkdownAssemblyStrategy** (fallback): Handles markdown, HTML, plain text, and any unknown/null MIME type.

When the MIME type is null or undefined, the system SHALL default to the MarkdownAssemblyStrategy.

**Code reference:** `src/store/assembly/ContentAssemblyStrategyFactory.ts:13-36`

#### Scenario: Source code uses hierarchical strategy
- **WHEN** a search result has MIME type `text/x-typescript`
- **THEN** the system SHALL route to the HierarchicalAssemblyStrategy

#### Scenario: JSON uses hierarchical strategy
- **WHEN** a search result has MIME type `application/json`
- **THEN** the system SHALL route to the HierarchicalAssemblyStrategy

#### Scenario: Markdown uses markdown strategy
- **WHEN** a search result has MIME type `text/markdown`
- **THEN** the system SHALL route to the MarkdownAssemblyStrategy

#### Scenario: Unknown MIME type falls back to markdown strategy
- **WHEN** a search result has a null or unrecognized MIME type
- **THEN** the system SHALL route to the MarkdownAssemblyStrategy

### Requirement: Markdown Context Expansion
For markdown, HTML, and text content, the MarkdownAssemblyStrategy SHALL expand each matched chunk's context by retrieving related chunks from the database using hierarchical path relationships:

1. **Parent chunk** (limit 1): The chunk whose path is the current chunk's path with the last element removed, and whose `sort_order` is less than the current chunk's.
2. **Preceding siblings** (configurable limit, default 1 via `assembly.precedingSiblingsLimit`): Chunks with the same path and lower `sort_order`, returned in document order.
3. **Child chunks** (configurable limit, default 3 via `assembly.childLimit`): Chunks whose path extends the current chunk's path by one element, with higher `sort_order`.
4. **Subsequent siblings** (configurable limit, default 2 via `assembly.subsequentSiblingsLimit`): Chunks with the same path and higher `sort_order`.

All collected chunk IDs SHALL be deduplicated and fetched in a single batch query, ordered by `sort_order`.

**Code reference:** `src/store/assembly/strategies/MarkdownAssemblyStrategy.ts:54-148`

#### Scenario: Full context expansion
- **WHEN** a matched chunk has path `["Guide", "Installation", "Steps"]` at level 3
- **THEN** the system SHALL retrieve: 1 parent (path `["Guide", "Installation"]`), 1 preceding sibling, up to 3 children (path length 4), and 2 subsequent siblings
- **AND** all chunks SHALL be returned in `sort_order` order

#### Scenario: Chunk without parent
- **WHEN** a matched chunk has path `["Introduction"]` at level 1 (root-level path)
- **THEN** the parent lookup SHALL return no results
- **AND** the system SHALL still return the chunk with available siblings and children

#### Scenario: Deduplicated expansion across multiple matches
- **WHEN** two matched chunks share context (e.g., same parent)
- **THEN** the system SHALL deduplicate chunk IDs before fetching
- **AND** each chunk SHALL appear only once in the assembled result

### Requirement: Hierarchical Context Expansion
For source code and JSON content, the HierarchicalAssemblyStrategy SHALL reconstruct complete structural subtrees rather than using fixed-limit context expansion:

**Single match in a document:**
1. Find the nearest **structural ancestor**: the innermost scope around the match, the match's own path included, whose opening chunk has `"structural"` in its `metadata.types` array. Scopes open as described in step 4, so a field or statement between a declaration and the match SHALL NOT hide the declaration.
2. If no structural ancestor is found in source code, attempt **top-level promotion**: use the first element of the chunk's path to find a container chunk. For JSON, the system SHALL NOT promote to the top level, which is the whole document; it SHALL use the object or array the match opens (a key whose value is an object or array, including an empty one, recognized by the chunk holding only its opening bracket at the key's path), otherwise the object or array that contains the match.
3. Find the **full subtree** of the promoted ancestor: the ancestor, the chunks right before it that carry the same path (such as a JSON key and its bracket), and the chunks right after it whose path starts with the ancestor's path, up to the first chunk outside it. The subtree SHALL include the ancestor's closing chunk, which carries the ancestor's own path.
4. For each scope that encloses the promoted ancestor (limited by `assembly.maxParentChainDepth`, default 10), add its **opening and closing chunks** (the chunks with its own path before its first and after its last nested member) but none of its other members. A scope SHALL open at the first chunk of the run of chunks inside its path that precedes the ancestor, so statements or members between the scope's declaration and the ancestor are not included. A scope with no chunk at its own path adds nothing.
5. A match with an empty path (code at the page root) SHALL be returned on its own.

**Multiple matches in the same document:**
1. Include each match's **full subtree** (as in single-match step 3) and the **opening and closing chunks** of every scope that encloses it (as in single-match step 4), but none of those scopes' other members.
2. Find the **common ancestor path** (longest common prefix of the matches' paths). Within the scope at that path, include the chunks at the path itself, such as fields or statements.
3. When the matches share no path, step 2 adds nothing; each match still comes back inside its own scopes' opening and closing chunks.

**Gap-aware ancestor search**: When a scope has no chunk at its own path (merged or absent), the strategy SHALL skip it and progressively shorten the path prefix to find the nearest available ancestor.

**Fallback**: If any error occurs while loading the page's chunks, the strategy SHALL fall back to returning the initial chunks plus immediate parent and up to 3 children each.

**Code reference:** `src/store/assembly/strategies/HierarchicalAssemblyStrategy.ts:47-615`

#### Scenario: Single match in code file
- **WHEN** a search matches a single chunk inside a function body
- **THEN** the system SHALL find the function's structural ancestor
- **AND** reconstruct the complete function including its signature and body

#### Scenario: Match inside a class method
- **WHEN** a search matches a single method of a class
- **THEN** the system SHALL return the class's opening line, all its methods and its closing brace
- **AND** SHALL NOT include code that follows the class

#### Scenario: Class inside a namespace
- **WHEN** a search matches a method of a class declared inside a namespace
- **THEN** the system SHALL return the whole class and the namespace's opening and closing lines
- **AND** SHALL NOT include the namespace's other members

#### Scenario: Match on a class declaration inside a namespace
- **WHEN** a search matches the declaration line of a class declared inside a namespace
- **THEN** the system SHALL return the whole class and the namespace's opening and closing lines
- **AND** SHALL NOT include the namespace's other members

#### Scenario: Field between a class's methods
- **WHEN** a class declares a method, then a field, then a second method, and a search matches the second method
- **THEN** the system SHALL return the whole class
- **AND** SHALL NOT include members of the namespace around the class

#### Scenario: Statement between a scope's declaration and the match
- **WHEN** a namespace declares a class, then a statement, then a second class, and a search matches a method of the second class
- **THEN** the system SHALL return the namespace's declaration line, the whole second class and the namespace's closing brace
- **AND** SHALL NOT include the statement or the first class

#### Scenario: Match in code at the page root
- **WHEN** a search matches a chunk with an empty path, such as a top-level statement
- **THEN** the system SHALL return that chunk alone

#### Scenario: Match on a JSON value
- **WHEN** a search matches `"timeout": 30` inside the `server` object of a JSON document
- **THEN** the system SHALL return the `server` key and the whole `server` object, inside the document's outer braces
- **AND** SHALL NOT include the document's other properties

#### Scenario: Match on a JSON key that opens an object
- **WHEN** a search matches the `"server":` key whose value is an object
- **THEN** the system SHALL return that key and its whole object
- **AND** SHALL NOT include the document's other properties

#### Scenario: Match on a JSON key whose value is empty
- **WHEN** a search matches a key whose value is `{}` or `[]`
- **THEN** the system SHALL return that key and its empty object or array
- **AND** SHALL NOT include the document's other properties

#### Scenario: Multiple matches in same code file
- **WHEN** a search matches two chunks in different functions within the same class
- **THEN** the system SHALL return both functions inside the class's opening and closing lines
- **AND** SHALL NOT include the class's other methods

#### Scenario: Multiple matches in a class inside a namespace
- **WHEN** a search matches two methods of a class declared inside a namespace
- **THEN** the system SHALL also return the namespace's opening and closing lines
- **AND** SHALL NOT include the namespace's other members

#### Scenario: Multiple matches without a common path
- **WHEN** a search matches a method of one top-level class and a method of another
- **THEN** the system SHALL return each method inside its own class's opening and closing lines
- **AND** SHALL NOT include the code between the two classes

#### Scenario: Missing intermediate parent
- **WHEN** the chunk's direct parent is missing from the database (merged during splitting)
- **THEN** the system SHALL use gap-aware ancestor search to find the nearest available ancestor by progressively shortening the path

#### Scenario: Hierarchical traversal error fallback
- **WHEN** an error occurs while loading the page's chunks for ancestor detection or subtree reconstruction
- **THEN** the system SHALL fall back to returning the matched chunks with immediate parent and up to 3 children each

### Requirement: Content Joining
The system SHALL join assembled chunks using content-type-appropriate separators:

- **MarkdownAssemblyStrategy**: Chunks SHALL be joined with double newlines (`\n\n`) to preserve prose readability and markdown formatting.
- **HierarchicalAssemblyStrategy**: Chunks SHALL be joined with no separator (empty string), relying on the splitter's concatenation guarantees that chunks reconstruct seamlessly.

**Code reference:** `src/store/assembly/strategies/MarkdownAssemblyStrategy.ts:86-88`, `src/store/assembly/strategies/HierarchicalAssemblyStrategy.ts:177-189`

#### Scenario: Markdown content joining
- **WHEN** assembling 3 markdown chunks with content `"# Title"`, `"Paragraph 1"`, `"Paragraph 2"`
- **THEN** the assembled content SHALL be `"# Title\n\nParagraph 1\n\nParagraph 2"`

#### Scenario: Source code content joining
- **WHEN** assembling 3 code chunks representing parts of a function
- **THEN** the assembled content SHALL be joined with no separator
- **AND** the result SHALL reconstruct the original source code structure

### Requirement: Score Preservation
Each assembled search result SHALL retain the highest relevance score from all its constituent chunks. When multiple chunks are assembled into a single result (after URL grouping, clustering, and context expansion), the maximum score among the original search-matched chunks SHALL be used as the result's score.

Final results across all URLs and clusters SHALL be sorted in descending order by score, so the most relevant assembled result appears first.

**Code reference:** `src/store/DocumentRetrieverService.ts:53-61, 67-69, 113`

#### Scenario: Multiple chunks with different scores
- **WHEN** a URL group contains chunks with scores 0.9, 0.7, and 0.5
- **THEN** the assembled result SHALL have a score of 0.9

#### Scenario: Cross-URL result ordering
- **WHEN** URL A produces a result with max score 0.8 and URL B produces a result with max score 0.95
- **THEN** URL B's result SHALL appear before URL A's result in the final output

#### Scenario: Cluster produces separate results
- **WHEN** chunks from the same URL are split into two clusters (scores [0.9, 0.7] and [0.6])
- **THEN** two separate results SHALL be produced with scores 0.9 and 0.6
- **AND** they SHALL be ordered independently among all results
