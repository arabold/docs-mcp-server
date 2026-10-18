# Spec Delta

## Purpose

Defines what a process that hands its jobs to a remote worker observes about those jobs: when a wait
for a job finishes and with which result, which live job updates reach its users, how a CLI command
limits them to its own job, and how removing a version interacts with a job the worker is running.

## ADDED Requirements

### Requirement: A wait for a remote job ends with the worker's outcome

A process that hands a job to a remote worker and waits for it SHALL finish waiting when the worker
reports the job as finished. A completed or cancelled job SHALL end the wait successfully. A failed job
SHALL end it with an error that carries the worker's failure message. This applies to every process
that can use a remote worker, including CLI commands and the MCP server over stdio.

The wait SHALL finish whether or not live updates from the worker reach the process, including for a
job that finished before the wait began. Once the worker reports the outcome, the wait SHALL end within
a bounded delay.

The wait SHALL end with an error, rather than continue indefinitely, when the worker no longer knows the
job (for example, because finished jobs were cleared or the worker restarted) and when the worker stays
unreachable beyond a bounded period.

#### Scenario: Remote scrape returns when the worker finishes

- **GIVEN** a worker started with `docs-mcp-server worker --port 6391`
- **WHEN** `docs-mcp-server scrape react https://react.dev --server-url http://127.0.0.1:6391/api` runs
- **AND** the worker completes the job
- **THEN** the command exits with status 0
- **AND** it reports the number of pages scraped, as a local scrape does

#### Scenario: Failed remote job reports the worker's reason

- **GIVEN** a worker that rejects the job's source with "is outside the configured allowed roots"
- **WHEN** a `scrape --server-url` command waits for that job
- **THEN** the command exits with a non-zero status
- **AND** its error output contains "is outside the configured allowed roots"

#### Scenario: Job finished before the wait began

- **GIVEN** a job the worker has already completed
- **WHEN** a process starts waiting for it
- **THEN** the wait ends successfully without waiting for a further update

#### Scenario: Worker no longer knows the job

- **GIVEN** a process waiting for a job
- **WHEN** the worker's finished jobs are cleared, or the worker restarts, before the process sees the outcome
- **THEN** the wait ends with an error saying the worker no longer knows the job

#### Scenario: Worker becomes unreachable

- **GIVEN** a process waiting for a job
- **WHEN** the worker stops answering and does not come back within the bounded period
- **THEN** the wait ends with an error describing the failed connection

### Requirement: Users of a remote worker see its jobs live

A process that uses a remote worker SHALL show its users the worker's jobs as they change, as it would
for jobs it runs itself:

- A CLI command SHALL show the same status and progress lines for a remote job as for a local one,
  under the diagnostic rules of `cli-output` (shown in an interactive run or with diagnostics enabled).
  A job's first updates SHALL NOT be lost because the job started immediately after it was submitted.
- The web UI SHALL update its job and library views as the worker's jobs change. After the connection
  to the worker drops and returns, it SHALL catch up without a page reload.
- The web server's health status SHALL report the connection to the worker as down while live updates
  cannot reach it, and as up once they can again. This corrects today's behavior, which keeps
  reporting a dropped connection as up.

When the worker answers requests but its live updates cannot be received (for example, a reverse proxy
blocks WebSockets), the process SHALL keep working. A CLI command SHALL warn once that live progress is
unavailable, under the same diagnostic rules, SHALL show no progress lines, and SHALL still finish with
the job's outcome.

#### Scenario: Remote scrape shows the same progress as a local scrape

- **GIVEN** an interactive terminal
- **WHEN** `docs-mcp-server scrape react https://react.dev --server-url http://127.0.0.1:6391/api` runs
- **THEN** it shows the status line for the job starting
- **AND** it shows progress lines with the pages processed out of the pages expected
- **AND** the lines read the same as for `docs-mcp-server scrape react https://react.dev` without a worker

#### Scenario: A job that starts at once still shows its start

- **GIVEN** an idle worker that starts a job the moment it is submitted
- **WHEN** a `scrape --server-url` command submits the job in an interactive terminal
- **THEN** the command shows the status line for the job starting

#### Scenario: The web UI catches up after the worker connection returns

- **GIVEN** a web server using a remote worker, with the web UI open on the jobs page
- **WHEN** the connection to the worker drops, a job finishes on the worker in the meantime, and the connection returns
- **THEN** the web UI shows the job as finished without a reload
- **AND** the health status reports the worker as disconnected during the drop and as connected afterwards

#### Scenario: Live updates blocked

- **GIVEN** a worker whose HTTP API is reachable but whose live updates are not
- **WHEN** a `scrape --server-url` command runs in an interactive terminal
- **THEN** it warns once that live progress from the worker is unavailable
- **AND** it shows no progress lines
- **AND** it exits with the job's outcome, as in "A wait for a remote job ends with the worker's outcome"

### Requirement: A command reports only its own job

A worker can run jobs for several clients at once. A CLI command that submits a job SHALL show
status and progress only for the job it submitted. Updates about other jobs on the same worker SHALL
NOT appear in its output.

#### Scenario: Two clients share a worker

- **GIVEN** one client scraping `react` and another scraping `vue` through the same worker at the same time
- **WHEN** both commands run
- **THEN** the `react` command shows status and progress lines for `react` only
- **AND** the `vue` command shows status and progress lines for `vue` only

### Requirement: Removing a version cancels the worker's job for it first

When a version is removed through a process that uses a remote worker, from the CLI, the MCP tools or
the web UI, and the worker has a queued or running job for that version, the job SHALL be cancelled and
the removal SHALL take place after the job has ended. The removal itself SHALL follow `library-identity`:
the version is no longer listed, and the library goes with its last version.

#### Scenario: CLI removes a version the worker is scraping

- **GIVEN** a worker scraping `react` version `19.0`
- **WHEN** `docs-mcp-server remove react --version 19.0 --server-url http://127.0.0.1:6391/api` runs
- **THEN** the worker's job for `react@19.0` ends as cancelled
- **AND** the command exits with status 0
- **AND** `react@19.0` is no longer listed, and `react` is not listed if it held no other version

#### Scenario: Web UI deletes a version the worker is scraping

- **GIVEN** a web server using a remote worker that is scraping `react` version `19.0`
- **WHEN** a user deletes `react@19.0` in the web UI
- **THEN** the worker's job for `react@19.0` ends as cancelled before the version is removed
