# Design: Markdown Frontmatter Processing

## Architecture

### 1. Metadata Extraction (`MarkdownMetadataExtractorMiddleware`)
- **Current**: Extracts title from the first `# Heading`.
- **New**:
  - Check for YAML frontmatter at the beginning of the content (lines between `---`).
  - Parse the YAML content.
  - If a `title` field exists, use it as the `context.title`.
  - Fallback to existing H1 extraction if no frontmatter title is found.
  - Store the raw frontmatter in the context if needed for downstream (though the splitter re-reads the content).

### 2. Document Splitting (`SemanticMarkdownSplitter`)
- **Current**: Converts Markdown to HTML using `remark`, then splits based on DOM elements.
- **New**:
  - **Preprocessing**: Detect and extract frontmatter *before* the `markdownToHtml` conversion.
  - **Splitting**:
    - Create a dedicated `Chunk` for the frontmatter.
    - Set its type to `frontmatter` (new `SectionContentType`).
    - The rest of the markdown (body) is passed to the existing `markdownToHtml` -> `splitIntoSections` pipeline.
    - The frontmatter chunk is prepended to the list of chunks.

## Data Structures

### `SectionContentType`
Update `src/splitter/types.ts`:
```typescript
export type SectionContentType = "text" | "code" | "table" | "heading" | "structural" | "frontmatter";
```

### `Chunk`
No structural changes to `Chunk`, but `types` array will now can contain `"frontmatter"`.

## Dependencies
- **`gray-matter`**: Adopt this library for robust frontmatter parsing. It handles edge cases (like `---` in code blocks) better than regex and is the industry standard.
- It uses `js-yaml` internally (or similar) but abstracts the splitting logic safely.

## Data Structures

### `SectionContentType`
Update `src/splitter/types.ts`:
```typescript
export type SectionContentType = "text" | "code" | "table" | "heading" | "structural" | "frontmatter";
```

### `Chunk`
No structural changes to `Chunk`, but:
- `types` array will now can contain `"frontmatter"`.
- **Optimization**: We should consider storing the parsed frontmatter object in `chunk.metadata` (if `Chunk` interface supports it or if we extend it) to avoid downstream re-parsing. For now, we stick to the raw content in the chunk body, but ensure the extractor attaches the title to the context.

## Error Handling
- **Malformed YAML**: Parsing MUST NOT crash the application.
  - **Middleware**: If parsing fails, log a warning and fallback to standard H1 title extraction.
  - **Splitter**: If parsing fails, treat the content as plain text (do not create a frontmatter chunk, or create a text chunk).

## Trade-offs
- **Splitting Strategy**: Separating frontmatter before HTML conversion avoids `remark` messing it up (e.g. turning it into a `<hr>`).
- **Chunk Size**: Frontmatter is usually small, but if it's huge, we might need to split it? Unlikely to exceed chunk limits in normal docs. We will treat it as a single chunk for now.
