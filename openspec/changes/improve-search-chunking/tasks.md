# Tasks

1.  **Update Configuration Schema**
    -   Modify `src/utils/config.ts` to add `assembly.maxChunkDistance` (default: 3).
    -   Update `AppConfig` type definition if necessary (Zod inference should handle it).
    -   <!-- Validation: Run `npm run typecheck` -->

2.  **Implement Chunk Clustering Logic**
    -   Modify `src/store/DocumentRetrieverService.ts`.
    -   Add private method `clusterChunksByDistance(chunks: DbPageChunk[]): DbPageChunk[][]`.
    -   Update `search` method to apply clustering after grouping by URL but before `processUrlGroup`.
    -   Iterate over *clusters* instead of URL groups to call `processUrlGroup`.
    -   Collect all results and perform a final sort by score.
    -   <!-- Validation: Unit tests in Task 3 -->

3.  **Add Unit Tests**
    -   Update `src/store/DocumentRetrieverService.test.ts`.
    -   Add test case: `should split distant chunks into separate results`.
    -   Add test case: `should merge close chunks`.
    -   Add test case: `should maintain score sorting across split results`.
    -   <!-- Validation: Run `npm test src/store/DocumentRetrieverService.test.ts` -->
