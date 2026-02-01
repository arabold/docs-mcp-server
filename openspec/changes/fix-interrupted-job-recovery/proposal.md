# Change: Fix Interrupted Job Recovery

GitHub Issue: #317

## Why

When a Docker container (or application) is stopped while a scraping job is running, the job gets stuck in `RUNNING` status forever. On restart with `web` or `mcp` commands (`recoverJobs: false`), recovery logic is skipped, leaving the version stuck. The UI shows a spinning refresh button that cannot be clicked, and users must delete the library to recover.

Additionally, the current `recoverPendingJobs()` implementation (when `recoverJobs: true`) starts jobs from scratch instead of leveraging the existing refresh mechanism to continue where they left off.

## What Changes

- **When `recoverJobs: false`:** Mark all interrupted jobs (RUNNING/QUEUED status) as FAILED with message "Job interrupted" instead of leaving them stuck
- **When `recoverJobs: true`:** Use `enqueueRefreshJob()` for proper recovery that leverages existing pages and ETags, falling back to `enqueueJobWithStoredOptions()` for incomplete versions
- Add new `markInterruptedJobsAsFailed()` method to PipelineManager
- Refactor `recoverPendingJobs()` to use the refresh mechanism
- Handle edge case where recovery fails (no stored options) by marking job as FAILED

## Impact

- Affected specs: pipeline-recovery (new capability)
- Affected code:
  - `src/pipeline/PipelineManager.ts` - add `markInterruptedJobsAsFailed()`, refactor `recoverPendingJobs()`
  - `src/pipeline/PipelineManager.test.ts` - add tests for both recovery modes
  - `src/store/types.ts` - update `isValidStatusTransition()` to allow `QUEUED → FAILED`
