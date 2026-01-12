# Proposal: Enhance Semantic Markdown Chunking

## Summary
Improve the semantic chunking of markdown documents by recognizing and specifically handling more content types: horizontal rules, lists, blockquotes, and media.

## Goals
- Treat horizontal rules as explicit chunk separators.
- Preserve list structure by chunking lists intelligently (avoiding splits inside items).
- Handle blockquotes and media as distinct semantic units.
- Improve the quality of RAG (Retrieval-Augmented Generation) by providing cleaner, more semantically meaningful chunks.

## Scope
- `SemanticMarkdownSplitter` logic.
- New/Updated splitters for lists and text.
- No changes to JSON splitting or other pipelines.
