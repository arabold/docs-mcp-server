# Change: Fix archive detection misidentifying ZIP-based documents

## Why
ZIP-based document formats (DOCX, XLSX, PPTX, EPUB, ODT, ODS, ODP) are incorrectly treated as ZIP archives by the magic byte fallback in `ArchiveFactory.getArchiveAdapter()`. These files start with the `PK` (0x50 0x4B) ZIP signature, so they match the magic byte check and get unpacked into their internal XML structure instead of being routed to `DocumentPipeline` for extraction via Kreuzberg. This completely prevents document text extraction for local file scraping.

## What Changes
- **Remove magic byte fallback** from `ArchiveFactory.getArchiveAdapter()` — archive detection SHALL rely exclusively on file extensions (`.zip`, `.tar`, `.gz`, `.tgz`), which are always available at all call sites
- **Add unit tests** for `ArchiveFactory` to verify document format extensions return `null`

## Impact
- Affected specs: `document-processing`
- Affected code:
  - `src/utils/archive/ArchiveFactory.ts` — remove magic byte detection block
  - `src/utils/archive/ArchiveFactory.test.ts` — new unit tests
