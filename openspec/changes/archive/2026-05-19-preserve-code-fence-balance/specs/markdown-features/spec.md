# Spec delta: markdown-features

## ADDED Requirements

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

## MODIFIED Requirements

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
