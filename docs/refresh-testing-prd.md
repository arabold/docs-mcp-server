# Test Refactoring Implementation Plan

## Overview

This document serves as a comprehensive to-do list for refactoring all unit tests to follow a behavior-driven testing philosophy. The focus is on validating public contracts and observable outcomes, rather than internal implementation details.

## Testing Philosophy

- **Behavior-Driven**: Tests validate the public contract of a component. We test _what_ it does, not _how_ it does it.
- **Consolidate and Elevate**: We favor integration tests that cover a complete workflow over multiple granular unit tests.
- **Clarity of Purpose**: Tests are separated into **Unit/Integration** (verifying component behavior) and **E2E** (verifying complete system workflows).
- **Avoid Implementation Details**: Don't test how something is implemented. Test the observable behavior.

---

## Implementation Checklist

### Phase 1: DocumentStore (`src/store/DocumentStore.test.ts`)

#### Refresh-Related Tests

- [x] **REMOVE** - `describe("Refresh Operations - deletePage", ...)` block

  - **Rationale**: This is an implementation detail better tested at the `PipelineWorker` level
  - **Files to update**: `src/store/DocumentStore.test.ts`

- [x] **KEEP** - `describe("Refresh Operations - getPagesByVersionId", ...)` block
  - **Rationale**: Tests the public contract for building refresh queues
  - **Action**: No changes needed

#### Non-Refresh Tests to Refine

- [x] **REFINED** - "Embedding Batch Processing" tests

  - **Action**: Refactored to test observable behavior (documents are successfully embedded and searchable) rather than implementation details (exact batch sizes)
  - **Changes made**: Replaced test that checked exact batch counts with test that verifies all documents are embedded and searchable
  - **Files updated**: `src/store/DocumentStore.test.ts`
  - **Status**: All 29 tests passing

- [x] **KEPT** - "Hybrid Search" and "FTS-only Search" tests

  - **Rationale**: These test the quality and correctness of search results (observable behavior)
  - **Status**: No changes needed

- [x] **KEPT** - Core contract tests (storage, retrieval, versioning)
  - **Rationale**: Well-structured behavior-driven tests
  - **Status**: No changes needed

---

### Phase 2: HttpFetcher (`src/scraper/fetcher/HttpFetcher.test.ts`)

#### Refresh-Related Tests to Consolidate

- [x] **CONSOLIDATE** - Conditional request header tests

  - **Current**: Multiple scattered tests for `If-None-Match` header
  - **Target**: Two clear tests as specified in the plan
  - **Files to update**: `src/scraper/fetcher/HttpFetcher.test.ts`
  - **Completed**: Consolidated from 3 tests → 2 tests

- [x] **CONSOLIDATE** - 304 response handling tests

  - **Current**: Multiple tests for 304 behavior
  - **Target**: Consolidate into focused behavior tests
  - **Files to update**: `src/scraper/fetcher/HttpFetcher.test.ts`
  - **Completed**: Consolidated from 3 tests → 1 test (correctly mocked as success, not error)

- [x] **CONSOLIDATE** - ETag extraction tests
  - **Current**: Multiple tests for ETag formats
  - **Target**: Single test with multiple format examples
  - **Files to update**: `src/scraper/fetcher/HttpFetcher.test.ts`
  - **Completed**: Consolidated from 2 tests → 1 test

#### Non-Refresh Tests to Consolidate

- [x] **CONSOLIDATE** - Retry logic tests

  - **Current**: One test per status code (429, 500, 503, etc.)
  - **Target**: Two primary tests:
    - One for retryable statuses `[408, 429, 500, 502, 503, 504, 525]`
    - One for non-retryable statuses `[400, 401, 403, 405, 410]`
  - **Files to update**: `src/scraper/fetcher/HttpFetcher.test.ts`
  - **Completed**: Consolidated from 5 tests → 2 tests

- [x] **KEEP** - Cancellation and redirect handling tests
  - **Rationale**: Excellent examples of testing observable behavior
  - **Action**: No changes needed
  - **Result**: All 31 tests passing

