# Design

## Context

`PipelineManager.start()` applies the `interruptedJobs` policy once, to every version whose status is RUNNING or QUEUED (`getVersionsByStatus`). Nothing in the store says which process runs a version's job, so `recover` and `fail` cannot tell a crashed job from one a live process runs. See proposal.md for the cases this breaks.

What the store already has: `versions.updated_at`, which every status, progress and scraper-options write sets to `CURRENT_TIMESTAMP`, and an `AFTER UPDATE` trigger (`versions_updated_at`, migration 005) that sets it again on any update of the row. Both use SQLite's `CURRENT_TIMESTAMP`, so the column has one-second resolution: any write, whatever value it sets, ends with `updated_at` truncated to the second.

## Goals / Non-Goals

**Goals:**

- A server set to `recover` or `fail` changes no version whose job a live process runs or queues, including a local `scrape`, another server, and that server's own jobs enqueued before `start()`.
- A crashed job is still recovered or failed by the next server, even one started right after the crash.

**Non-Goals:**

- Handling jobs that a process abandons while a server is already running. As today, interrupted jobs are decided when a server starts, and only the versions interrupted at that moment are watched.
- Several workers on one store, or a store on a network volume (see deployment-modes.md).
- Changing `leave`: those commands still never touch another version.

## Decisions

### Heartbeat on `versions.updated_at`, no schema change

Each started `PipelineManager` bumps `updated_at` of the versions of its unfinished jobs (QUEUED, RUNNING, CANCELLING) every `scraper.jobHeartbeatMs`. A version is interrupted when its `updated_at` is older than four intervals.

The column already means "the job last wrote this version", and every job write bumps it, so a heartbeat only fills the gaps: a QUEUED job waiting for a slot, or a page that takes long to fetch, render or embed. The UI's "last indexed" reads the same column; it already moves with every progress write while a job runs, and the final status write sets it at the end, so heartbeats change nothing a user sees after the job.

Alternatives:

- **An owner column with host and PID.** Detects a dead owner on the same host at once, with no wait after a restart. It needs a migration, and a PID check is wrong across PID namespaces: two containers that share a volume see each other's PIDs as missing (failing live jobs) or as their own PID 1 (keeping dead ones). It still needs a heartbeat for owners on other hosts or containers, so it adds a mechanism instead of replacing one.
- **Acting only on versions not updated for a while, without a heartbeat.** A QUEUED job in a live process writes nothing until it starts, which can take hours behind a long crawl, so it would still be failed.
- **A lock file per process.** Node has no portable advisory lock; lock-file libraries keep a lock alive with an mtime heartbeat, which is this design with a second store.

### Four intervals, plus one second for the timestamp resolution

Interrupted means silent for more than `4 × jobHeartbeatMs + 1000` ms, measured as `Date.now()` minus the parsed `updated_at` (UTC). The extra second covers the truncation: a stored timestamp can be up to one second older than the write, so a live process's version can look up to one interval plus one second silent. Four intervals tolerate missed heartbeats while the event loop is blocked; `better-sqlite3` writes are synchronous and wait up to `busy_timeout` (30 s) for a lock, which the default bound (61 s) covers.

The default interval is 15 s: one small `UPDATE` per process per interval, and a server started right after a crash decides the crashed job about a minute later.

`scraper.jobHeartbeatMs` is validated as a positive integer. All processes on a store should share it; a checker with a shorter bound than the owner's heartbeat could fail a live job. The docs say so, and the setting is aimed at tests and unusual deployments.

### Decide twice: at start, and once the bound has passed

`start()` reads the RUNNING and QUEUED versions and splits them:

1. Versions of this manager's own unfinished jobs: never interrupted. This also settles the `it.todo` about jobs enqueued before `start()`.
2. Silent past the bound: handled at once, before the queue starts, as today.
3. Recently alive: recorded by version id, and checked again by a timer that fires one bound plus one second after `start()`. The check reads them again; those still RUNNING or QUEUED and now silent past the bound are handled, the rest are left to the process that runs them and are not watched further.

A single check suffices: a version that was alive at start and is alive again at the re-check has a live owner, and if that owner crashes later the next server start handles it, as today.

