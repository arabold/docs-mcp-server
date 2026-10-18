# Proposal

## Why

A server command that starts without `--resume` marks every RUNNING or QUEUED version in the store FAILED with "Job interrupted", and one with `--resume` scrapes them all again. Neither checks whether the process that runs the job is still alive. Starting `web` next to an embedded stdio server that is indexing, which the basic-usage guide recommends, therefore fails a job that keeps running, and a `worker` started next to a local `scrape` starts a second job on the same version. `cli-leaves-interrupted-jobs` fixed this for `scrape`, `refresh` and read-only servers by having them leave interrupted jobs alone; the servers that do handle them need to tell a job a live process runs from one a crash left behind.

## What Changes

- Every process that runs jobs on a local store shows, while it lives, that each of its unfinished jobs is alive, including a local `scrape` or `refresh`.
- A server set to recover or fail interrupted jobs acts only on versions that no process has shown alive for longer than a bound. It leaves every version a live process runs or queues as it is.
- A version that was shown alive shortly before the server started is checked again once the bound has passed: a server restarted right after a crash still recovers or fails the crashed job, a little later than today.
- A new setting, `scraper.jobHeartbeatMs`, sets how often jobs are shown alive; a version counts as interrupted after four intervals without a sign. All processes on one store should use the same value.
- The main `pipeline-recovery` spec is brought up to date: `cli-leaves-interrupted-jobs` (shipped in #546) is archived into it before this change's delta applies.

## Capabilities

### New Capabilities

### Modified Capabilities

- `pipeline-recovery`: an interrupted job is one whose version no live process shows alive, not every RUNNING or QUEUED version; failing and recovering apply to those only, and a version shown alive at startup is decided once the bound has passed.

## Impact

- `src/pipeline/PipelineManager.ts`: marks its unfinished jobs alive on an interval, and decides at startup which versions are interrupted.
- `src/store/DocumentStore.ts`, `src/store/DocumentManagementService.ts`: a statement that marks versions alive.
- `src/utils/config.ts` and `docs/setup/configuration.md`: the `scraper.jobHeartbeatMs` setting.
- No schema change: liveness uses the existing `versions.updated_at`, which every job write already bumps.
- Tests that seed a RUNNING version and expect a server to fail or recover it at once now wait for the bound, or run with a short interval.
- Docs: `docs/concepts/pipeline-architecture.md`, `docs/infrastructure/deployment-modes.md`, `ARCHITECTURE.md`.
- A server restarted right after a crash recovers or fails the crashed job up to four intervals (one minute by default) after it starts, instead of at once.
