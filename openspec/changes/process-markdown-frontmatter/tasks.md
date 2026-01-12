# Tasks: Markdown Frontmatter Processing

- [x] Install `gray-matter` dependency. <!-- id: 0 -->
- [x] Update `MarkdownMetadataExtractorMiddleware` to parse YAML frontmatter for title extraction using `gray-matter`. <!-- id: 1 -->
- [x] Ensure `MarkdownMetadataExtractorMiddleware` handles malformed YAML gracefully (logs warning, falls back). <!-- id: 1b -->
- [x] Add unit tests for `MarkdownMetadataExtractorMiddleware` frontmatter support (valid and invalid cases). <!-- id: 2 -->
- [x] Update `SectionContentType` type definition to include `"frontmatter"`. <!-- id: 3 -->
- [x] Update `SemanticMarkdownSplitter` to extract frontmatter into a separate chunk. <!-- id: 4 -->
- [x] Add unit tests for `SemanticMarkdownSplitter` frontmatter chunking. <!-- id: 5 -->
