# Change: Replace markitdown-ts with Kreuzberg for document extraction

## Why
The current `markitdown-ts` library (v0.0.8) is limited to 5 document formats (PDF, DOCX, XLSX, PPTX, IPYNB) and is a pure-JavaScript implementation with no native performance optimizations. Kreuzberg (`@kreuzberg/node`) is a Rust-core document intelligence library with native NAPI-RS bindings that supports 75+ file formats, offers significantly better extraction performance, and provides richer metadata and table extraction. This change is tracked in GitHub Issue #310.

## What Changes
- **Replace `markitdown-ts` dependency** with `@kreuzberg/node` (v4.x)
- **Rewrite `DocumentPipeline`** to use Kreuzberg's `extractBytes()` / `extractBytesSync()` API instead of `markitdown-ts`'s `convertBuffer()`
- **Request Markdown output from Kreuzberg** via `outputFormat: "markdown"` in `ExtractionConfig`, aligning document extraction with the project's Markdown-first processing pipeline
- **Prefer structured Markdown from `tables[].markdown`** over flat-text `content` for spreadsheet-type documents where Kreuzberg provides pre-rendered Markdown tables (with sheet names as headings and proper table formatting)
- **Expand supported document formats** to include legacy Office formats (DOC, XLS, PPT), OpenDocument formats (ODT, ODS, ODP), Rich Text (RTF), eBooks (EPUB, FB2), and other text-based formats Kreuzberg handles natively
- **Update `MimeTypeUtils.isSupportedDocument()`** to recognize the expanded set of document MIME types
- **Update `MimeTypeUtils`** to add MIME type mappings for newly supported extensions (`.doc`, `.xls`, `.ppt`, `.odt`, `.ods`, `.odp`, `.rtf`, `.epub`, `.fb2`)
- **Update GitHub strategy's `documentExtensions` whitelist** to include newly supported file extensions
- **Remove `markitdown-ts`** from `package.json` dependencies
- **Remove XLSX-specific `promoteTableHeaders()` post-processing** (Kreuzberg handles table extraction natively)
- **Remove file extension extraction logic** from `DocumentPipeline` (Kreuzberg uses MIME types directly via `extractBytes()`)
- **Update tests** to cover new formats, Markdown output preference, and the Kreuzberg integration

## Impact
- Affected specs: `document-processing` (new capability)
- Affected code:
  - `src/scraper/pipelines/DocumentPipeline.ts` - core rewrite
  - `src/scraper/pipelines/DocumentPipeline.test.ts` - test updates
  - `src/utils/mimeTypeUtils.ts` - expanded format support
  - `src/utils/mimeTypeUtils.test.ts` - new MIME type tests
  - `src/scraper/strategies/GitHubScraperStrategy.ts` - document extension whitelist
  - `package.json` - dependency swap
- **System requirement**: Node.js 22+ (already required by project; Kreuzberg NAPI-RS bindings require this)
- **No breaking changes** to external API or configuration; the `scraper.document.maxSize` config remains unchanged
