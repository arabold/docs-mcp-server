# Spec: Extended Markdown Features

## ADDED Requirements

### Requirement: Support horizontal rules as chunk separators
The splitter MUST recognize horizontal rules (lines starting with `---`, `***`, or `___`) as explicit hard split points. Content before and after the rule MUST be placed in separate chunks.

#### Scenario: Horizontal Rule Splitting
Given a markdown document with two paragraphs separated by a horizontal rule
When the document is split
Then the paragraphs should be in separate chunks
And the chunk boundary should align with the horizontal rule

### Requirement: Support list chunking
The splitter MUST recognize markdown lists (`-`, `*`, `1.`) by identifying `<ul>` and `<ol>` tags. It SHALL utilize a dedicated `ListContentSplitter` to attempt keeping the list within a single chunk. If the list exceeds the maximum chunk size, it SHALL split at list item boundaries rather than in the middle of an item's text.

#### Scenario: List Preservation
Given a markdown document with a bullet list
When the document is split
Then the list items should preferably be kept together
And if the list is larger than the chunk size, it should split between list items

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
