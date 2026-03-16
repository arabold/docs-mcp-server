## 1. Dependencies
- [x] 1.1 Install `@kreuzberg/node` (`npm install @kreuzberg/node`)
- [x] 1.2 Remove `markitdown-ts` from dependencies (`npm uninstall markitdown-ts`)

## 2. Expand MIME type support
- [x] 2.1 Add legacy Office MIME type checks to `MimeTypeUtils` (`isLegacyOfficeDocument()` or expand `isOfficeDocument()`) in `src/utils/mimeTypeUtils.ts` for `application/msword`, `application/vnd.ms-excel`, `application/vnd.ms-powerpoint`
- [x] 2.2 Add OpenDocument MIME type checks (`isOpenDocument()` or expand `isSupportedDocument()`) for `application/vnd.oasis.opendocument.text`, `.spreadsheet`, `.presentation`
- [x] 2.3 Add RTF MIME type check for `application/rtf`
- [x] 2.4 Add eBook MIME type checks for `application/epub+zip`, `application/x-fictionbook+xml`
- [x] 2.5 Update `isSupportedDocument()` to include all new format checks
- [x] 2.6 Add new file extension mappings to `detectMimeTypeFromPath()` custom map: `.doc`, `.xls`, `.ppt`, `.odt`, `.ods`, `.odp`, `.rtf`, `.epub`, `.fb2`
- [x] 2.7 Add unit tests for all new MIME type checks in `src/utils/mimeTypeUtils.test.ts`

## 3. Rewrite DocumentPipeline
- [x] 3.1 Replace `markitdown-ts` import with `@kreuzberg/node` import (`extractBytes` or `extractBytesSync`)
- [x] 3.2 Replace constructor: remove `MarkItDown` instantiation, keep splitter setup and `maxSize` config
- [x] 3.3 Rewrite `process()` method: use `extractBytes(buffer, mimeType)` instead of `this.markitdown.convertBuffer(buffer, { file_extension })`
- [x] 3.4 Use `ExtractionResult.metadata.title` for title extraction, fall back to `extractFilename()`
- [x] 3.5 Remove `extractExtension()`, `getExtensionFromMimeType()`, `getExtensionFromPath()` methods (Kreuzberg uses MIME types directly)
- [x] 3.6 Remove `promoteTableHeaders()` method (Kreuzberg handles XLSX tables natively)
- [x] 3.7 Keep `extractFilename()` for title fallback
- [x] 3.8 Keep size limit check at top of `process()`
- [x] 3.9 Update error handling: Kreuzberg throws `Error` on failure; catch and return graceful error result (sanitize binary content from error messages)
- [x] 3.10 Update file-level JSDoc to reflect Kreuzberg usage and expanded format support

## 4. Update GitHub strategy
- [x] 4.1 Add new extensions to `documentExtensions` array in `GitHubScraperStrategy` (`src/scraper/strategies/GitHubScraperStrategy.ts`): `.doc`, `.xls`, `.ppt`, `.odt`, `.ods`, `.odp`, `.rtf`, `.epub`, `.fb2`

## 5. Update tests
- [x] 5.1 Update existing `DocumentPipeline.test.ts` tests to work with Kreuzberg output (assertions may need adjustment for formatting differences)
- [x] 5.2 Create test fixtures for new formats: `.doc`, `.xls`, `.ppt`, `.odt`, `.rtf`, `.epub` (update `test/fixtures/create-office-fixtures.ts` or add new fixture creation script)
- [x] 5.3 Add `canProcess()` tests for all new MIME types (DOC, XLS, PPT, ODT, ODS, ODP, RTF, EPUB, FB2)
- [x] 5.4 Add `process()` integration tests for new document formats
- [x] 5.5 Verify XLSX output no longer needs `promoteTableHeaders` fix (empty header row issue resolved by Kreuzberg)
- [x] 5.6 Update `PipelineFactory.test.ts` if any pipeline ordering assertions reference `markitdown-ts`

## 6. Validation
- [x] 6.1 Run full test suite (`npm test`) and fix any failures
- [x] 6.2 Run lint and typecheck (`npm run lint && npm run typecheck`)
- [x] 6.3 Run build (`npm run build`) to verify no compilation errors
- [ ] 6.4 Manual smoke test: index a document library containing PDF, DOCX, XLSX, PPTX, and newly supported formats

## 7. Prefer Markdown output from Kreuzberg
- [x] 7.1 Pass `{ outputFormat: "markdown" }` to `extractBytes()` in `DocumentPipeline.process()` to request Markdown-formatted output
- [x] 7.2 Add content selection logic: when `result.tables` is non-empty, concatenate `tables[].markdown` as extracted content; otherwise use `result.content`
- [x] 7.3 Extract content selection into a private helper method (e.g., `extractContent(result)`) for clarity and testability
- [x] 7.4 Update file-level JSDoc to document the Markdown output preference and table content selection behavior

## 8. Update tests for Markdown output preference
- [x] 8.1 Add test: XLSX extraction produces Markdown tables (via `tables[].markdown`) with sheet names as headings
- [x] 8.2 Add test: DOCX extraction with formatting preserves headings, bold, italic, lists in Markdown
- [x] 8.3 Add test: document without tables uses `result.content`
- [x] 8.4 Update existing `process()` tests to mock Kreuzberg with `outputFormat: "markdown"` config
- [x] 8.5 Add test: multi-sheet XLSX concatenates all sheets' Markdown tables

## 9. Re-validate
- [x] 9.1 Run full test suite (`npm test`) and fix any failures
- [x] 9.2 Run lint and typecheck (`npm run lint && npm run typecheck`)
- [x] 9.3 Run build (`npm run build`) to verify no compilation errors
