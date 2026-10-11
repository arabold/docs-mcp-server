# Design

## Context

See proposal.md (Why). The current state that shapes the approach:

**One API, four hand-built clients**
- A worker serves the merged `AppRouter` (`src/services/appRouter.ts`) at `/api`: health, pipeline and
  data procedures flattened at the root, plus `events.subscribe`.
- The web UI talks to its server through one client for that router (`src/web/client/main.tsx`):
  `httpBatchLink` for queries and mutations, one `wsLink` for subscriptions. It never knows whether the
  server runs jobs itself or hands them to a worker.
- The Node side reaches a worker through three separate clients, each typed against a slice of the
  router:
  - `PipelineClient`: `PipelineRouter`, HTTP plus a WebSocket that carries nothing. tRPC 11.18 connects
    eagerly unless `lazy` is set, so the socket opens anyway.
  - `DocumentManagementClient`: `DataRouter`, HTTP.
  - `RemoteEventProxy`: untyped (`as any`), its own HTTP link and WebSocket, subscribes to all events
    and re-emits them on the local `EventBusService`.
- `toWebSocketUrl` lives in `src/utils/url.ts`, which imports `psl` and MIME helpers. The web UI derives
  its WebSocket URL with its own string replace. The browser already imports runtime values from
  `src/{events,pipeline,store,scraper}/types`, but nothing that builds a client.

**Every entry point assembles its own backend**
- 10 `PipelineFactory.createPipeline` calls (`default` 1, `mcp` 2, `refresh` 2, `scrape` 2, `web` 2,
  `worker` 1) and 13 document-service constructions (`createDocumentManagement`,
  `createLocalDocumentManagement`, direct constructors) across eleven commands and
  `src/tools/search-provider.ts`. `mcp.ts` builds its remote document client by hand. The command
  tests, `src/index.test.ts`, `test/in-process-server.ts`, several E2E suites and
  `tests/search-eval/preflight.ts` use or mock these factories.
- Only `AppServer` creates a `RemoteEventProxy` (when `externalWorkerUrl` is set) and connects it in the
  background after `listen()`. The CLI and `mcp` over stdio do not relay, which is #530.
- `web` and `mcp` decide `enableWorker: !serverUrl` and `externalWorkerUrl: serverUrl` themselves;
  `systemInfo` derives the worker mode from that config.
- The web server's health (`getSystemHealth`, served with the API) reports `worker.connected` from
  `remoteEventProxy.isActive()`. `mcp` over HTTP runs without the API and has no health report.
- Pipeline lifecycle has three owners. `AppServer.enableWorker()` starts an embedded pipeline through
  `registerWorkerService()` and `stop()` stops it; recovery runs before `listen()`. `mcp`/`default` over
  stdio and CLI `scrape`/`refresh` start it themselves. `main.ts` stops the registered pipeline only
  when no `AppServer` is running.
- A remote entry point already needs the worker at startup: `DocumentManagementClient.initialize()` and
  `PipelineClient.start()` ping it and throw.
- `default` and `mcp` handle `EmbeddingModelChangedError` with `handleEmbeddingModelChange()`. The other
  local entry points let the error propagate.
- Starting a `PipelineManager` with `recoverJobs: false` marks every running or queued version as failed
  ("Job interrupted", `pipeline-recovery`). Read-only commands never create a pipeline today.

**The relay's connection state**
- tRPC's WebSocket client reconnects after a dropped connection and resends pending subscriptions; the
  server answers each with `started`, so `onStarted` fires again. `onConnectionStateChange` reports
  `connecting` during a drop.
- A subscription-level error ends the subscription; tRPC does not resend it. `RemoteEventProxy` handles
  `onError` by building a new WebSocket client after 5 seconds, without closing the old one.
- A dropped connection fires neither `onError` nor `onComplete`, so `isActive()`, and with it the
  health report, stays `true` while the worker is unreachable.
- Events missed while disconnected are lost: the events router streams live events only. The web UI
  refetches on `JOB_LIST_CHANGE` and `LIBRARY_CHANGE`; nothing triggers a refetch after a reconnect.

