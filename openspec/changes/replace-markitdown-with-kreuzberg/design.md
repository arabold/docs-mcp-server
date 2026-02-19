## Context

The `DocumentPipeline` (`src/scraper/pipelines/DocumentPipeline.ts:29`) currently uses `markitdown-ts` (v0.0.8) to convert binary documents (PDF, DOCX, XLSX, PPTX, IPYNB) to Markdown, then splits the output with `SemanticMarkdownSplitter` wrapped in `GreedySplitter`.

Kreuzberg (`@kreuzberg/node` v4.x) is a Rust-core document extraction library with NAPI-RS bindings for Node.js. It supports 75+ formats with native performance and provides both file-based and buffer-based extraction APIs.

This change introduces a new external dependency (`@kreuzberg/node`) and replaces the sole usage of `markitdown-ts` in the codebase.

## Goals / Non-Goals

**Goals:**
- Replace `markitdown-ts` with Kreuzberg for all document extraction
- Expand supported document formats (legacy Office, OpenDocument, RTF, EPUB)
- Maintain the same pipeline interface (`ContentPipeline`) and output contract (`PipelineResult`)
- Keep existing chunking/splitting behavior downstream

**Non-Goals:**
- Adding OCR support for scanned PDFs or images (future work)
- Adding archive/ZIP extraction (handled separately by `add-zip-support` change)
- Changing the `ContentPipeline` interface or `PipelineResult` type
- Leveraging Kreuzberg's built-in chunking (we use our own splitters)
- Leveraging Kreuzberg's embeddings support (we have our own embedding pipeline)
- Exposing Kreuzberg's full `ExtractionConfig` to users (only `outputFormat` is used internally)

## Decisions

### Decision 1: Use `extractBytes()` for buffer-based extraction

**What:** Use Kreuzberg's `extractBytes(data: Uint8Array, mimeType: string)` async API to extract text from in-memory buffers, passing the MIME type directly.

**Why:** The current pipeline receives content as `Buffer` via `RawContent.content`. Kreuzberg's `extractBytes()` accepts `Uint8Array` (which `Buffer` extends) and a MIME type string, eliminating the need for file extension detection logic currently in `DocumentPipeline.extractExtension()`.

**Alternatives considered:**
- `extractFile()` (file path-based): Rejected because the pipeline works with in-memory buffers, not file paths. Writing to temp files would add I/O overhead and complexity.
- `extractBytesSync()` (synchronous): Rejected because async is preferred to avoid blocking the event loop during large document processing.

### Decision 2: Request Markdown output and prefer structured tables

**What:** Pass `{ outputFormat: "markdown" }` in `ExtractionConfig` to request Markdown-formatted output from Kreuzberg. When `result.tables` is non-empty, concatenate `tables[].markdown` as the extracted content instead of using `result.content`.

**Why:** The project's processing pipeline is Markdown-first: HTML is converted to Markdown, then split with `SemanticMarkdownSplitter`. Document extraction should follow the same pattern. Kreuzberg's `outputFormat: "markdown"` produces Markdown headings, bold, italic, and lists for DOCX/PPTX. However, for spreadsheet-type documents (XLSX, XLS, ODS), the `content` field remains flat text even with `outputFormat: "markdown"` -- the only way to get proper Markdown tables is from `tables[].markdown`, which includes sheet names as `##` headings and properly formatted Markdown table syntax. Using `tables[].markdown` when available produces significantly better output for tabular data.

**Behavior by format:**
| Format | `content` with `outputFormat: "markdown"` | `tables[].markdown` | Preferred source |
|--------|-------------------------------------------|---------------------|------------------|
| DOCX | Full Markdown (headings, bold, italic, lists, inline tables) | Populated if document contains tables | `content` (already includes tables) |
| XLSX/XLS/ODS | Flat text (space-separated cells) | Sheet-named Markdown tables | `tables[].markdown` |
| PPTX/PPT/ODP | Markdown headings per slide | Empty | `content` |
| PDF | Plain text (Markdown benefits minimal) | Populated if PDF contains tables | `tables[].markdown` when present |

