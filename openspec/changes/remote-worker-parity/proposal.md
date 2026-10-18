# Proposal

## Why

A process can hand its jobs to a separate worker (`--server-url`), but it only learns what happens to
those jobs if something relays the worker's events into it. Today only the web and MCP HTTP servers set
up that relay. The CLI and the MCP server over stdio do not, so `scrape --server-url` never returned
(#530), and a remote scrape or refresh shows no progress where a local one does. No spec says what a
client of a remote worker may expect, so each entry point has settled it on its own, and two got it
wrong.

The root cause is structural. The web UI talks to its server through one client for the whole API.
The Node side reaches a worker through three hand-built clients for slices of that same API, and each
of eleven entry points assembles its own document service, pipeline and event relay, local or remote.
Only one of them remembered the relay. PR #537 makes the wait finish by asking the worker for the job's
state every second; that fixes the hang but not the missing progress, and it leaves the assembly
scattered.

The same split shows up beyond remote workers. Removing a version takes three paths: the CLI `remove`
deletes only the pages and leaves the version listed (#532); the MCP `remove_docs` tool cancels a
running job for the version and removes it, with the library when it was the last version; the web UI
removes it without cancelling the job. The `library-identity` spec already requires the version and
the emptied library to go, for every entry point.

## What Changes

- **Add a `remote-worker` capability** that defines what a process using a remote worker observes about
  the jobs it hands over: when a wait finishes and with what result, which live updates its users see,
  what happens when those updates cannot be received, and how removing a version treats the worker's
  job for it.
- **One client per worker, built like the web UI's.** All procedures and the event subscription go
  through one typed client for the API, over one HTTP link and one WebSocket. The web UI builds its
  client from the same link setup.
- **One backend for every entry point.** CLI commands, the MCP server (stdio and HTTP), the web server
  and the worker all get their document service, pipeline and event bus from one function, which
  decides local or remote from the worker URL. No entry point assembles these itself, and the backend
  owns starting and stopping them.
- **Make every client of a remote worker receive the worker's events.** A remote backend relays the
  worker's events to the local event bus, so the CLI and the MCP server over stdio receive them the same
  way the web and MCP HTTP servers do. A job is submitted only once the event stream is connected (or a
  short wait has passed), so a short job's events are not missed. Servers do not wait for the stream at
  startup.
- **Show the same progress for a remote job as for a local one.** `scrape` and `refresh` with
  `--server-url` print the same progress and status lines as without it.
- **Show only the command's own job.** A shared worker can run jobs for several clients at once. A CLI
  command reports progress and status only for the job it submitted. Today a local run never sees
  other jobs, so this rule did not matter until remote runs show progress.
- **Keep the wait safe without events.** A wait still finishes when an event is missed (the stream
  dropped and reconnected) or when the stream cannot connect at all (for example, a proxy blocks
  WebSockets). In that case the command warns once that live progress is unavailable and still
  reports the result. The once-a-second lookup from PR #537 becomes a slower safety check.
- **One removal path (#532).** The CLI `remove`, the MCP `remove_docs` tool and the web UI's delete all
  remove the same way: a queued or running job for the version is cancelled first where the entry point
  can see it (its own pipeline or a remote worker), then the version disappears from listings, and the
  library goes with its last version. The CLI's help text describes this. Two visible CLI changes come
  with it: removing an unknown library now fails with "not found" instead of reporting success, and
  error messages lose a doubled "Failed to remove" prefix.
- **Report the worker connection truthfully.** The web server's health status says whether live
  updates from the worker reach it. Today it keeps saying "connected" after the connection drops. After
  the connection returns, the web UI refreshes what it missed.
- **Report job telemetry where the job runs.** A process that relays a worker's events no longer
  reports the worker's jobs a second time.

Out of scope:

- A `--no-wait` option for `scrape` and `refresh` (suggested in #530).
- Coordinating processes that share one local store. A local CLI `remove` cannot see or cancel a job
  that another process runs on the same store, as today.
- Calling the API in local mode too. Local runs keep using the in-process services; the tools shared
  with MCP stay written against the pipeline and document-service interfaces.
- Changing which entry points ask before accepting an embedding model change. Each keeps its current
  behavior.

## Capabilities

### New Capabilities

- `remote-worker`: What a process that hands jobs to a remote worker observes about them: when waiting
  for a job finishes and with which result, which job progress and status reach it, how a CLI command
  limits that to its own job, and how it behaves when the worker's event stream is unavailable.

### Modified Capabilities

None.

- The in-progress `modernize-mcp-http-surface` change defines where a coordinator connects the worker's
  event stream (`base-path-serving`, "The worker link works under a path"). This change relies on that
  rule and extends the set of processes that connect the stream to the CLI and the MCP server over
  stdio.
- #532 brings the CLI `remove` in line with `library-identity` ("removing its last version SHALL remove
  the library"), defined by the completed but not yet archived `define-library-identity` change. The
  requirement does not change.

## Impact

- New: `src/services/apiClient.ts` (shared with the web UI, guarded by a Biome import rule) and
  `src/services/backend.ts`.
- `src/pipeline/PipelineClient.ts`, `src/store/DocumentManagementClient.ts`,
  `src/events/RemoteEventProxy.ts`: adapters over the shared client; the relay reports when it is live,
  resubscribes after errors, and triggers a refresh after a reconnect; job submission waits briefly for
  the relay; the wait settles on events with a slower safety lookup.
- Removed: `src/pipeline/PipelineFactory.ts` (not the scraper's class of the same name),
  `createDocumentManagement` and `createLocalDocumentManagement` in `src/store/index.ts`,
  `src/services/workerService.ts`.
- `src/app/AppServer.ts` and `startAppServer`: take a backend; no relay of their own; no pipeline start
  or stop; server configuration and health status come from the backend.
- All eleven CLI commands and their tests, `src/cli/main.ts`, `src/cli/services.ts`, `src/cli/utils.ts`:
  open and close a backend; no branching on `--server-url`. `scrape` and `refresh` show progress for
  their own job through a new helper in `src/cli/`.
- Removal: `src/tools/RemoveTool.ts` (optional pipeline), `src/cli/commands/remove.ts`, a `removeDocs`
  procedure in `src/services/appRouter.ts`, and the web UI hook that deletes a version.
- `src/tools/ScrapeTool.ts`, `src/tools/RefreshVersionTool.ts`: tell the caller the job id before
  waiting. `src/tools/search-provider.ts`: opens a documents-only backend.
- `src/telemetry/TelemetryService.ts`: started by a local backend with its pipeline, so jobs are reported only where they run.
- `src/web/client/main.tsx`, `src/web/client/api/hooks.ts`, `CONVENTIONS.md`.
- Tests: new unit tests for the shared client, the backend, the relay and the CLI job follower; a new
  `test/remote-worker-e2e.test.ts` for a web server in front of a worker; `test/cli-e2e.test.ts`,
  `test/library-identity-e2e.test.ts`, `test/base-path-e2e.test.ts`, `test/in-process-server.ts`, and
  the suites and eval scripts that used the removed factories.
- Docs: `ARCHITECTURE.md`, `docs/concepts/eventbus-architecture.md`,
  `docs/concepts/pipeline-architecture.md`, `docs/infrastructure/telemetry.md`, `AGENTS.md`.
- Follows PR #537 (branch `fix/530-remote-job-wait`), which merges first as the fix for #530.
- Fixes #532.
