## 1. Test First

- [ ] 1.1 Write unit test reproducing issue #317: stuck job with `recoverJobs: false` should be marked FAILED
- [ ] 1.2 Write unit test for `recoverJobs: true` using refresh mechanism

## 2. Implementation

- [ ] 2.1 Update `isValidStatusTransition()` in `src/store/types.ts` to allow `QUEUED → FAILED`
- [ ] 2.2 Add `markInterruptedJobsAsFailed()` method to PipelineManager
- [ ] 2.3 Call `markInterruptedJobsAsFailed()` in `start()` when `recoverJobs: false`
- [ ] 2.4 Refactor `recoverPendingJobs()` to use `enqueueRefreshJob()` for recovery
- [ ] 2.5 Handle recovery failures by marking job as FAILED with error message

## 3. Validation

- [ ] 3.1 Verify all existing tests pass
- [ ] 3.2 Verify new tests pass
- [ ] 3.3 Run lint and typecheck
