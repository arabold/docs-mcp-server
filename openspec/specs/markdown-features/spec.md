# markdown-features Specification

## Purpose
Defines how Markdown documents are split into semantic chunks and how Markdown pipeline metadata and crawl links are extracted.
## Requirements
### Requirement: Support horizontal rules as chunk separators
The splitter MUST recognize horizontal rules (lines starting with `---`, `***`, or `___`) as explicit hard split points. Content before and after the rule MUST be placed in separate chunks.

#### Scenario: Horizontal Rule Splitting
Given a markdown document with two paragraphs separated by a horizontal rule
When the document is split
Then the paragraphs should be in separate chunks
And the chunk boundary should align with the horizontal rule

### Requirement: Support list chunking

The splitter MUST recognize markdown lists (`-`, `*`, `1.`) by identifying `<ul>` and `<ol>` tags. It SHALL utilize a dedicated `ListContentSplitter` to attempt keeping the list within a single chunk. If the list exceeds the maximum chunk size, it SHALL split at list item boundaries rather than in the middle of an item's text. When a single list item still exceeds `maxChunkSize` and must be split internally, the splitter MUST honor the fence-balance invariant defined in "Preserve code fence balance across chunk boundaries".

#### Scenario: List Preservation

Given a markdown document with a bullet list
When the document is split
Then the list items should preferably be kept together
And if the list is larger than the chunk size, it should split between list items

#### Scenario: Oversized item with embedded code stays balanced

- **GIVEN** a single list item containing a fenced code block that forces the item to be split internally
- **WHEN** the splitter produces chunks for that item
- **THEN** every chunk has an even count of fences
- **AND** no chunk boundary falls inside the fenced block

### Requirement: Support blockquote chunking
The splitter MUST recognize blockquotes (`>`) as distinct semantic units, following the same architectural pattern as code blocks. It SHALL identify `<blockquote>` elements during DOM traversal and capture them as a unique section type. They SHALL be chunked separately from surrounding text, preserving the `>` citation style.

#### Scenario: Blockquote Isolation
Given a markdown document with a blockquote
When the document is split
Then the blockquote should be treated as a distinct semantic unit
And the content should preserve the ">" markdown prefix

### Requirement: Support media chunking
The splitter MUST recognize images and other media elements by identifying `<img>` tags. These SHALL be treated as distinct content types to ensure they are properly indexed and not merged destructively with unrelated text.

#### Scenario: Image Handling
Given a markdown document with an image
When the document is split
Then the image should be preserved as a content unit

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

### Requirement: Markdown Link Extraction
The system SHALL extract crawl links from Markdown documents processed by the Markdown pipeline. Extracted targets SHALL preserve their raw Markdown target value so downstream scraper strategies can resolve relative URLs against the source document URL and apply existing scope, include/exclude, deduplication, max-depth, max-page, and access-policy behavior. The system SHALL ignore Markdown image targets during link extraction.

#### Scenario: Extract inline Markdown links
- **WHEN** a Markdown document contains inline links such as `[Guide](/docs/guide)` and `[API](https://example.com/api)`
- **THEN** the Markdown pipeline SHALL include `/docs/guide` and `https://example.com/api` in the extracted links

#### Scenario: Extract reference-style Markdown links
- **WHEN** a Markdown document contains a reference-style link such as `[Guide][guide-ref]` and a definition `[guide-ref]: /docs/guide "Guide title"`
- **THEN** the Markdown pipeline SHALL include `/docs/guide` in the extracted links

#### Scenario: Ignore Markdown images
- **WHEN** a Markdown document contains an image such as `![Logo](/logo.png)`
- **THEN** the Markdown pipeline SHALL NOT include `/logo.png` in the extracted links

#### Scenario: Content-negotiated Markdown continues BFS crawling
- **WHEN** a web page is fetched as `Content-Type: text/markdown` and contains a Markdown link to an in-scope page
- **THEN** the web scraper SHALL be able to enqueue and process that linked page using the existing crawl queue behavior

#### Scenario: HTML-to-Markdown conversion does not duplicate extraction
- **WHEN** a web page is fetched as `Content-Type: text/html`
- **THEN** the page SHALL continue to use the HTML pipeline's existing link extraction before conversion to Markdown
- **AND** Markdown link extraction SHALL NOT run as a second extraction pass for that HTML page