---

### Phase 3: FileFetcher (`src/scraper/fetcher/FileFetcher.test.ts`)

#### Refresh-Related Tests

- [x] **REMOVE** - "Mtime-based ETag generation" tests

  - **Rationale**: Implementation detail (how ETags are generated)
  - **Tests to remove**:
    - "should generate ETag from file mtime"
    - "should return same ETag for unchanged files"
    - "should return different ETag when file is modified"
  - **Files to update**: `src/scraper/fetcher/FileFetcher.test.ts`
  - **Completed**: Removed 3 implementation detail tests

- [x] **CONSOLIDATE** - "File status detection for refresh" tests
  - **Current**: Multiple granular tests
  - **Target**: Four core behavioral tests:
    - "should return NOT_MODIFIED when fetching an unchanged file with its etag"
    - "should return SUCCESS when fetching a modified file with its old etag"
    - "should return NOT_FOUND when the file has been deleted"
    - "should return SUCCESS when fetching a new file without an etag"
  - **Files to update**: `src/scraper/fetcher/FileFetcher.test.ts`
  - **Completed**: Consolidated from 6 tests → 4 focused behavior tests
  - **Result**: All 15 tests passing

#### Non-Refresh Tests to Consolidate

- [x] **CONSOLIDATED** - MIME type detection tests
  - **Previous**: Single large test checking all file types inline
  - **Current**: Parameterized test using `it.each` with file extension to MIME type mapping
  - **Benefits**:
    - Better test output (13 individual test cases vs 1 monolithic test)
    - Each file type tested independently
    - Easy to add new file types
    - Clear test names showing exactly what's being tested
  - **Files updated**: `src/scraper/fetcher/FileFetcher.test.ts`
  - **Status**: All 27 tests passing (15 baseline + 4 refresh + 8 other tests)
  - **Note**: Converted from 1 test with 13 inline checks → 13 parameterized tests

---

### Phase 4: BaseScraperStrategy (`src/scraper/strategies/BaseScraperStrategy.test.ts`)

#### Refresh-Related Tests to Add

- [x] **ALREADY PRESENT** - `describe("Refresh mode with initialQueue", ...)`

  - **Tests present**:
    - "should prioritize initialQueue items before discovering new links"
    - "should preserve pageId from initialQueue items"
    - "should preserve etag from initialQueue items"
    - "should not duplicate root URL if already in initialQueue"
  - **Files**: `src/scraper/strategies/BaseScraperStrategy.test.ts`
  - **Status**: All 4 tests passing

- [x] **ALREADY PRESENT** - `describe("Page counting with different fetch statuses", ...)`

  - **Tests present**:
    - "should count pages that return 200 OK"
    - "should count pages that return 304 Not Modified"
    - "should count pages that return 404 Not Found"
  - **Files**: `src/scraper/strategies/BaseScraperStrategy.test.ts`
  - **Status**: All 3 tests passing
  - **Note**: Removed 1 test checking implementation details (totalPages calculation)

- [x] **ALREADY PRESENT** - `describe("Progress callbacks with different statuses", ...)`
  - **Tests present**:
    - "should call progressCallback with result=null for 304 responses"
    - "should call progressCallback with deleted=true for 404 responses"
    - "should include pageId in progress for refresh operations"
  - **Files**: `src/scraper/strategies/BaseScraperStrategy.test.ts`
  - **Status**: All 3 tests passing

#### Non-Refresh Tests to Refine

- [x] **ALREADY WELL-STRUCTURED** - URL filtering tests

  - **Current**: Well-organized tests covering all scenarios
  - **Tests present**: 6 tests covering include/exclude with glob/regex patterns
  - **Status**: All tests passing, no changes needed

- [x] **KEEP** - Core crawling tests
  - **Tests to keep**:
    - maxPages and maxDepth enforcement
    - URL deduplication
    - Breadth-first search ordering
  - **Rationale**: Excellent behavior-driven tests
  - **Action**: No changes needed
  - **Status**: All tests passing

---

