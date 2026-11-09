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
import { withStore } from "../../test/test-helpers";
import { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import { PipelineManager } from "../pipeline/PipelineManager";
import { type PipelineJob, PipelineJobStatus } from "../pipeline/types";
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
      rmSync(storePath, { recursive: true, force: true });
    });

    it("leaves a scrape that another process runs alone when it opens for documents only", async () => {
      await seedRunningScrape();

      for (const jobs of [undefined, false] as const) {
        const backend = await open(localOptions({ jobs }));

        expect.soft(backend.pipeline, `jobs: ${jobs}`).toBeUndefined();
        expect
          .soft(await statusOfSeededScrape(), `jobs: ${jobs}`)
          .toBe(VersionStatus.RUNNING);
        await backend.close();
      }
    });

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

    it("closes the store and rethrows when opening fails after the store opened", async () => {
      const cases = [
        {
          label: "store initialization fails with another error than a model change",
          fail: () =>
            vi
              .spyOn(DocumentManagementService.prototype, "initialize")
              .mockRejectedValueOnce(new Error("disk full")),
          options: { onEmbeddingModelChange: vi.fn() },
          error: "disk full",
        },
        {
          label: "the pipeline fails to start",
          fail: () =>
            vi
              .spyOn(PipelineManager.prototype, "start")
              .mockRejectedValueOnce(new Error("busy")),
          options: { jobs: { interruptedJobs: "fail" } } as const,
          error: "busy",
        },
      ];
      const shutdown = vi.spyOn(DocumentManagementService.prototype, "shutdown");

      for (const { label, fail, options, error } of cases) {
        shutdown.mockClear();
        fail();

        await expect
          .soft(openBackend(localOptions(options)), label)
          .rejects.toThrow(error);
        expect.soft(shutdown, label).toHaveBeenCalledTimes(1);
      }
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

    beforeAll(async () => {
      worker = await startInProcessServer({ enableWebInterface: false });
      workerUrl = worker.apiUrl;
    });

    afterAll(async () => {
      await worker?.stop();
    });

    it("leaves reporting the worker's jobs to the worker", async () => {
      const backend = await open(remoteOptions({ jobs: { interruptedJobs: "fail" } }));

      // A relayed event arrives on the local bus like this one
      backend.eventBus.emit(EventType.JOB_STATUS_CHANGE, runningJob);

      expect(reportedStart(runningJob.id)).toBe(false);
    });
  });
});
