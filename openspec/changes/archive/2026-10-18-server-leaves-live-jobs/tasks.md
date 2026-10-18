# Tasks

## 1. Spec baseline

- [x] 1.1 Archive `cli-leaves-interrupted-jobs` (shipped in #546) so `openspec/specs/pipeline-recovery/spec.md` describes the three policies; verify the main spec has no `recoverJobs` and contains "One-Shot Commands Leave Interrupted Jobs Alone", and `openspec validate server-leaves-live-jobs` passes.

## 2. Store and config

- [x] 2.1 Add `scraper.jobHeartbeatMs` (positive integer, default 15000) to `src/utils/config.ts` and document it in `docs/setup/configuration.md`, including that every process on a store should use one value; verify config tests read the env override and fall back to the default for 0.
- [x] 2.2 Add `markVersionsAlive(versionIds)` to `DocumentStore` and `DocumentManagementService`; verify in `DocumentStore.test.ts` that it bumps `updated_at` of a QUEUED or RUNNING version and leaves a COMPLETED one unchanged.

## 3. Pipeline

- [x] 3.1 `PipelineManager` marks its unfinished jobs alive every `jobHeartbeatMs` from `start()` until `stop()`, with unref'd timers; verify with tests that a held job's version is marked on each interval and nothing is marked after `stop()`.
- [x] 3.2 `start()` handles only versions silent past `4 × jobHeartbeatMs + 1 s` and never this manager's own jobs; verify the existing recover/fail/leave tests against versions seeded an hour in the past (fake `Date`), a new test that a recently updated version is left at start, and the `it.todo` for jobs enqueued before `start()` turned into a passing test.
- [x] 3.3 Recently alive versions are checked once more one bound after `start()` and handled if silent then; verify with fake timers that an untouched seeded version is failed after the bound, and that `stop()` cancels the check.
- [x] 3.4 Update callers whose tests expect a fresh seeded version to be failed at once (`src/services/backend.test.ts`); verify `npx vitest run src/services src/pipeline src/store` passes.

## 4. End to end

- [x] 4.1 Add `jobHeartbeatMs` to `writeTestConfig` and use a short interval in `test/job-recovery-e2e.test.ts`; the restarted-worker tests wait for the bound instead of expecting the outcome at startup. Verify the file passes after `npm run build`.
- [x] 4.2 Add an E2E: a worker runs a slow scrape whose pages take longer than the bound, `web` starts locally on the same store, and after the bound has passed the version is still RUNNING and later completes. Verified that it fails with the heartbeat disabled.
- [x] 4.3 Add an E2E: a worker crashes mid-scrape, `web` starts on the store, and the version becomes FAILED with "Job interrupted" once the bound has passed.

## 5. Docs

- [x] 5.1 Update `docs/concepts/pipeline-architecture.md`, `docs/infrastructure/deployment-modes.md` and `ARCHITECTURE.md`: interrupted means no live process shows the job alive, servers decide recent versions after the bound, and every local pipeline heartbeats; verify no doc still says `fail` marks every RUNNING or QUEUED version.

## 6. Checks

- [x] 6.1 With Node 22: `npm run lint`, `rm -f .tsbuildinfo && npm run typecheck`, `npm run build`, and `npm test`; all pass.

## Workflow follow-up

- Archive this change after review so the main `pipeline-recovery` spec includes its delta.