Handling is the same function in both phases: `recover` enqueues a refresh job (marking the version FAILED when that fails), `fail` marks it FAILED with "Job interrupted".

### Every local pipeline heartbeats, whatever its policy

`leave` pipelines (`scrape`, `refresh`) run jobs too, and a server starting next to them must see those jobs alive. Read-only servers start a pipeline with no jobs, so their heartbeat writes nothing.

## Program Design

### Files

```
src/pipeline/
~ PipelineManager.ts        # heartbeat timer; start() splits interrupted versions and re-checks the recent ones once
~ PipelineManager.test.ts   # abandoned vs recently alive versions, own jobs, heartbeat
src/store/
~ DocumentStore.ts          # markVersionsAlive statement
~ DocumentStore.test.ts     # it bumps updated_at of queued/running versions only
~ DocumentManagementService.ts  # passes markVersionsAlive through
src/utils/
~ config.ts                 # scraper.jobHeartbeatMs
src/services/
~ backend.test.ts           # seeded RUNNING version is abandoned (fake Date) before expecting FAILED
test/
~ test-helpers.ts           # writeTestConfig({ jobHeartbeatMs })
~ job-recovery-e2e.test.ts  # web beside a live job; web after a crash; restarted workers wait for the bound
docs/
~ setup/configuration.md
~ concepts/pipeline-architecture.md
~ infrastructure/deployment-modes.md
~ ARCHITECTURE.md
openspec/specs/pipeline-recovery/spec.md  # cli-leaves-interrupted-jobs, then this change, archived into it
```

### Signatures

```ts
// DocumentStore and DocumentManagementService
/**
 * Marks versions alive by setting updated_at to now, for those still QUEUED
 * or RUNNING. Throws StoreError when the write fails.
 */
markVersionsAlive(versionIds: number[]): Promise<void>;

// PipelineManager (private)
private heartbeatTimer: NodeJS.Timeout | undefined;
private recheckTimer: NodeJS.Timeout | undefined;
private markJobsAlive(): Promise<void>;           // logs a failed write at warn, never throws
private handleInterruptedJobs(): Promise<void>;    // replaces the policy branches in start()
private handleInterrupted(versions: DbVersionWithLibrary[]): Promise<void>; // recover or fail, per policy
```

`recoverPendingJobs()` and `markInterruptedJobsAsFailed()` have no callers outside `PipelineManager` and fold into `handleInterrupted`.

### Call order

```
PipelineManager.start()
+   handleInterruptedJobs()                      # skipped for "leave"
+     store.getVersionsByStatus([RUNNING, QUEUED])
+     skip versions of this.jobMap's unfinished jobs
+     handleInterrupted(silent past the bound)   # awaited, before the queue starts
+     recheckTimer = setTimeout(bound + 1s)      # only when recent versions exist; unref'd
+       store.getVersionsByStatus(...) ∩ recent ids
+       handleInterrupted(those silent past the bound now)
+   heartbeatTimer = setInterval(markJobsAlive, jobHeartbeatMs)  # unref'd
    _processQueue()

PipelineManager.stop()
+   clear heartbeatTimer and recheckTimer
```

Both timers are `unref()`'d so a one-shot command exits when its job is done, and `stop()` clears them so a stopped manager neither writes nor decides.

## Risks / Trade-offs

- [A server restarted right after a crash shows the crashed version RUNNING for up to a minute before recovering or failing it] → Documented; versions abandoned longer ago are still handled at start.
- [A live process whose event loop is blocked for over a minute can have its job failed or recovered by a server starting then] → Four missed intervals plus the busy timeout margin; today such a job is failed unconditionally.
- [Processes with different `jobHeartbeatMs` on one store] → Documented: use one value per store.
- [An older release on the same store does not heartbeat] → A new server treats its jobs as interrupted once they are silent past the bound, which is no worse than today.
- [Heartbeat writes contend for the SQLite write lock] → One small indexed `UPDATE` per process per interval, and only while jobs exist.

## Migration Plan

No migration. Rolling back restores the old startup behavior; heartbeats leave nothing behind beyond `updated_at` values.
