# Spec Delta: Frontmatter Extraction

## MODIFIED Requirements

### Requirement: Markdown Metadata Extraction
The system MUST extract metadata from Markdown documents to enrich the document context.

#### Scenario: Extract title from YAML frontmatter
When a Markdown document contains YAML frontmatter with a `title` field, the system MUST use this value as the document title, overriding any subsequent headings.

#### Scenario: Fallback to H1
When a Markdown document does not contain YAML frontmatter or the frontmatter lacks a `title` field, the system MUST continue to use the first H1 heading as the document title.

#### Scenario: Malformed Frontmatter
When the frontmatter YAML is invalid (syntax error), the system MUST gracefully recover by ignoring the frontmatter for metadata purposes and falling back to H1 extraction. It MUST NOT throw an exception that halts processing.

### Requirement: Semantic Markdown Splitting
The system MUST split Markdown documents into semantic chunks, preserving structure and content types.

#### Scenario: Frontmatter Chunk
When a Markdown document contains YAML frontmatter, the system MUST create a distinct chunk of type `frontmatter` containing the raw frontmatter content. This chunk MUST be the first chunk in the sequence.

#### Scenario: Frontmatter Exclusion from Body
The system MUST NOT include the frontmatter content in subsequent chunks (e.g., as part of the first text section).
