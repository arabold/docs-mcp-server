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
- `js-yaml` (or similar) will be needed to parse the YAML frontmatter safely.
- `gray-matter` is a common choice but adding a heavy dependency might be overkill if we just need simple parsing. However, `js-yaml` is robust.
- Since we are in a Node environment, we can likely use a lightweight parser or regex if the requirements are simple, but `js-yaml` is safer.
- **Decision**: Use `yaml` (npm package) or just regex for extraction if we only need the raw block for the chunk.
- **Refinement**:
  - For `MarkdownMetadataExtractorMiddleware`: We need to *parse* it to get the title.
  - For `SemanticMarkdownSplitter`: We just need to *extract* the raw text block to create a chunk.

## Trade-offs
- **Splitting Strategy**: Separating frontmatter before HTML conversion avoids `remark` messing it up (e.g. turning it into a `<hr>`).
- **Chunk Size**: Frontmatter is usually small, but if it's huge, we might need to split it? Unlikely to exceed chunk limits in normal docs. We will treat it as a single chunk for now.
