import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { startInProcessServer } from "../../test/in-process-server";
import { leafPage, mockSite } from "../../test/mock-site";
import { getFreePort, withStore } from "../../test/test-helpers";
import { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import { PipelineManager } from "../pipeline/PipelineManager";
import { type PipelineJob, PipelineJobStatus } from "../pipeline/types";
import { ScrapeMode } from "../scraper/types";
import { DocumentManagementService } from "../store/DocumentManagementService";
import { EmbeddingModelChangedError } from "../store/errors";
import { VersionStatus } from "../store/types";
import { TelemetryEvent, telemetry } from "../telemetry/telemetry";
import { loadConfig } from "../utils/config";
import { type Backend, type OpenBackendOptions, openBackend } from "./backend";

vi.mock("../telemetry/telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../telemetry/telemetry")>()),
  telemetry: { track: vi.fn(), isEnabled: vi.fn(() => false), shutdown: vi.fn() },
}));

/** A job event as the pipeline announces it once the job starts. */
const runningJob = {
  id: "job-1",
  library: "react",
  version: null,
  status: PipelineJobStatus.RUNNING,
  createdAt: new Date(),
  startedAt: new Date(),
} as unknown as PipelineJob;

/** Whether a job's start was reported to telemetry. */
function reportedStart(jobId: string): boolean {
  return vi
    .mocked(telemetry.track)
    .mock.calls.some(
      ([event, properties]) =>
        event === TelemetryEvent.PIPELINE_JOB_STARTED && properties?.jobId === jobId,
    );
}

