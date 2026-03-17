# Change: Refactor MIME Type Detection for Consistent Text File Support

## Why

RST (reStructuredText) files and many other common documentation/source code formats are incorrectly detected as `application/octet-stream` because the `mime` npm package either returns `null` or incorrect MIME types for these extensions. This causes files to be skipped during processing with "Unsupported content type" errors (GitHub Issue #311).

The codebase already has a `MimeTypeUtils.detectMimeTypeFromPath()` function with custom mappings, but it is not used consistently across all file processing paths, and its custom mappings are incomplete.

**Note:** `GitHubScraperStrategy.ts` works around this with a hardcoded whitelist of 60+ text extensions (including `.rst`, `.adoc`), but `LocalFileStrategy.ts` lacks this workaround and is the primary affected path for issue #311.

## What Changes

- **Consolidate MIME type detection**: Ensure all code paths use `MimeTypeUtils.detectMimeTypeFromPath()` instead of calling `mime.getType()` directly
- **Expand custom MIME type mappings**: Add comprehensive mappings for documentation formats, additional programming languages, and configuration files
- **Add corresponding language mappings**: Update `mimeToLanguage` to support syntax highlighting for new MIME types
- **Remove direct `mime` imports**: Clean up redundant `mime` imports from files that should use `MimeTypeUtils`

## Impact

- Affected specs: New capability `mime-type-detection` (no existing spec)
- Affected code:
  - `src/utils/mimeTypeUtils.ts` - Expand mappings
  - `src/scraper/strategies/LocalFileStrategy.ts` - Use `MimeTypeUtils` instead of `mime`
  - `src/scraper/strategies/GitHubScraperStrategy.ts` - Use `MimeTypeUtils` instead of `mime`
- Resolves: GitHub Issue #311 (RST files not supported)
