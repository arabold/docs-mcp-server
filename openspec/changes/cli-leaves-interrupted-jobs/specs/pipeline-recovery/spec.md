# Spec Delta

## MODIFIED Requirements

### Requirement: Interrupted Job Handling When Recovery Disabled

When the PipelineManager starts set to mark interrupted jobs failed, it SHALL mark all versions with RUNNING or QUEUED status as FAILED with the error message "Job interrupted".

This ensures users can see the job failed and manually restart it via the Refresh button. Server commands started without job recovery use this setting.

#### Scenario: Stuck RUNNING job marked as FAILED on startup

- **GIVEN** a version exists in the database with status RUNNING (from a previous interrupted session)
- **WHEN** PipelineManager starts set to mark interrupted jobs failed
- **THEN** the version status SHALL be updated to FAILED
- **AND** the error message SHALL be "Job interrupted"
- **AND** the job SHALL NOT be added to the in-memory queue

#### Scenario: Stuck QUEUED job marked as FAILED on startup

- **GIVEN** a version exists in the database with status QUEUED (from a previous interrupted session)
- **WHEN** PipelineManager starts set to mark interrupted jobs failed
- **THEN** the version status SHALL be updated to FAILED
- **AND** the error message SHALL be "Job interrupted"

#### Scenario: Multiple interrupted jobs all marked as FAILED

- **GIVEN** multiple versions exist with RUNNING or QUEUED status
- **WHEN** PipelineManager starts set to mark interrupted jobs failed
- **THEN** all interrupted versions SHALL be marked as FAILED

### Requirement: Job Recovery Using Refresh Mechanism

When the PipelineManager starts set to recover interrupted jobs, it SHALL recover them using the `enqueueRefreshJob()` mechanism to continue where they left off.

#### Scenario: Recover interrupted RUNNING job via refresh

- **GIVEN** a version exists with status RUNNING and has stored scraper options
- **WHEN** PipelineManager starts set to recover interrupted jobs
- **THEN** the system SHALL call `enqueueRefreshJob()` for that version
- **AND** the job SHALL be added to the in-memory queue

#### Scenario: Recover interrupted QUEUED job via refresh

- **GIVEN** a version exists with status QUEUED and has stored scraper options
- **WHEN** PipelineManager starts set to recover interrupted jobs
- **THEN** the system SHALL call `enqueueRefreshJob()` for that version

#### Scenario: Recovery failure marks job as FAILED

- **GIVEN** a version exists with status RUNNING but has no stored scraper options
- **WHEN** PipelineManager starts set to recover interrupted jobs
- **AND** `enqueueRefreshJob()` fails with an error
- **THEN** the version status SHALL be updated to FAILED
- **AND** the error message SHALL contain the failure reason

## ADDED Requirements

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
