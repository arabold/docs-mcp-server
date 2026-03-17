# Process Markdown Frontmatter

## Summary
Add support for parsing YAML frontmatter in Markdown documents to extract metadata (like titles) and preserve it as a distinct chunk type in the document splitting process.

## Problem
Currently, Markdown frontmatter is either ignored or treated as plain text/thematic breaks by the markdown processing pipeline. This means valuable metadata like titles, dates, or tags defined in frontmatter is lost or malformed.

## Solution
1.  **Metadata Extraction**: Update `MarkdownMetadataExtractorMiddleware` to parse YAML frontmatter and extract the `title` property if available, using it as the document title.
2.  **Chunking**: Update `SemanticMarkdownSplitter` to identify frontmatter blocks and create a new chunk type `frontmatter`. This ensures the raw metadata is preserved and indexed separately from the main content.
