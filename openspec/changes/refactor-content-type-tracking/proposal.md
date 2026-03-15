# Change: Refactor Content Type Tracking to Preserve Original and Processed MIME Types

## Why

The `pages.content_type` column currently stores inconsistent values depending on the scraper strategy. `WebScraperStrategy` stores the post-pipeline MIME type (e.g., `text/markdown` for an HTML page after conversion), while `LocalFileStrategy` and `GitHubRepoProcessor` store the original fetcher-reported MIME type. This means:

1. For web-scraped HTML pages, the original `text/html` MIME type is lost -- the database stores `text/markdown` instead.
2. Consumers (web UI, search API, assembly strategy factory) cannot distinguish between content that was originally markdown vs. content that was converted to markdown from HTML or PDF.
3. The behavior is undocumented and confusing: `data-storage.md` says "MIME type of the content" without clarifying original vs. processed.

## What Changes

- **BREAKING**: Rename `pages.content_type` to `pages.source_content_type` to store the original MIME type of the fetched resource (e.g., `text/html`, `application/pdf`, `text/x-typescript`).
- Add new column `pages.content_type` to store the post-processing MIME type (e.g., `text/markdown` after HTML-to-markdown conversion, or the original type if unchanged).
- Fix all three scraper strategies to consistently populate both values.
- Update downstream consumers (assembly strategy, web UI, search API) to use the appropriate field.
- Update documentation to clearly define the semantics of each column.

## Impact

- Affected specs: `mime-type-detection` (modifying existing change delta)
- Affected code:
  - `db/migrations/` - New migration for schema change
  - `src/store/types.ts` - `DbPage`, `DbPageChunk`, `StoreSearchResult` interfaces
  - `src/store/DocumentStore.ts` - SQL statements and `addDocuments` method
  - `src/scraper/strategies/WebScraperStrategy.ts` - Populate both MIME types
  - `src/scraper/strategies/LocalFileStrategy.ts` - Populate both MIME types
  - `src/scraper/strategies/GitHubRepoProcessor.ts` - Populate both MIME types
  - `src/scraper/strategies/BaseScraperStrategy.ts` - `ProcessItemResult` interface
  - `src/scraper/types.ts` - `ScrapeResult` interface
  - `src/store/DocumentRetrieverService.ts` - Read both types
  - `src/store/assembly/ContentAssemblyStrategyFactory.ts` - Use `content_type` (processed) for strategy selection
  - `src/web/components/SearchResultItem.tsx` - Display and render decisions
  - `docs/concepts/data-storage.md` - Document both columns
