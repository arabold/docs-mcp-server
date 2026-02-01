## ADDED Requirements

### Requirement: Interrupted Job Handling When Recovery Disabled

When the PipelineManager starts with `recoverJobs: false`, it SHALL mark all versions with RUNNING or QUEUED status as FAILED with the error message "Job interrupted".

This ensures users can see the job failed and manually restart it via the Refresh button.

#### Scenario: Stuck RUNNING job marked as FAILED on startup

- **GIVEN** a version exists in the database with status RUNNING (from a previous interrupted session)
- **WHEN** PipelineManager starts with `recoverJobs: false`
- **THEN** the version status SHALL be updated to FAILED
- **AND** the error message SHALL be "Job interrupted"
- **AND** the job SHALL NOT be added to the in-memory queue

#### Scenario: Stuck QUEUED job marked as FAILED on startup

- **GIVEN** a version exists in the database with status QUEUED (from a previous interrupted session)
- **WHEN** PipelineManager starts with `recoverJobs: false`
- **THEN** the version status SHALL be updated to FAILED
- **AND** the error message SHALL be "Job interrupted"

#### Scenario: Multiple interrupted jobs all marked as FAILED

- **GIVEN** multiple versions exist with RUNNING or QUEUED status
- **WHEN** PipelineManager starts with `recoverJobs: false`
- **THEN** all interrupted versions SHALL be marked as FAILED

### Requirement: Job Recovery Using Refresh Mechanism

When the PipelineManager starts with `recoverJobs: true`, it SHALL recover interrupted jobs using the `enqueueRefreshJob()` mechanism to continue where they left off.

#### Scenario: Recover interrupted RUNNING job via refresh

- **GIVEN** a version exists with status RUNNING and has stored scraper options
- **WHEN** PipelineManager starts with `recoverJobs: true`
- **THEN** the system SHALL call `enqueueRefreshJob()` for that version
- **AND** the job SHALL be added to the in-memory queue

#### Scenario: Recover interrupted QUEUED job via refresh

- **GIVEN** a version exists with status QUEUED and has stored scraper options
- **WHEN** PipelineManager starts with `recoverJobs: true`
- **THEN** the system SHALL call `enqueueRefreshJob()` for that version

#### Scenario: Recovery failure marks job as FAILED

- **GIVEN** a version exists with status RUNNING but has no stored scraper options
- **WHEN** PipelineManager starts with `recoverJobs: true`
- **AND** `enqueueRefreshJob()` fails with an error
- **THEN** the version status SHALL be updated to FAILED
- **AND** the error message SHALL contain the failure reason
