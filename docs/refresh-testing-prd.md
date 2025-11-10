# Refresh Testing PRD

## Overview

This document outlines additional test cases needed to ensure comprehensive coverage of the refresh functionality. The focus is on unit tests for specific components and edge cases not covered by existing E2E tests.

## Existing Coverage

The current `test/refresh-pipeline-e2e.test.ts` covers:

- ✅ Page deletion (404 during refresh)
- ✅ Page updates (200 with new content)
- ✅ Unchanged pages (304 responses)
- ✅ New page discovery during refresh
- ✅ 404 handling during normal scraping

## Proposed Additional Test Coverage

### 1. BaseScraperStrategy Unit Tests

**File:** `src/scraper/strategies/BaseScraperStrategy.test.ts` (extend existing)

#### 1.1 Initial Queue Processing

```typescript
describe("initialQueue handling", () => {
  it("should process all items from initialQueue before discovering new links");
  it("should preserve depth from initialQueue items");
  it("should preserve pageId from initialQueue items");
  it("should preserve etag from initialQueue items");
  it("should deduplicate between initialQueue and root URL");
  it("should handle empty initialQueue gracefully");
});
```

**Rationale:** The initialQueue is critical for refresh operations but isn't thoroughly tested at the unit level. We need to verify it's properly integrated into the scraping workflow.

#### 1.2 Refresh Mode Detection

```typescript
describe("refresh mode detection", () => {
  it("should detect refresh mode when initialQueue is provided");
  it("should use normal mode when initialQueue is empty");
  it("should correctly calculate effectiveTotal with initialQueue");
  it("should correctly track totalDiscovered with initialQueue");
});
```

**Rationale:** The strategy behaves differently in refresh mode. We should verify this detection logic works correctly.

#### 1.3 Root URL Handling in Refresh

```typescript
describe("root URL handling during refresh", () => {
  it("should process root URL even if it appears in initialQueue");
  it("should not duplicate root URL if already in initialQueue");
  it("should use etag from initialQueue for root URL if available");
  it("should add root URL at depth 0 if not in initialQueue");
});
```

**Rationale:** Root URL handling has special logic that needs validation to ensure it's always processed exactly once.

### 2. ProcessItem Result Status Handling

**File:** `src/scraper/strategies/BaseScraperStrategy.test.ts` (extend existing)

#### 2.1 Status-Based Counting

```typescript
describe("page counting with different statuses", () => {
  it("should count pages that return 200 OK");
  it("should count pages that return 304 Not Modified");
  it("should count pages that return 404 Not Found");
  it("should NOT count directory discoveries (no content, no pageId)");
  it("should increment pageCount correctly with mixed statuses");
});
```

**Rationale:** The `shouldCount` logic in `processBatch` is critical for correct progress reporting and needs explicit testing.

#### 2.2 Progress Callback with Statuses

```typescript
describe("progress callback with different statuses", () => {
  it("should call progressCallback with result=null for 304 responses");
  it("should call progressCallback with result=null for 404 responses");
  it("should call progressCallback with deleted=true for 404 responses");
  it("should call progressCallback with full result for 200 responses");
  it("should include pageId in progress for refresh operations");
});
```

**Rationale:** Progress callbacks are how external systems track refresh progress. We need to verify they receive correct information for each status.

### 3. ETag Handling Unit Tests

**File:** `src/scraper/fetcher/HttpFetcher.test.ts` (extend existing)

#### 3.1 Conditional Request Headers

```typescript
describe("conditional request headers", () => {
  it("should send If-None-Match header when etag is provided");
  it("should NOT send If-None-Match header when etag is null");
  it("should NOT send If-None-Match header when etag is undefined");
  it("should handle etag with quotes correctly");
  it("should handle etag without quotes correctly");
});
```

**Rationale:** ETag header formatting is critical for conditional requests. We need to verify it follows HTTP standards.

#### 3.2 ETag in Response

```typescript
describe("ETag extraction from responses", () => {
  it("should extract ETag from 200 responses");
  it("should preserve ETag from 304 responses");
  it("should handle missing ETag header gracefully");
  it("should handle weak ETags (W/) correctly");
  it("should normalize ETag quotes consistently");
});
```

**Rationale:** ETag extraction must be consistent to enable proper change detection in future refreshes.

### 4. FileFetcher ETag Tests

**File:** `src/scraper/fetcher/FileFetcher.test.ts` (new file)

#### 4.1 Mtime-Based ETag Generation

```typescript
describe("mtime-based ETag generation", () => {
  it("should generate ETag from file mtime");
  it("should return same ETag for unchanged files");
  it("should return different ETag when file is modified");
  it("should handle files without mtime gracefully");
  it("should generate consistent ETag format (ISO string)");
});
```

