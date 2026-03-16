## 1. Database Schema

- [x] 1.1 Create migration `0XX-add-source-content-type.sql`: add `source_content_type TEXT` column to `pages`, backfill from existing `content_type`
- [x] 1.2 Update `src/store/DocumentStore.ts`: modify `insertPage` prepared statement to accept and write `source_content_type`; update all SELECT queries that JOIN `pages` to include `source_content_type`
- [x] 1.3 Update migration tests in `src/store/applyMigrations.test.ts` to verify the new column exists after migration

## 2. Type Definitions

- [x] 2.1 Add `source_content_type` to `DbPage` interface in `src/store/types.ts`
- [x] 2.2 Add `source_content_type` to `DbPageChunk` interface in `src/store/types.ts`
- [x] 2.3 Add `sourceMimeType` to `StoreSearchResult` interface in `src/store/types.ts`
- [x] 2.4 Add `sourceContentType` to `ProcessItemResult` interface in `src/scraper/strategies/BaseScraperStrategy.ts`
- [x] 2.5 Add `sourceContentType` to `ScrapeResult` interface in `src/scraper/types.ts`

## 3. Scraper Strategy Fixes (parallelizable: 3.1, 3.2, 3.3 are independent)

- [x] 3.1 Fix `WebScraperStrategy.ts`: set `sourceContentType: rawContent.mimeType` and `contentType: processed.contentType || rawContent.mimeType`
- [x] 3.2 Fix `LocalFileStrategy.ts`: set `sourceContentType: rawContent.mimeType` and `contentType: processed.contentType || rawContent.mimeType` (currently only uses `rawContent.mimeType` for both)
- [x] 3.3 Fix `GitHubRepoProcessor.ts`: set `sourceContentType: rawContent.mimeType` and `contentType: processed.contentType || rawContent.mimeType` (currently only uses `rawContent.mimeType` for both)

## 4. Store Layer

- [x] 4.1 Update `DocumentStore.addDocuments` to write both `source_content_type` and `content_type` from the `ScrapeResult`
- [x] 4.2 Update `DocumentRetrieverService.processUrlGroup` to read and propagate `source_content_type` into `StoreSearchResult.sourceMimeType`

## 5. Consumers

- [x] 5.1 Update `ContentAssemblyStrategyFactory` to explicitly use `content_type` (processed) -- verify current behavior is correct (it already uses `content_type`)
- [x] 5.2 Update `SearchResultItem.tsx` to display `sourceMimeType` in the badge and use `mimeType` (processed) for rendering decisions
- [x] 5.3 Update MCP search tool response to include `sourceMimeType` if available

## 6. Documentation

- [x] 6.1 Update `docs/concepts/data-storage.md` to document both columns with clear semantics
- [x] 6.2 Update TSDoc for `PipelineResult.contentType`, `ScrapeResult.contentType`, `ScrapeResult.sourceContentType`, `ProcessItemResult.contentType`, `ProcessItemResult.sourceContentType`

## 7. Testing

- [x] 7.1 Add integration tests for `WebScraperStrategy` verifying both content types are set correctly for HTML pages
- [x] 7.2 Add integration tests for `LocalFileStrategy` verifying both content types for source code and markdown files
- [x] 7.3 Add tests for `DocumentRetrieverService` verifying both MIME types are returned in search results
- [x] 7.4 Add tests for `DocumentStore.addDocuments` verifying both columns are written
- [x] 7.5 Run full test suite (`npm test`), typecheck (`npm run typecheck`), and lint (`npm run lint`)