### Phase 5: PipelineWorker (`src/pipeline/PipelineWorker.test.ts`)

#### Tests Added

- [x] **ADDED** - `describe("Database operations based on fetch status", ...)`
  - **Tests added**:
    - "should perform NO database writes for a 304 Not Modified status"
    - "should DELETE existing documents and INSERT new ones for a 200 OK status on an existing page"
    - "should INSERT new documents for a 200 OK status on a new page"
    - "should call deletePage for a 404 Not Found status"
  - **Rationale**: This is the critical integration point where HTTP status codes translate to database state
  - **Files updated**: `src/pipeline/PipelineWorker.test.ts`
  - **Status**: All 4 new tests passing (10 total tests in file)

---

### Phase 6: E2E Tests (`test/refresh-pipeline-e2e.test.ts`)

#### Tests Added

- [x] **ADDED** - Multi-status refresh scenarios

  - ✅ "should delete documents when a page returns 404 during refresh"
  - ✅ "should update documents when a page has changed content during refresh"
  - ✅ "should skip processing when pages return 304 Not Modified"
  - ✅ "should discover and index new pages during refresh"

- [x] **ADDED** - File-based refresh scenarios

  - ✅ "should detect new files, modified files, and deleted files during refresh"
  - ✅ "should handle unchanged files efficiently during file-based refresh"

- [x] **ADDED** - Standard scrape error handling

  - ✅ "should gracefully handle 404 errors for broken links during normal scraping"
  - ✅ "should continue scraping after encountering multiple 404 errors"

- [x] **ADDED** - Edge cases & resiliency
  - ✅ "should handle network timeouts gracefully and continue processing other pages"
  - ✅ "should follow redirects and use the final URL for indexing"
  - ✅ "should handle redirect chains during refresh and update canonical URLs"

**Status**: All 11 E2E tests passing. Complete end-to-end validation of refresh pipeline functionality using `nock` for HTTP mocking and `memfs` for file system mocking.

**Key Fixes Made**:

- Fixed `PipelineManager.enqueueRefreshJob` to not override `maxPages` from stored options
- Fixed file-based test to properly reset `memfs` volume before modifying file structure
- All tests now use mocked responses (no real network calls or timeouts)

---

## Implementation Approach

### Step-by-Step Process

1. **Start with removals** - Clean up implementation detail tests first
2. **Then consolidate** - Combine similar tests into more powerful versions
3. **Finally add** - Implement missing behavioral tests
4. **Verify** - Run full test suite after each phase

### For Each Test File

1. Review the current test structure
2. Identify tests that match the "remove" or "consolidate" criteria
3. Make changes incrementally
4. Run tests after each change to ensure nothing breaks
5. Commit changes with clear messages

---

## Success Criteria

- [ ] **All tests are behavior-driven** - No implementation details tested
- [ ] **Unit tests run fast** - Component tests complete in <5 seconds total
- [ ] **E2E tests are comprehensive** - Complete workflows validated end-to-end
- [ ] **Tests are maintainable** - Clear, focused, easy to update
- [ ] **Full test coverage** - All public contracts have tests

---

## What Makes a Good Test?

### ✅ Good Tests

- Test observable behavior: "File change detection returns SUCCESS for modified files"
- Test the contract: "404 status results in page deletion"
- Test integration points: "PipelineWorker correctly translates status codes to database operations"
- Use realistic scenarios: "Refresh with mix of 304, 200, and 404 responses"

### ❌ Bad Tests

- Test implementation details: "ETag is generated from mtime timestamp"
- Test internal state: "Queue contains exactly N items"
- Test trivial behavior: "Function returns the value it was given"
- Over-mock: Mocking every dependency makes tests fragile and meaningless

---

## References

- Existing E2E tests: `test/refresh-pipeline-e2e.test.ts`
- Refresh architecture: `docs/refresh-architecture.md`
- Strategy unit tests: `src/scraper/strategies/*.test.ts`
- Fetcher unit tests: `src/scraper/fetcher/*.test.ts`
- Store unit tests: `src/store/DocumentStore.test.ts`