describe("openBackend", () => {
  const opened: Backend[] = [];

  /** Opens a backend that the test's cleanup closes. */
  async function open(options: OpenBackendOptions): Promise<Backend> {
    const backend = await openBackend(options);
    opened.push(backend);
    return backend;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(telemetry.track).mockClear();
    await Promise.allSettled(opened.splice(0).map((backend) => backend.close()));
  });

  describe("local", () => {
    let storePath: string;

    function localOptions(
      overrides: Partial<OpenBackendOptions> = {},
    ): OpenBackendOptions {
      const appConfig = loadConfig();
      appConfig.app.storePath = storePath;
      appConfig.app.embeddingModel = "";
      return { appConfig, eventBus: new EventBusService(), ...overrides };
    }

    /** Leaves react 19.0 RUNNING, as a scrape in another process would. */
    function seedRunningScrape(): Promise<number> {
      return withStore(storePath, async (store) => {
        const versionId = await store.ensureVersion({
          library: "react",
          version: "19.0",
        });
        await store.updateVersionStatus(versionId, VersionStatus.RUNNING);
        return versionId;
      });
    }

    function statusOfSeededScrape(): Promise<VersionStatus | undefined> {
      return withStore(storePath, async (store) => {
        const [react] = await store.listLibraries();
        return react?.versions[0]?.status;
      });
    }

    beforeEach(() => {
      storePath = mkdtempSync(join(tmpdir(), "docs-mcp-backend-"));
    });

    afterEach(() => {
      vi.useRealTimers();
      rmSync(storePath, { recursive: true, force: true });
    });

    it.each([undefined, false] as const)(
      "leaves a scrape that another process runs alone for documents only (jobs: %s)",
      async (jobs) => {
        await seedRunningScrape();

        const backend = await open(localOptions({ jobs }));

        expect(backend.pipeline).toBeUndefined();
        expect(await statusOfSeededScrape()).toBe(VersionStatus.RUNNING);
      },
    );

    it.each([
      { interruptedJobs: "fail", status: VersionStatus.FAILED },
      { interruptedJobs: "leave", status: VersionStatus.RUNNING },
    ] as const)(
      "runs jobs and leaves an interrupted scrape $status when set to $interruptedJobs it",
      async ({ interruptedJobs, status }) => {
        await seedRunningScrape();
        // An hour later, so the scrape looks abandoned rather than alive
        vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 60 * 60_000 });

        const backend = await open(localOptions({ jobs: { interruptedJobs } }));

        expect(backend.pipeline).toBeInstanceOf(PipelineManager);
        expect(await statusOfSeededScrape()).toBe(status);
      },
    );

    it("reports the jobs its pipeline runs to telemetry", async () => {
      const backend = await open(localOptions({ jobs: { interruptedJobs: "fail" } }));

      backend.eventBus.emit(EventType.JOB_STATUS_CHANGE, runningJob);

      expect(reportedStart(runningJob.id)).toBe(true);
    });

    it("hands a changed embedding model to the handler and opens anyway", async () => {
      const changed = new EmbeddingModelChangedError("a", "1", "b", "2");
      vi.spyOn(DocumentManagementService.prototype, "initialize").mockRejectedValueOnce(
        changed,
      );
      const onEmbeddingModelChange = vi.fn().mockResolvedValue(undefined);

      const backend = await open(localOptions({ onEmbeddingModelChange }));

      expect(onEmbeddingModelChange).toHaveBeenCalledWith(changed, backend.docService);
    });

    it("closes the store and rethrows any other error opening it", async () => {
      vi.spyOn(DocumentManagementService.prototype, "initialize").mockRejectedValueOnce(
        new Error("disk full"),
      );
      const shutdown = vi.spyOn(DocumentManagementService.prototype, "shutdown");

      await expect(
        openBackend(localOptions({ onEmbeddingModelChange: vi.fn() })),
      ).rejects.toThrow("disk full");
      expect(shutdown).toHaveBeenCalledTimes(1);
    });

    it("closes the store when the pipeline fails to start", async () => {
      vi.spyOn(PipelineManager.prototype, "start").mockRejectedValueOnce(
        new Error("busy"),
      );
      const shutdown = vi.spyOn(DocumentManagementService.prototype, "shutdown");

      await expect(
        openBackend(localOptions({ jobs: { interruptedJobs: "fail" } })),
      ).rejects.toThrow("busy");
      expect(shutdown).toHaveBeenCalledTimes(1);
    });

    it("closes the store even when stopping the pipeline fails, and reports that failure", async () => {
      const backend = await openBackend(
        localOptions({ jobs: { interruptedJobs: "fail" } }),
      );
      vi.spyOn(PipelineManager.prototype, "stop").mockRejectedValueOnce(
        new Error("stuck"),
      );
      const shutdown = vi.spyOn(DocumentManagementService.prototype, "shutdown");

      await expect(backend.close()).rejects.toThrow("stuck");
      expect(shutdown).toHaveBeenCalledTimes(1);
    });

    it("closes once however often it is asked", async () => {
      const backend = await openBackend(
        localOptions({ jobs: { interruptedJobs: "fail" } }),
      );
      const shutdown = vi.spyOn(DocumentManagementService.prototype, "shutdown");

      await Promise.all([backend.close(), backend.close()]);
      await backend.close();

      expect(shutdown).toHaveBeenCalledTimes(1);
    });
  });

  describe("remote", () => {
    const site = mockSite("https://docs.example.com");
    let worker: Awaited<ReturnType<typeof startInProcessServer>>;
    let workerUrl: string;

    function remoteOptions(
      overrides: Partial<OpenBackendOptions> = {},
    ): OpenBackendOptions {
      const appConfig = loadConfig();
      appConfig.app.storePath = "";
      return {
        appConfig,
        eventBus: new EventBusService(),
        serverUrl: workerUrl,
        ...overrides,
      };
    }

    /** Scrapes the mock site's page into the worker as `library`. */
    async function scrapeOnWorker(backend: Backend, library: string): Promise<string> {
      const pipeline = backend.pipeline;
      if (!pipeline) throw new Error("The backend has no pipeline");
      site.page("/", leafPage(`${library} docs`));
      const jobId = await pipeline.enqueueScrapeJob(library, null, {
        url: site.url("/"),
        library,
        version: "",
        maxPages: 1,
        scrapeMode: ScrapeMode.Fetch,
      });
      await pipeline.waitForJobCompletion(jobId);
      return jobId;
    }

    beforeAll(async () => {
      worker = await startInProcessServer({ enableWebInterface: false });
      workerUrl = worker.apiUrl;
    });

    afterAll(async () => {
      await worker?.stop();
    });

    it("runs a job on the worker and relays its events to the local bus", async () => {
      const backend = await open(remoteOptions({ jobs: { interruptedJobs: "fail" } }));
      const statuses: PipelineJob[] = [];
      backend.eventBus.on(EventType.JOB_STATUS_CHANGE, (job) => statuses.push(job));

      const jobId = await scrapeOnWorker(backend, "relayed");

      expect(backend.isWorkerConnected?.()).toBe(true);
      expect(statuses.filter((job) => job.id === jobId).map((job) => job.status)).toEqual(
        expect.arrayContaining([PipelineJobStatus.RUNNING, PipelineJobStatus.COMPLETED]),
      );
    });

    it("leaves reporting the worker's jobs to the worker", async () => {
      const backend = await open(remoteOptions({ jobs: { interruptedJobs: "fail" } }));

      // A relayed event arrives on the local bus like this one
      backend.eventBus.emit(EventType.JOB_STATUS_CHANGE, runningJob);

      expect(reportedStart(runningJob.id)).toBe(false);
    });

    it("reads the worker's documents without a pipeline", async () => {
      await scrapeOnWorker(
        await open(remoteOptions({ jobs: { interruptedJobs: "fail" } })),
        "read",
      );

      const backend = await open(remoteOptions());

      expect(backend.workerUrl).toBe(workerUrl);
      expect(backend.pipeline).toBeUndefined();
      const libraries = await backend.docService.listLibraries();
      expect(libraries.map((library) => library.library)).toContain("read");
    });

    it("fails with the URL to check when the worker does not answer", async () => {
      const deadUrl = `http://127.0.0.1:${await getFreePort()}/api`;

      await expect(openBackend(remoteOptions({ serverUrl: deadUrl }))).rejects.toThrow(
        `Failed to connect to server at ${deadUrl}`,
      );
    });
  });
});
