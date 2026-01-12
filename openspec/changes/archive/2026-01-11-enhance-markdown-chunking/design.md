# Design: Enhanced Semantic Markdown Chunking

## Problem
The current `SemanticMarkdownSplitter` treats most non-heading elements as generic text. This leads to suboptimal chunking for structured content like lists, blockquotes, and media. Additionally, horizontal rules (`<hr>`) are ignored or treated as text separators, whereas they should act as explicit chunk boundaries.

## Solution

### 1. New Content Types
We will extend `SectionContentType` to include:
- `list`: For `<ul>` and `<ol>` elements.
- `blockquote`: For `<blockquote>` elements.
- `media`: For `<img>` elements.

### 2. Horizontal Rules (`<hr>`)
- In `splitIntoSections`, `<hr>` elements are detected and skipped (no `DocumentSection` is created for them).
- Skipping `<hr>` acts as a hard split point between the sections created for the elements before and after it.
- The `<hr>` itself will not be included in any section content, but its presence ensures that content before and after it are never merged into the same chunk.

### 3. List Handling
- `<ul>` and `<ol>` elements will be captured as `list` content type.
- A new `ListContentSplitter` will be implemented.
- It will attempt to keep the list intact if it fits in `preferredChunkSize`.
- If larger, it will split at `<li>` boundaries (preserving list structure/indentation if possible, or at least ensuring items are not split mid-text unless an individual item is huge).

### 4. Blockquote Handling
- `<blockquote>` elements will be captured as `blockquote` content type.
- They will be split using `TextContentSplitter` (or a specialized one) but preserving the `>` prefix on split chunks if possible is desirable (though standard `turndown` might just handle it as text with `>` markers). Keeping it as a separate type ensures we don't merge it with surrounding paragraphs.

### 5. Media Handling
- `<img>` elements will be captured as `media` content type.
- This ensures images (and their alt text/src) are kept as distinct chunks or at least recognized as such.

## Architecture Changes

### Reference Pattern: Code Block Handling
We will follow the existing pattern used for code blocks (`PRE`/`code` tags):
1. **Detection**: Identify the specific HTML tag in `splitIntoSections` (e.g., `BLOCKQUOTE`, `UL`, `IMG`).
2. **Extraction**: Convert the inner HTML back to Markdown using `turndown`.
3. **Section Creation**: Create a new `DocumentSection` with the specific content type.
4. **Splitting**: Delegate to a specific splitter in `splitSectionContent` (e.g., `ListContentSplitter` for lists, `TextContentSplitter` for blockquotes).

### `SemanticMarkdownSplitter.ts`
- Update `splitIntoSections` loop to handle `HR`, `UL/OL`, `BLOCKQUOTE`, `IMG`.
- Update `splitSectionContent` switch case to handle new types.

### `splitters/ListContentSplitter.ts`
- New class implementing `ContentSplitter`.
- Logic to split markdown lists.

### `types.ts`
- Update `SectionContentType`.
