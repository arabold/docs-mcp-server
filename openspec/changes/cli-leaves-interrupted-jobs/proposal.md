# Proposal

## Why

A local `scrape` or `refresh` starts a pipeline that marks every RUNNING or QUEUED version in the store as FAILED, as a server does at startup. When a server runs a job on the same store at that moment, the CLI marks the server's job failed while it keeps running, so the web UI and `list` show a failure that did not happen. Interrupted jobs belong to the process that hosts the store; a one-shot command runs its own job and nothing else.

## What Changes

- A pipeline's startup handling of interrupted jobs is an explicit choice: recover them, mark them failed, or leave them alone. It replaces the `recoverJobs` flag.
- The server commands keep today's behavior: `worker` and the default command recover interrupted jobs with `--resume` (the `worker` default) and mark them failed without it; `web` and `mcp` mark them failed.
- A local `scrape` and `refresh` leave interrupted jobs alone: no other version's status changes when they start.
- `mcp` and the default command started read-only leave them alone too. A read-only server runs no jobs, so several of them can serve searches beside a worker on one store without failing its running job.

## Capabilities

### New Capabilities

### Modified Capabilities

- `pipeline-recovery`: startup handling becomes a three-way choice, and a pipeline that leaves interrupted jobs alone changes no other version's status.

## Impact

- `src/pipeline/PipelineManager.ts`: the `interruptedJobs` option replaces `recoverJobs`.
- `src/services/backend.ts`: `openBackend({ jobs: { interruptedJobs } })` replaces `{ recoverJobs }`.
- `src/cli/commands/*`: server commands pass `"recover"` or `"fail"`, or `"leave"` when read-only; `scrape` and `refresh` pass `"leave"`.
- Tests and docs that name `recoverJobs`.
- A local CLI scrape that crashes leaves its version RUNNING until a server starts on the store or the version is scraped again with `--replace`; claiming a version does not depend on its status, so nothing is blocked.