**Alternatives considered:**
- Always using `result.content`: Rejected because spreadsheet content would be flat text without structure, losing table formatting that is critical for semantic splitting.
- Always using `tables[].markdown`: Rejected because DOCX `content` is richer (includes headings, lists, bold/italic) while `tables[].markdown` only contains table data.
- Format-specific branching: Rejected in favor of the generic rule "prefer tables when available" which works correctly across all formats without MIME-type-specific logic.

### Decision 3: Use Kreuzberg's metadata for title extraction

**What:** Use `ExtractionResult.metadata.title` from Kreuzberg when available, falling back to filename extraction (existing behavior).

**Why:** Kreuzberg extracts document metadata including title, author, page count etc. This is more reliable than `markitdown-ts`'s title extraction and eliminates the need for custom title extraction logic.

### Decision 4: Remove XLSX-specific `promoteTableHeaders()` post-processing

**What:** Remove the `promoteTableHeaders()` method that fixes empty table header rows in Excel output.

**Why:** This was a workaround for a `markitdown-ts` bug where Excel sheet-to-HTML conversions produced empty header rows. Kreuzberg handles Excel extraction natively with proper table structure, making this workaround unnecessary.

### Decision 5: Expand format support incrementally

**What:** Add support for the following format categories that Kreuzberg handles natively:

| Category | Extensions | MIME Types |
|----------|-----------|------------|
| Legacy Office | `.doc`, `.xls`, `.ppt` | `application/msword`, `application/vnd.ms-excel`, `application/vnd.ms-powerpoint` |
| OpenDocument | `.odt`, `.ods`, `.odp` | `application/vnd.oasis.opendocument.*` |
| Rich Text | `.rtf` | `application/rtf` |
| eBooks | `.epub`, `.fb2` | `application/epub+zip`, `application/x-fictionbook+xml` |

**Why:** These are commonly encountered documentation formats. Kreuzberg extracts them natively without external tools (including legacy DOC/XLS/PPT). Formats excluded from this scope: images (OCR), archives (handled by `add-zip-support`), emails.

### Decision 6: Keep size limit enforcement in the pipeline

**What:** Continue to check `scraper.document.maxSize` before passing buffers to Kreuzberg.

**Why:** Even though Kreuzberg handles large files efficiently, the size limit is a user-configurable safeguard that prevents excessive memory usage and processing time in the scraper pipeline. The limit applies before any extraction work begins.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Native binary dependency (NAPI-RS) complicates cross-platform builds | Kreuzberg provides pre-built binaries for macOS (arm64/x64), Linux (x64), Windows (x64). CI platforms are covered. |
| `@kreuzberg/node` requires Node.js 22+ | Project already targets Node.js 22 (per `AGENTS.md`). No additional constraint. |
| Kreuzberg's text output quality may differ from `markitdown-ts` | Kreuzberg is more mature and widely used. Run existing test suite to validate output quality. Tests may need assertion updates for minor formatting differences. |
| Larger dependency footprint (~809 kB unpacked) vs `markitdown-ts` | Acceptable trade-off for significantly better extraction quality and format coverage. `markitdown-ts` is removed to offset. |
| Table extraction behavior changes for XLSX | Kreuzberg has native table extraction. Verify test fixtures still produce correct output; remove `promoteTableHeaders` only after confirming Kreuzberg handles it correctly. |

## Migration Plan

1. Install `@kreuzberg/node` and update `package.json`
2. Rewrite `DocumentPipeline` to use Kreuzberg API
3. Expand `MimeTypeUtils.isSupportedDocument()` with new format checks
4. Update GitHub strategy document extension whitelist
5. Run existing test suite - update assertions for formatting differences
6. Add tests for newly supported formats (DOC, XLS, PPT, ODT, RTF, EPUB)
7. Remove `markitdown-ts` from dependencies
8. No user-facing configuration changes required

**Rollback:** Revert the dependency swap and `DocumentPipeline` changes. The `markitdown-ts` code is straightforward to restore since it's confined to a single file.

## Open Questions

- Should we expose any of Kreuzberg's `ExtractionConfig` options (e.g., PDF passwords) through `AppConfig`? (Recommendation: defer to a follow-up change)
- Should `Metadata` from Kreuzberg (author, page count, creation date) be surfaced in the `PipelineResult`? (Recommendation: defer; current `PipelineResult` only has `title`)
