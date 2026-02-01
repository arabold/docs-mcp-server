## 1. Test First

- [x] 1.1 Write unit test reproducing issue #317: stuck job with `recoverJobs: false` should be marked FAILED
- [x] 1.2 Write unit test for `recoverJobs: true` using refresh mechanism

## 2. Implementation

- [x] 2.1 Remove unused `isValidStatusTransition()` helper in `src/store/types.ts`
- [x] 2.2 Add `markInterruptedJobsAsFailed()` method to PipelineManager
- [x] 2.3 Call `markInterruptedJobsAsFailed()` in `start()` when `recoverJobs: false`
- [x] 2.4 Refactor `recoverPendingJobs()` to use `enqueueRefreshJob()` for recovery
- [x] 2.5 Handle recovery failures by marking job as FAILED with error message

## 3. Validation

- [x] 3.1 Verify all existing tests pass
- [x] 3.2 Verify new tests pass
- [x] 3.3 Run lint and typecheck
