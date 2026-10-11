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
import { getFreePort } from "../../test/test-helpers";
import { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import { PipelineManager } from "../pipeline/PipelineManager";
import { type PipelineJob, PipelineJobStatus } from "../pipeline/types";
import { DocumentManagementService } from "../store/DocumentManagementService";
import { EmbeddingModelChangedError } from "../store/errors";
import { VersionStatus } from "../store/types";
import { loadConfig } from "../utils/config";
import { type Backend, type OpenBackendOptions, openBackend } from "./backend";

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

    /** Opens the store on its own, the way another process would. */
    async function withStore<T>(work: (store: DocumentManagementService) => Promise<T>) {
      const { appConfig, eventBus } = localOptions();
      const store = new DocumentManagementService(eventBus, appConfig);
      await store.initialize();
      try {
        return await work(store);
      } finally {
        await store.shutdown();
      }
    }

    /** Leaves react 19.0 RUNNING, as a scrape in another process would. */
    function seedRunningScrape(): Promise<number> {
      return withStore(async (store) => {
        const versionId = await store.ensureVersion({
          library: "react",
          version: "19.0",
        });
        await store.updateVersionStatus(versionId, VersionStatus.RUNNING);
        return versionId;
      });
    }

    function statusOfSeededScrape(): Promise<VersionStatus | undefined> {
      return withStore(async (store) => {
        const [react] = await store.listLibraries();
        return react?.versions[0]?.status;
      });
    }

    beforeEach(() => {
      storePath = mkdtempSync(join(tmpdir(), "docs-mcp-backend-"));
    });

    afterEach(() => {
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

    it("marks an interrupted scrape failed when it runs jobs without recovering them", async () => {
      await seedRunningScrape();

      const backend = await open(localOptions({ jobs: { recoverJobs: false } }));

      expect(backend.pipeline).toBeInstanceOf(PipelineManager);
      expect(await statusOfSeededScrape()).toBe(VersionStatus.FAILED);
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
        openBackend(localOptions({ jobs: { recoverJobs: false } })),
      ).rejects.toThrow("busy");
      expect(shutdown).toHaveBeenCalledTimes(1);
    });

    it("closes the store even when stopping the pipeline fails, and reports that failure", async () => {
      const backend = await openBackend(localOptions({ jobs: { recoverJobs: false } }));
      vi.spyOn(PipelineManager.prototype, "stop").mockRejectedValueOnce(
        new Error("stuck"),
      );
      const shutdown = vi.spyOn(DocumentManagementService.prototype, "shutdown");

      await expect(backend.close()).rejects.toThrow("stuck");
      expect(shutdown).toHaveBeenCalledTimes(1);
    });

    it("closes once however often it is asked", async () => {
      const backend = await openBackend(localOptions({ jobs: { recoverJobs: false } }));
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
      });
      await pipeline.waitForJobCompletion(jobId);
      return jobId;
    }

    beforeAll(async () => {
      const port = await getFreePort();
      worker = await startInProcessServer({
        port,
        publicUrl: `http://127.0.0.1:${port}`,
        enableWebInterface: false,
      });
      workerUrl = `http://127.0.0.1:${port}/api`;
    });

    afterAll(async () => {
      await worker?.stop();
    });

    it("runs a job on the worker and relays its events to the local bus", async () => {
      const backend = await open(remoteOptions({ jobs: { recoverJobs: false } }));
      const statuses: PipelineJob[] = [];
      backend.eventBus.on(EventType.JOB_STATUS_CHANGE, (job) => statuses.push(job));

      const jobId = await scrapeOnWorker(backend, "relayed");

      expect(backend.isWorkerConnected?.()).toBe(true);
      expect(statuses.filter((job) => job.id === jobId).map((job) => job.status)).toEqual(
        expect.arrayContaining([PipelineJobStatus.RUNNING, PipelineJobStatus.COMPLETED]),
      );
    });

    it("reads the worker's documents without a pipeline", async () => {
      await scrapeOnWorker(
        await open(remoteOptions({ jobs: { recoverJobs: false } })),
        "read",
      );

      const backend = await open(remoteOptions());

      expect(backend.mode).toBe("remote");
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