### Requirement: Preserve code fence balance across chunk boundaries

The splitter MUST NOT cut a chunk inside an open triple-backtick (` ``` `) or triple-tilde (`~~~`) fenced code block. For every chunk emitted by the splitter pipeline, the count of fence markers MUST be even, regardless of which content type (`text`, `list`, `blockquote`, `code`, or other) the chunk carries.

When honoring this invariant would force a chunk to exceed `maxChunkSize`, the splitter MUST accept the oversize chunk rather than break the fence, and MUST emit a warning via the structured logger naming the splitter that produced the oversize chunk. The fence-balance invariant takes precedence over the chunk-size invariant in this case.

The invariant applies to both backtick (` ``` `) and tilde (`~~~`) fences, and to fences with up to three leading spaces of indentation (the standard list-item indentation pattern).

#### Scenario: Code block embedded in a list item stays balanced

- **GIVEN** a markdown list whose item contains a fenced code block large enough to force the item to be split internally
- **WHEN** the splitter produces chunks
- **THEN** every chunk has an even count of triple-backtick fences
- **AND** no chunk boundary falls between an opener and its matching closer
- **AND** if a single chunk exceeds `maxChunkSize`, an oversize-chunk warning is emitted

#### Scenario: Code block embedded in a blockquote stays balanced

- **GIVEN** a blockquote (for example a VitePress info or warning container) containing a fenced code block large enough to require splitting
- **WHEN** the splitter produces chunks
- **THEN** every chunk has an even count of fences

#### Scenario: Code block in a generic wrapper element stays balanced

- **GIVEN** a fenced code block nested inside `<dl><dd>`, `<details>`, or a non-special `<div>` wrapper that falls through `SemanticMarkdownSplitter` to a `text` section
- **WHEN** the splitter produces chunks
- **THEN** every chunk has an even count of fences

#### Scenario: Tilde fences are treated identically to backtick fences

- **GIVEN** a code block delimited by `~~~` (with or without a language tag)
- **WHEN** the splitter produces chunks
- **THEN** the splitter does not cut inside the tilde fence
- **AND** the fence-balance invariant holds for tilde fences in every emitted chunk

#### Scenario: Oversize takes precedence over a broken fence

- **GIVEN** a single fenced code block whose total length exceeds `maxChunkSize`
- **WHEN** the splitter handles it via the text-splitting path
- **THEN** the splitter emits a single chunk containing the entire fenced block
- **AND** the chunk exceeds `maxChunkSize`
- **AND** a warning is logged identifying the originating splitter and the chunk size

### Requirement: Preserve fenced code-block info strings verbatim

When the splitter re-emits a fenced code block — whether it is small enough to pass through as a single chunk or large enough to be split across multiple chunks — the rewritten opener MUST carry the original CommonMark info string verbatim. The info string is everything between the opening fence delimiters (` ``` ` or `~~~`) and the following newline.

The splitter MUST NOT reduce the info string to a single language token, strip renderer-specific decorations (such as line-highlight ranges like `{15-18}`, Twoslash hints like ` twoslash `, or filename tabs like `[server.js]`), or otherwise rewrite the source-author's intent. The chunk is a faithful copy of the source.

This requirement complements the fence-balance invariant above: an info string containing non-word characters (curly braces, square brackets, whitespace) MUST NOT cause the splitter to fall back to a double-wrapped fence or any other malformed shape.

#### Scenario: VitePress / Shiki line-highlight info string survives chunking

- **GIVEN** a fenced code block opened with `` ```js{15-18} twoslash [server.js] ``
- **WHEN** the splitter emits one or more chunks for that block
- **THEN** every chunk's opening fence is `` ```js{15-18} twoslash [server.js] ``
- **AND** every chunk has balanced fences

#### Scenario: Plain language info string is preserved unchanged

- **GIVEN** a fenced code block opened with `` ```typescript ``
- **WHEN** the splitter emits chunks for that block
- **THEN** every chunk's opening fence is `` ```typescript ``

#### Scenario: Empty info string is preserved

- **GIVEN** a fenced code block opened with `` ``` `` (no language tag)
- **WHEN** the splitter emits chunks for that block
- **THEN** every chunk's opening fence is `` ``` ``

