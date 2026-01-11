# Tasks: Markdown Frontmatter Processing

- [ ] Install `gray-matter` dependency. <!-- id: 0 -->
- [ ] Update `MarkdownMetadataExtractorMiddleware` to parse YAML frontmatter for title extraction using `gray-matter`. <!-- id: 1 -->
- [ ] Ensure `MarkdownMetadataExtractorMiddleware` handles malformed YAML gracefully (logs warning, falls back). <!-- id: 1b -->
- [ ] Add unit tests for `MarkdownMetadataExtractorMiddleware` frontmatter support (valid and invalid cases). <!-- id: 2 -->
- [ ] Update `SectionContentType` type definition to include `"frontmatter"`. <!-- id: 3 -->
- [ ] Update `SemanticMarkdownSplitter` to extract frontmatter into a separate chunk. <!-- id: 4 -->
- [ ] Add unit tests for `SemanticMarkdownSplitter` frontmatter chunking. <!-- id: 5 -->