**Rationale:** FileFetcher uses mtime as ETag equivalent. This needs explicit testing to ensure it works correctly.

#### 4.2 File Status Detection

```typescript
describe("file status detection", () => {
  it("should return SUCCESS when file exists");
  it("should return NOT_FOUND when file does not exist");
  it("should return NOT_MODIFIED when mtime matches etag");
  it("should return SUCCESS when mtime differs from etag");
  it("should handle permission errors appropriately");
});
```

**Rationale:** File status detection drives refresh logic for local files and needs thorough testing.

### 5. PipelineWorker Refresh Logic

**File:** `src/pipeline/PipelineWorker.test.ts` (extend existing)

#### 5.1 Status-Based Database Operations

```typescript
describe("database operations based on fetch status", () => {
  it("should skip database operations for 304 Not Modified");
  it("should delete and re-insert for 200 OK with pageId");
  it("should insert new page for 200 OK without pageId");
  it("should call deletePage for 404 Not Found");
  it("should not process content for 404 Not Found");
});
```

**Rationale:** PipelineWorker orchestrates database operations based on status. This critical logic needs unit tests.

#### 5.2 PageId Handling

```typescript
describe("pageId handling during refresh", () => {
  it("should use pageId from scrape result when available");
  it("should handle missing pageId for new pages");
  it("should pass pageId to removeDocumentsByPageId");
  it("should pass pageId to deletePage");
  it("should preserve pageId in progress events");
});
```

**Rationale:** PageId is the key identifier for refresh operations. We need to verify it's handled correctly throughout the pipeline.

### 6. DocumentStore Deletion Methods

**File:** `src/store/DocumentStore.test.ts` (extend existing)

#### 6.1 deletePage Method

```typescript
describe("deletePage method", () => {
  it("should delete page and all associated documents via CASCADE");
  it("should return true when page exists and is deleted");
  it("should return false when page does not exist");
  it("should handle concurrent deletions gracefully");
  it("should not affect other pages in same version");
});
```

**Rationale:** The new deletePage method is critical for proper 404 handling. It needs comprehensive unit tests.

#### 6.2 removeDocumentsByPageId Method

```typescript
describe("removeDocumentsByPageId method", () => {
  it("should remove all documents for given pageId");
  it("should return count of documents removed");
  it("should not affect documents from other pages");
  it("should handle non-existent pageId gracefully");
  it("should handle empty document set gracefully");
});
```

**Rationale:** This method is used during content updates (200 OK). We need to verify it works correctly.

### 7. Strategy-Specific Refresh Tests

**File:** `src/scraper/strategies/WebScraperStrategy.test.ts` (extend existing)

#### 7.1 ETag Propagation

```typescript
describe("ETag propagation in WebScraperStrategy", () => {
  it("should pass etag from QueueItem to fetcher");
  it("should preserve etag in ProcessItemResult");
  it("should update etag when content changes (200 OK)");
  it("should preserve etag when content unchanged (304)");
  it("should clear etag for deleted pages (404)");
});
```

**Rationale:** We need to verify ETags flow correctly through the web scraping pipeline.

#### 7.2 Refresh with Redirects

```typescript
describe("refresh with URL redirects", () => {
  it("should update canonical URL after redirect");
  it("should use new ETag after redirect");
  it("should handle redirect to same domain");
  it("should handle redirect during refresh operation");
});
```

**Rationale:** Redirects during refresh can complicate URL tracking. This needs explicit testing.

### 8. LocalFileStrategy Refresh Tests

**File:** `src/scraper/strategies/LocalFileStrategy.test.ts` (extend existing)

#### 8.1 File Modification Detection

```typescript
describe("file modification detection", () => {
  it("should detect when file mtime has changed");
  it("should skip processing when mtime unchanged");
  it("should handle file deletion during refresh");
  it("should discover new files during refresh");
});
```

**Rationale:** The existing refresh tests in LocalFileStrategy are good but can be expanded with more specific mtime scenarios.

#### 8.2 Directory Re-scanning

```typescript
describe("directory re-scanning during refresh", () => {
  it("should discover files added to directory");
  it("should detect files removed from directory");
  it("should handle nested directory changes");
  it("should preserve depth for existing files");
});
```

**Rationale:** Directory refresh requires full re-scan. We need to verify this works correctly.

### 9. GitHubScraperStrategy Refresh Tests

**File:** `src/scraper/strategies/GitHubScraperStrategy.test.ts` (extend existing)