**Three removal paths (#532)**
- CLI `remove`: `docService.removeAllDocuments()`, pages only; the version stays listed.
- MCP `remove_docs`: `RemoveTool` checks the library exists, cancels a queued or running job for the
  version, waits, then calls `removeVersion()` (version, and the library with its last version).
- Web UI delete: `trpc.removeVersion`, the data router's raw `docService.removeVersion()`, with no job
  cancel.
- The CLI's `--version` help says "removes latest if omitted"; all paths remove the unversioned
  documentation (`normalizeVersionLabel(undefined) === ""`).

**Telemetry**
- Every CLI process creates a `TelemetryService` on the global bus (`src/cli/index.ts`), which reports
  `PIPELINE_JOB_*` for any `JOB_STATUS_CHANGE` it sees. A coordinator relaying a worker's events
  therefore reports the worker's jobs a second time.

**CLI output**
- `scrape.ts` and `refresh.ts` subscribe to `JOB_PROGRESS` and `JOB_STATUS_CHANGE` only without
  `--server-url`, and do not filter by job. `RUNNING` can reach the bus before the enqueue call returns
  the job id, locally and remotely; within one source `RUNNING` precedes that job's progress.
- Without a TTY the CLI's default log level is `ERROR` (`src/cli/output.ts`), so status, progress and
  warnings are hidden unless `--verbose` or `LOG_LEVEL` asks for them.

**The wait (PR #537)**
- `PipelineClient.waitForJobCompletion()` settles on a relayed `JOB_STATUS_CHANGE` or on `getJob`,
  called right away and then every second, and gives up after five failed lookups in a row.

## Goals / Non-Goals

**Goals:**
- One client per worker URL, built from the same link setup as the web UI's.
- One function that gives every entry point its document service, pipeline and event bus, local or
  remote, with the same guarantees, and that owns their lifecycle.
- No entry point branches on the worker URL to assemble services, configure the server, or decide
  whether it gets events.
- One removal path for every entry point.

**Non-Goals:**
- Calling tRPC procedures in local mode. The tools shared with MCP stay written against `IPipeline` and
  `IDocumentManagement`.
- Changing which local entry points handle an embedding model change; each keeps its choice.
- Filtering events on the worker. Only CLI commands narrow to their own job, locally.
- A health report for `mcp` over HTTP.
- Authenticating the worker link.
- Coordinating processes that share one local store.

## Decisions

### 1. One API client per worker URL, shared link setup with the web UI

A new isomorphic module `src/services/apiClient.ts`:

- `createApiLinks(apiUrl, { subscriptions })` returns the `AppRouter` links and a `close()` for the
  WebSocket. With `subscriptions: true` it builds `httpBatchLink` plus a `wsLink` over a WebSocket
  client with tRPC `keepAlive` enabled, so a half-open connection is noticed. With `false` it builds
  `httpBatchLink` only and opens no WebSocket. No `lazy` mode: its required `closeMs` re-arms a timer
  for as long as a subscription is pending.
- `createApiClient(apiUrl, { subscriptions })` wraps those links in a typed `TRPCClient<AppRouter>`.
- `toWebSocketUrl()` moves here from `src/utils/url.ts`.

The web UI builds its React client from `createApiLinks(…, { subscriptions: true })`.
`PipelineClient` and `DocumentManagementClient` become adapters over an `ApiClient`, and
`RemoteEventProxy` subscribes through the typed `api.events.subscribe`. The module imports only
`@trpc/client`, `superjson` and `AppRouter` as a type; a Biome `noRestrictedImports` override on the
file enforces that, and `src/web/client/CONVENTIONS.md` lists it next to the shared type modules.

Alternatives considered:
- *Keep three clients and fix the relay only.* Fixes events but keeps two WebSockets per process,
  untyped events, and URL handling in three places.
- *One `RemoteBackend` class implementing both interfaces.* Merges two large, unrelated interfaces for
  no gain over adapters on a shared client.
- *Keep the web UI's link setup separate.* Same API and URL rules; two copies drift, as the base-path
  work showed for the worker URL.

### 2. One backend factory for every entry point

`openBackend()` in `src/services/backend.ts` returns a `Backend`: document service, pipeline (when
asked for), event bus, mode, worker URL, worker connection state, and `close()`. It decides local or
remote from `serverUrl`; callers do not.

| `jobs` | Local | Remote |
|---|---|---|
| `false` (default) | no pipeline | no pipeline, HTTP only |
| `{ recoverJobs }` | `PipelineManager`, started | `PipelineClient` and relay; `recoverJobs` ignored (the worker owns recovery) |

- **Local:** `DocumentManagementService` (calling `onEmbeddingModelChange` on
  `EmbeddingModelChangedError`, rethrowing otherwise), plus a started `PipelineManager` for
  `{ recoverJobs }`.
- **Remote:** one API client (with a WebSocket only when `jobs` is not `false`); ping, failing with
  today's URL hint; `DocumentManagementClient`; for `{ recoverJobs }` a `PipelineClient` and the
  relay, which starts connecting in the background (decision 3).

Read-only commands (`list`, `search`, `find-version`, `compact`, the eval search provider) and the CLI
`remove` use `false`: no pipeline, so no other process's jobs are marked interrupted, and no WebSocket.
Locally the command's own process runs no jobs; remotely the worker cancels its own job when it removes
the version (decision 7).

`openBackend()` overloads return a `JobsBackend` (pipeline required) for `{ recoverJobs }`, which is what
`startAppServer()` takes. Whether jobs run in the server's process comes from the backend:
`AppServerConfig` loses `enableWorker` and `externalWorkerUrl`, and `AppServer` and `buildSystemInfo`
read `backend.mode` and `backend.workerUrl`, so `web` and `mcp` no longer derive either from
`--server-url`. `IPipeline` and `IDocumentManagement` lose their lifecycle methods
(`start`/`stop`, `initialize`/`shutdown`), which only the backend calls, on the concrete classes.

`PipelineFactory` (`src/pipeline/PipelineFactory.ts`; the scraper's `src/scraper/pipelines/PipelineFactory.ts`
is unrelated and stays), `createDocumentManagement` and `createLocalDocumentManagement` are removed.

Alternatives considered:
- *Keep the factories and add the relay to `PipelineClient`.* Each entry point still assembles its own
  services; the next one can again forget a piece.
- *Always create a pipeline.* Would start a `PipelineManager` for `list`, failing jobs a running server
  owns.

### 3. The pipeline client guarantees events before the first job

The relay starts connecting when the backend opens and never blocks opening, so `web` and `mcp` start
as fast as today. The guarantee moves to where it matters: `PipelineClient`'s enqueue methods await the
relay's current connection attempt, bounded by `EVENTS_CONNECT_TIMEOUT_MS` (5 s), before submitting.
When the bound passes, the client logs one warning that live job updates are unavailable and that waits
fall back to checking the job's state, then submits. A job submitted through a remote pipeline
therefore cannot lose its first events while the stream is up, whichever entry point submits it.

The relay keeps one subscription on the shared client:

- Connection drops: tRPC reconnects and resubscribes.
- `onError`, or `onComplete` without a `disconnect()`: the relay resubscribes on the same client with
  backoff. It never builds a second WebSocket client.
- Live state: `onStarted` sets it; `onConnectionStateChange` to `connecting`, `onError` and
  `onComplete` clear it. `isActive()` returns it and backs `worker.connected`, which now reads `false`
  during a drop.
- When the relay becomes live again after having been live, it emits `JOB_LIST_CHANGE` and
  `LIBRARY_CHANGE` on the local bus, so the web UI and its health view refetch what they missed.
- It logs transitions only: one warning when a live stream is lost, one info line when it is back;
  attempts at debug level.

### 4. The wait settles on events, with an adaptive safety lookup

`PipelineClient.waitForJobCompletion()` keeps the PR #537 structure (listener, immediate `getJob`,
periodic lookups) and reads the relay's state at each scheduling:

- live: look up every `JOB_SAFETY_LOOKUP_INTERVAL_MS` (10 s), to catch an event lost around a reconnect.
- not live: every `JOB_POLL_INTERVAL_MS` (1 s), covering a reconnect gap or a stream that never
  connects.

Giving up changes from "five failed lookups in a row" to "no successful lookup for
`JOB_LOOKUP_GIVE_UP_MS` (30 s)", because a count means a different duration at each interval. The
immediate lookup also covers a job that finished before the relay connected.

Alternative considered: *re-check pending waits when the subscription restarts and skip periodic
lookups while live.* Needs a callback into every wait and still misses an event lost without a visible
reconnect.

### 5. The backend owns the lifecycle

`openBackend()` starts what it creates. If a step fails, it closes what it already opened and rethrows.
`Backend.close()` stops in reverse order (relay, pipeline, document service, API client), runs every
step even when one throws, logs each failure, rejects with the first, and does nothing on a second call.

`AppServer` receives a `JobsBackend`, serves it, and no longer starts or stops the pipeline or creates a
relay; `registerWorkerService()`/`stopWorkerService()` and `workerService.ts` are removed. Recovery
still runs before `listen()`, because `openBackend()` returns before `startAppServer()` is called.
`main.ts` keeps one registered backend and closes it after the `AppServer` or stdio server has stopped,
on SIGINT and on normal exit alike.

### 6. CLI commands follow their own job

A `JobOutputFollower` in `src/cli/` subscribes to `JOB_STATUS_CHANGE` and `JOB_PROGRESS` before the job
is submitted and buffers what arrives. `follow(jobId)` replays the buffered events for that job in
order, drops the rest, and from then on passes only that job's events to the command's formatter.
`scrape` and `refresh` use it in both modes, so local and remote output come from the same code. The
job id comes from a new `onJobEnqueued` option on `ScrapeTool` and `RefreshVersionTool`, called right
after enqueueing and before waiting.

Alternative considered: *filter by library and version.* Two clients can address one library under
different spellings, and a refresh and a scrape of one version can overlap; the job id is exact.

### 7. One removal path: `RemoveTool` (#532)

The CLI `remove`, the MCP `remove_docs` tool and the web UI all remove through `RemoveTool`:

- CLI: opens a documents-only backend and calls `RemoveTool`, which has no pipeline and skips the cancel
  step. Locally the process runs no jobs. Against a worker, `DocumentManagementClient.removeVersion`
  calls the worker's `removeDocs`, so the worker cancels its own job and removes the version in one call.
- Web UI: calls a new app-router procedure, `removeDocs`, which runs `RemoveTool` with the request
  context's document service and pipeline. A coordinator's pipeline is its `PipelineClient`, so the
  cancel reaches the worker.
- The data router's `removeVersion` stays the raw store operation; neither the web UI nor the remote
  client calls it any more.

Visible CLI changes: an unknown library now fails with "not found" (`RemoveTool` checks it exists)
instead of reporting success, and `remove.ts` prints `RemoveTool`'s error as is instead of wrapping it
in a second "Failed to remove" prefix. The `--version` help says an omitted version means the
unversioned documentation, and the command description says the version is removed, and the library
with its last version.

Alternative considered: *switch the CLI to `removeVersion()` directly.* Fixes #532 but leaves two
paths without the job cancel.

### 8. Telemetry reports a job where it runs

`TelemetryService` gains `setJobTracking(enabled)`. `registerGlobalServices({ backend })` enables it only
for a local backend with a pipeline. The worker reports its own jobs; a CLI or coordinator relaying
them no longer reports them again. This also ends today's double reporting by coordinators.

Alternative considered: *mark relayed events on the bus.* Changes the event payloads and every
listener's contract for one consumer's sake.

## Program Design

### Files

```
biome.json                      # ~ noRestrictedImports override for src/services/apiClient.ts
src/services/
+ apiClient.ts                  # isomorphic links, client, toWebSocketUrl
+ apiClient.test.ts
+ backend.ts                    # openBackend(), Backend, JobsBackend
+ backend.test.ts
~ appRouter.ts                  # removeDocs procedure running RemoveTool
- workerService.ts              # lifecycle moves to the backend
src/pipeline/
~ PipelineClient.ts             # adapter; enqueue awaits the relay; adaptive wait
~ PipelineClient.test.ts
- PipelineFactory.ts            # replaced by openBackend()
- PipelineFactory.test.ts       # cases move to backend.test.ts
~ index.ts                      # stops exporting PipelineFactory
src/store/
~ DocumentManagementClient.ts   # adapter over the API client
~ index.ts                      # factories removed
src/events/
~ RemoteEventProxy.ts           # typed subscription; live state; resubscribe on error; catch-up events
+ RemoteEventProxy.test.ts
src/telemetry/
~ TelemetryService.ts           # setJobTracking()
~ TelemetryService.test.ts
src/app/
~ AppServer.ts                  # takes a JobsBackend; no relay; no pipeline start/stop
~ index.ts                      # startAppServer(backend, serverConfig, appConfig)
~ AppServer.test.ts
src/cli/
~ commands/*.ts                 # all eleven: openBackend(); no branching on --server-url
~ commands/*.test.ts            # mock openBackend() instead of the removed factories
~ utils.ts                      # createAppServerConfig() without worker fields
~ services.ts                   # registers one Backend; sets telemetry job tracking
~ main.ts                       # closes the Backend after servers stop
+ JobOutputFollower.ts
+ JobOutputFollower.test.ts
src/tools/
~ ScrapeTool.ts                 # onJobEnqueued option
~ RefreshVersionTool.ts         # onJobEnqueued option
~ RemoveTool.ts                 # optional pipeline
~ RemoveTool.test.ts
~ search-provider.ts            # documents-only backend
src/utils/
~ url.ts, url.test.ts           # toWebSocketUrl moves out
src/web/client/
~ main.tsx                      # links from createApiLinks()
~ api/hooks.ts                  # useRemoveVersion calls removeDocs
~ CONVENTIONS.md                # lists apiClient with the shared runtime modules
src/
~ index.test.ts                 # factories removed
test/
~ in-process-server.ts          # builds a Backend
~ mcp-stdio-e2e.test.ts, github-private-repo-e2e.test.ts,
  vector-persistence-e2e.test.ts, vector-search-e2e.test.ts
                                # factories removed
~ cli-e2e.test.ts               # remote progress, blocked stream, two jobs, remote remove
~ library-identity-e2e.test.ts  # CLI remove of the last version removes the library
~ base-path-e2e.test.ts         # awaits connect() instead of emitting on an interval
+ remote-worker-e2e.test.ts     # web coordinator: health across a worker restart, catch-up, remove
~ tests/search-eval/preflight.ts  # factories removed
~ ARCHITECTURE.md               # backend, shared client, relay ownership
~ docs/concepts/eventbus-architecture.md   # who relays worker events
~ docs/concepts/pipeline-architecture.md   # PipelineFactory → openBackend()
~ docs/infrastructure/telemetry.md         # workerService gone; job tracking where jobs run
~ AGENTS.md                     # test inventory
```

### Signatures

```ts
// src/services/apiClient.ts (no server imports)
type ApiClient = TRPCClient<AppRouter>;               // AppRouter imported as a type only
function createApiLinks(apiUrl: string, opts: { subscriptions: boolean }):
  { links: TRPCLink<AppRouter>[]; close(): void };
function createApiClient(apiUrl: string, opts: { subscriptions: boolean }):
  { api: ApiClient; close(): void };
function toWebSocketUrl(httpUrl: string): string;

// src/services/backend.ts
interface OpenBackendOptions {
  appConfig: AppConfig;
  eventBus: EventBusService;
  serverUrl?: string;                                    // remote when set
  jobs?: false | { recoverJobs: boolean };               // table in decision 2
  onEmbeddingModelChange?: (error: EmbeddingModelChangedError,
                            service: DocumentManagementService) => Promise<void>;
}
interface Backend {
  readonly mode: "local" | "remote";
  readonly workerUrl: string | undefined;                // remote only
  readonly docService: IDocumentManagement;
  readonly pipeline: IPipeline | undefined;
  readonly eventBus: EventBusService;
  readonly isWorkerConnected: (() => boolean) | undefined;  // remote with a relay only
  close(): Promise<void>;
}
interface JobsBackend extends Backend { readonly pipeline: IPipeline }
/** Throws when the worker is unreachable or the store fails to open; cleans up first. */
function openBackend(o: OpenBackendOptions & { jobs: { recoverJobs: boolean } }): Promise<JobsBackend>;
function openBackend(o: OpenBackendOptions): Promise<Backend>;

// src/events/RemoteEventProxy.ts
class RemoteEventProxy {
  constructor(api: ApiClient, eventBus: EventBusService);
  /** Starts the subscription; resolves true once live, false after timeoutMs. Never throws. */
  connect(timeoutMs: number): Promise<boolean>;
  disconnect(): void;
  isActive(): boolean;
}

// src/pipeline/PipelineClient.ts and src/store/DocumentManagementClient.ts
new PipelineClient(api: ApiClient, eventBus: EventBusService, relay: RemoteEventProxy);
new DocumentManagementClient(api: ApiClient);

// src/app/index.ts
function startAppServer(backend: JobsBackend, serverConfig: AppServerConfig,
                        appConfig: AppConfig): Promise<AppServer>;

// src/tools
onJobEnqueued?: (jobId: string) => void;                 // ScrapeTool, RefreshVersionTool options
new RemoveTool(docService: IDocumentManagement, pipeline: IPipeline | undefined);

// src/telemetry/TelemetryService.ts
setJobTracking(enabled: boolean): void;

// src/cli/JobOutputFollower.ts
class JobOutputFollower {
  constructor(eventBus: EventBusService, handlers: {
    onStatus(job: PipelineJob): void;
    onProgress(job: PipelineJob, progress: ScraperProgressEvent): void;
  });
  follow(jobId: string): void;   // replays buffered events for jobId; drops the rest
  dispose(): void;               // unsubscribes; safe to call twice
}
```

### Call order

```
openBackend({ serverUrl, jobs })                                 # remote
    createApiClient(serverUrl, { subscriptions: jobs !== false })
    api.ping                                                     # throws with the URL hint
    new DocumentManagementClient(api)
    if jobs !== false:
      relay = new RemoteEventProxy(api, eventBus)
      new PipelineClient(api, eventBus, relay)
      void relay.connect(EVENTS_CONNECT_TIMEOUT_MS)              # background; never blocks opening

openBackend({ jobs })                                            # local
    new DocumentManagementService(eventBus, appConfig).initialize()
                                                                 # onEmbeddingModelChange or rethrow
    if jobs is { recoverJobs }: new PipelineManager(…).start()

scrape command
+   backend = openBackend({ serverUrl, jobs: { recoverJobs: false } })
+   registerGlobalServices({ backend })                          # telemetry job tracking: local only
+   follower = new JobOutputFollower(backend.eventBus, …)        # buffers
    ScrapeTool.execute({ …, onJobEnqueued: (id) => follower.follow(id) })
      pipeline.enqueueScrapeJob()
+       relay.connect(5 s)                                       # remote: awaits the attempt; warns once on false
+     onJobEnqueued(jobId)                                       # replays RUNNING/progress for jobId
      pipeline.waitForJobCompletion()                            # events + lookup 10 s (1 s while not live)
    follower.dispose()
    backend.close()                                              # relay → pipeline → docs → client

remove command / web UI delete (#532)
+   RemoveTool(docService, pipeline).execute()                  # CLI: documents-only backend
+     pipeline?.getJobs → cancelJob → waitForJobCompletion       # web UI: removeDocs procedure
+     docService.removeVersion()

web / mcp (HTTP) / worker
+   backend = openBackend({ serverUrl, jobs: { recoverJobs } })
    startAppServer(backend, createAppServerConfig(…), appConfig)
-     new RemoteEventProxy(); connect()
-     registerWorkerService(pipeline)
    registerGlobalServices({ appServer, backend })
    … SIGINT: appServer.stop() then backend.close()
```

### Constraints

- `recoverJobs` per entry point stays as today: `worker` defaults to `true`, `default` follows
  `--resume`, `mcp`, `web`, `scrape` and `refresh` pass `false`.
- `onEmbeddingModelChange` is passed by `default` and `mcp` only.
- At most one subscription per `RemoteEventProxy`, on the backend's one WebSocket client;
  `connect()` while connecting returns the in-flight promise.
- The "live updates unavailable" warning and the relay's transition logs go through the logger, so
  they reach stderr only, and the MCP stdio server's stdout stays clean.
- `JobOutputFollower` clears its buffer in `follow()` and drops all events after `dispose()`.
- Output lines stay as they are today (`🚀 Scraping …`, `📄 Scraping …: n/m pages`, and the `Refreshing`
  equivalents).
- `EVENTS_CONNECT_TIMEOUT_MS`, `JOB_SAFETY_LOOKUP_INTERVAL_MS`, `JOB_POLL_INTERVAL_MS` and
  `JOB_LOOKUP_GIVE_UP_MS` are module constants, not configuration.
- Verification greps target `pipeline/PipelineFactory` and `PipelineFactory.createPipeline`; the
  scraper's `PipelineFactory` is a different class.

## Risks / Trade-offs

- [Large mechanical change across eleven commands, their tests and `AppServer`] → Land it in steps that
  each pass the suite: shared client and adapters (no behavior change), relay, backend and call sites,
  lifecycle, wait, CLI output, removal. The tasks follow that order.
- [The first job submitted through a server can wait up to 5 s if the relay is still connecting] → Only
  right after startup with a slow or blocked stream, and the warning says why.
- [Resubscribing on `onError` could loop against a worker that always errors] → Backoff caps the rate,
  and only transitions are logged above debug level.
- [Moving pipeline start/stop out of `AppServer` could change shutdown order] → `backend.test.ts`
  covers close order; the MCP stdio and HTTP E2E suites exercise SIGINT.
- [The browser bundle picks up server code through the shared module] → `AppRouter` is imported as a
  type only, and the Biome override rejects any other import in `apiClient.ts`.
- [Telemetry volume changes] → Coordinators stop double-reporting relayed jobs; job counts in
  dashboards drop to what the worker reports.

## Migration Plan

No data or configuration changes; one release; rollback is a revert. PR #537 merges first as the fix
for #530. This change then replaces its wait and removes the code paths it touched.
