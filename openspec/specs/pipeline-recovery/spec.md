# pipeline-recovery Specification

## Purpose
Defines how interrupted scrape jobs are handled at PipelineManager startup, including fail-marking and recovery mechanisms.

## Requirements

### Requirement: Interrupted Job Handling When Recovery Disabled

When the PipelineManager starts set to mark interrupted jobs failed, it SHALL mark every interrupted version (a RUNNING or QUEUED version no process has shown alive for four heartbeat intervals) as FAILED with the error message "Job interrupted".

This ensures users can see the job failed and manually restart it via the Refresh button. Server commands started without job recovery use this setting.

#### Scenario: Stuck RUNNING job marked as FAILED on startup

- **GIVEN** a version exists in the database with status RUNNING from a previous interrupted session, and no process has shown it alive for four intervals
- **WHEN** PipelineManager starts set to mark interrupted jobs failed
- **THEN** the version status SHALL be updated to FAILED
- **AND** the error message SHALL be "Job interrupted"
- **AND** the job SHALL NOT be added to the in-memory queue

#### Scenario: Stuck QUEUED job marked as FAILED on startup

- **GIVEN** a version exists in the database with status QUEUED from a previous interrupted session, and no process has shown it alive for four intervals
- **WHEN** PipelineManager starts set to mark interrupted jobs failed
- **THEN** the version status SHALL be updated to FAILED
- **AND** the error message SHALL be "Job interrupted"

#### Scenario: Multiple interrupted jobs all marked as FAILED

- **GIVEN** multiple interrupted versions exist with RUNNING or QUEUED status
- **WHEN** PipelineManager starts set to mark interrupted jobs failed
- **THEN** all interrupted versions SHALL be marked as FAILED

### Requirement: Job Recovery Using Refresh Mechanism

When the PipelineManager starts set to recover interrupted jobs, it SHALL recover every interrupted version using the `enqueueRefreshJob()` mechanism to continue where it left off.

#### Scenario: Recover interrupted RUNNING job via refresh

- **GIVEN** an interrupted version exists with status RUNNING and has stored scraper options
- **WHEN** PipelineManager starts set to recover interrupted jobs
- **THEN** the system SHALL call `enqueueRefreshJob()` for that version
- **AND** the job SHALL be added to the in-memory queue

#### Scenario: Recover interrupted QUEUED job via refresh

- **GIVEN** an interrupted version exists with status QUEUED and has stored scraper options
- **WHEN** PipelineManager starts set to recover interrupted jobs
- **THEN** the system SHALL call `enqueueRefreshJob()` for that version

#### Scenario: Recovery failure marks job as FAILED

- **GIVEN** an interrupted version exists with status RUNNING but has no stored scraper options
- **WHEN** PipelineManager starts set to recover interrupted jobs
- **AND** `enqueueRefreshJob()` fails with an error
- **THEN** the version status SHALL be updated to FAILED
- **AND** the error message SHALL contain the failure reason

### Requirement: One-Shot Commands Leave Interrupted Jobs Alone

A local one-shot command that runs a job (`scrape`, `refresh`), and a server started read-only, SHALL start its pipeline set to leave interrupted jobs alone: it SHALL NOT change the status of any version other than one its own job works on, and SHALL NOT recover other versions. The process that runs jobs on the store handles interrupted ones.

#### Scenario: CLI scrape while a server runs a job on the same store

- **GIVEN** a version has status RUNNING because another process is scraping it
- **WHEN** a local `scrape` of a different library starts and finishes on the same store
- **THEN** the other version's status SHALL still be RUNNING

#### Scenario: CLI refresh leaves an interrupted job for the server

- **GIVEN** a version has status QUEUED from an interrupted session
- **WHEN** a local `refresh` of a different version runs on the same store
- **THEN** the interrupted version's status SHALL still be QUEUED
- **AND** the version SHALL NOT be recovered by the command

#### Scenario: Read-only server beside a worker

- **GIVEN** a version has status RUNNING because a worker on the same store is scraping it
- **WHEN** `mcp` or the default command starts read-only on that store
- **THEN** the version's status SHALL still be RUNNING

#### Scenario: Server commands still handle interrupted jobs

- **GIVEN** a version has status RUNNING from an interrupted session
- **WHEN** a server command (`worker`, `web`, `mcp`, or the default command) starts on the store, not read-only
- **THEN** it SHALL recover the version when started with `--resume` (`worker` and the default command offer it), and otherwise mark it FAILED with "Job interrupted"

### Requirement: Running Jobs Show That They Are Alive

While a process runs or queues jobs on a store, it SHALL show that each of them is alive at least once per heartbeat interval, until the job ends or the process exits. The interval is set by `scraper.jobHeartbeatMs` in milliseconds (default 15000). A RUNNING or QUEUED version is interrupted when no process has shown it alive for four intervals.

#### Scenario: A job between progress updates stays alive

- **GIVEN** a process runs a job that stores no page for longer than four intervals
- **WHEN** a server starts on the same store set to mark interrupted jobs failed
- **THEN** the version SHALL still be RUNNING four intervals later

#### Scenario: A job waiting for a free slot stays alive

- **GIVEN** a process holds a job QUEUED behind its concurrency limit for longer than four intervals
- **WHEN** a server starts on the same store set to mark interrupted jobs failed
- **THEN** the version SHALL still be QUEUED four intervals later

### Requirement: Servers Leave Jobs That Live Processes Run

A server that starts set to recover or mark failed interrupted jobs SHALL act only on interrupted versions and SHALL leave every version a live process runs or queues as it is. It SHALL decide on a version that was shown alive less than four intervals before it started once four intervals have passed since that sign: interrupted then, the server recovers or fails it; otherwise the server leaves it to the process that runs it.

#### Scenario: Web UI beside a process that is indexing

- **GIVEN** another process, such as an embedded stdio server or a worker, is scraping a library on a store
- **WHEN** `web` starts on the same store and runs for longer than four intervals
- **THEN** the version SHALL still be RUNNING
- **AND** the other process's job SHALL still be running

#### Scenario: Server restarted right after a crash

- **GIVEN** a worker crashed while scraping a version, which it showed alive one second before
- **WHEN** a worker starts on the store with job recovery
- **THEN** it SHALL scrape the version again once four intervals have passed since the crashed worker last showed it alive

#### Scenario: Version abandoned long ago

- **GIVEN** a version is RUNNING and no process has shown it alive for an hour
- **WHEN** a server starts on the store set to mark interrupted jobs failed
- **THEN** it SHALL mark the version FAILED with "Job interrupted" while it starts

#### Scenario: Two servers start after a crash

- **GIVEN** a version is RUNNING and no process has shown it alive for an hour
- **WHEN** a worker with job recovery and `web` start on the store at the same time
- **THEN** only one of them SHALL act on the version: the worker recovers it or `web` marks it FAILED