#### 9.1 Mixed Content Refresh

```typescript
describe("mixed wiki and file refresh", () => {
  it("should refresh wiki pages with HTTP ETags");
  it("should refresh repository files with API ETags");
  it("should handle wiki deletion gracefully");
  it("should discover new files added to repository");
  it("should handle tree API rate limiting");
});
```

**Rationale:** GitHub strategy handles both wiki and files. Refresh logic for both needs validation.

### 10. Edge Cases and Error Scenarios

**File:** `test/refresh-edge-cases-e2e.test.ts` (new file)

#### 10.1 Network Failures During Refresh

```typescript
describe("network failures during refresh", () => {
  it("should handle timeout for single page gracefully");
  it("should continue refresh after network error");
  it("should mark job as failed after multiple errors");
  it("should preserve valid pages after partial failure");
});
```

**Rationale:** Network issues are common in production. We need to verify graceful degradation.

#### 10.2 Database Failures During Refresh

```typescript
describe("database failures during refresh", () => {
  it("should rollback transaction on deletion failure");
  it("should handle constraint violations gracefully");
  it("should recover from temporary lock contention");
  it("should preserve database consistency on error");
});
```

**Rationale:** Database operations can fail. We need to verify error handling maintains consistency.

#### 10.3 Concurrent Refresh Operations

```typescript
describe("concurrent refresh operations", () => {
  it("should handle concurrent refreshes of same version");
  it("should handle concurrent refreshes of different versions");
  it("should prevent duplicate processing of same URL");
  it("should maintain database consistency with concurrent writes");
});
```

**Rationale:** Production systems may trigger multiple refreshes. We need to verify concurrent safety.

#### 10.4 Malformed ETag Handling

```typescript
describe("malformed ETag handling", () => {
  it("should handle ETag with special characters");
  it("should handle very long ETags");
  it("should handle empty ETag string");
  it("should handle ETag with invalid quotes");
  it("should fall back gracefully with malformed ETags");
});
```

**Rationale:** Real-world servers may return non-standard ETags. We need robust handling.

## Implementation Priority

### Phase 1: Critical Unit Tests (High Priority)

1. **BaseScraperStrategy initialQueue handling** - Core refresh functionality
2. **PipelineWorker status-based operations** - Database consistency
3. **DocumentStore deletePage** - New method validation
4. **HttpFetcher conditional headers** - ETag correctness

### Phase 2: Strategy-Specific Tests (Medium Priority)

5. **WebScraperStrategy ETag propagation** - Most common use case
6. **LocalFileStrategy file modification** - File-based refresh
7. **FileFetcher status detection** - File-based change detection

### Phase 3: Edge Cases (Lower Priority)

8. **Network failures** - Production resilience
9. **Concurrent operations** - Scale testing
10. **Malformed data handling** - Robustness

## Testing Approach

### Unit Tests

- **Isolation**: Mock external dependencies (filesystem, network, database)
- **Speed**: Should run in <100ms per test
- **Clarity**: Each test validates one specific behavior
- **Coverage**: Aim for >90% line coverage of refresh code paths

### Integration Tests

- **Realistic**: Use in-memory database but real HTTP mocking
- **Comprehensive**: Test full workflows end-to-end
- **Performance**: Should complete in <5 seconds per test
- **Scenarios**: Cover common real-world refresh patterns

### E2E Tests

- **Complete**: Use full stack including pipeline workers
- **Realistic**: Mock external services (GitHub API, web servers)
- **Validation**: Verify database state after operations
- **Time**: May take 10-30 seconds per test

## Success Criteria

1. **Code Coverage**: >90% line coverage for refresh-related code
2. **Test Speed**: Unit tests complete in <5 seconds total
3. **Reliability**: All tests pass consistently (no flakiness)
4. **Documentation**: Each test has clear description of what it validates
5. **Maintainability**: Tests use helpers/fixtures to reduce duplication

## Non-Goals

- **Performance benchmarking**: Not testing refresh speed, only correctness
- **Load testing**: Not testing high-volume refresh scenarios
- **Integration with real services**: All external services should be mocked
- **UI testing**: Refresh is a backend feature with no UI

## Open Questions

1. Should we test ETag generation algorithms directly, or only their behavior?
2. How do we test CASCADE DELETE without actually running migrations in tests?
3. Should we add property-based tests for ETag normalization?
4. Do we need tests for refresh cancellation mid-operation?

## References

- Existing E2E tests: `test/refresh-pipeline-e2e.test.ts`
- Refresh architecture: `docs/refresh-architecture.md`
- Strategy unit tests: `src/scraper/strategies/*.test.ts`
