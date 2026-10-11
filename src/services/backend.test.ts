import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBusService } from "../events/EventBusService";
import { RemoteEventProxy } from "../events/RemoteEventProxy";
import { PipelineClient } from "../pipeline/PipelineClient";
import { PipelineManager } from "../pipeline/PipelineManager";
import { DocumentManagementClient } from "../store/DocumentManagementClient";
import { DocumentManagementService } from "../store/DocumentManagementService";
import { EmbeddingModelChangedError } from "../store/errors";
import { loadConfig } from "../utils/config";
import { createApiClient, pingApi } from "./apiClient";
import { openBackend } from "./backend";

vi.mock("../pipeline/PipelineManager");
vi.mock("../pipeline/PipelineClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pipeline/PipelineClient")>()),
  PipelineClient: vi.fn(),
}));
vi.mock("../store/DocumentManagementService");
vi.mock("../store/DocumentManagementClient");
vi.mock("../events/RemoteEventProxy");
vi.mock("./apiClient", () => ({
  createApiClient: vi.fn(),
  pingApi: vi.fn(),
}));

const workerUrl = "http://worker:8080/api";
const closeApi = vi.fn();

function options(overrides: Partial<Parameters<typeof openBackend>[0]> = {}) {
  const appConfig = loadConfig();
  appConfig.app.storePath = "/tmp/store";
  return { appConfig, eventBus: new EventBusService(), ...overrides };
}

describe("openBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createApiClient).mockReturnValue({ api: {} as never, close: closeApi });
    vi.mocked(pingApi).mockResolvedValue(undefined);
    vi.mocked(RemoteEventProxy.prototype.connect).mockReturnValue(new Promise(() => {}));
  });

  describe("local", () => {
    it.each([undefined, false] as const)(
      "opens no pipeline for documents only (jobs: %s)",
      async (jobs) => {
        const backend = await openBackend(options({ jobs }));

        expect(backend.mode).toBe("local");
        expect(backend.docService).toBeInstanceOf(DocumentManagementService);
        expect(backend.pipeline).toBeUndefined();
        expect(PipelineManager).not.toHaveBeenCalled();
      },
    );

    it("starts a pipeline that recovers jobs as asked", async () => {
      const backend = await openBackend(options({ jobs: { recoverJobs: true } }));

      expect(PipelineManager).toHaveBeenCalledWith(
        backend.docService,
        backend.eventBus,
        expect.objectContaining({ recoverJobs: true }),
      );
      expect(backend.pipeline).toBe(vi.mocked(PipelineManager).mock.instances[0]);
      expect(PipelineManager.prototype.start).toHaveBeenCalledTimes(1);
    });

    it("hands a changed embedding model to the handler", async () => {
      const changed = new EmbeddingModelChangedError("a", "1", "b", "2");
      vi.mocked(DocumentManagementService.prototype.initialize).mockRejectedValueOnce(
        changed,
      );
      const onEmbeddingModelChange = vi.fn().mockResolvedValue(undefined);

      await openBackend(options({ onEmbeddingModelChange }));

      expect(onEmbeddingModelChange).toHaveBeenCalledWith(
        changed,
        expect.any(DocumentManagementService),
      );
    });

    it("rethrows other store errors and closes the store", async () => {
      vi.mocked(DocumentManagementService.prototype.initialize).mockRejectedValueOnce(
        new Error("disk full"),
      );

      await expect(
        openBackend(options({ onEmbeddingModelChange: vi.fn() })),
      ).rejects.toThrow("disk full");
      expect(DocumentManagementService.prototype.shutdown).toHaveBeenCalledTimes(1);
    });

    it("closes the store when the pipeline fails to start", async () => {
      vi.mocked(PipelineManager.prototype.start).mockRejectedValueOnce(new Error("busy"));

      await expect(
        openBackend(options({ jobs: { recoverJobs: false } })),
      ).rejects.toThrow("busy");
      expect(DocumentManagementService.prototype.shutdown).toHaveBeenCalledTimes(1);
    });
  });

  describe("remote", () => {
    it("checks the worker once and opens no WebSocket for documents only", async () => {
      const backend = await openBackend(options({ serverUrl: workerUrl }));

      expect(backend.mode).toBe("remote");
      expect(backend.workerUrl).toBe(workerUrl);
      expect(backend.docService).toBeInstanceOf(DocumentManagementClient);
      expect(backend.pipeline).toBeUndefined();
      expect(createApiClient).toHaveBeenCalledWith(workerUrl, { subscriptions: false });
      expect(pingApi).toHaveBeenCalledTimes(1);
      expect(RemoteEventProxy).not.toHaveBeenCalled();
    });

    it("fails with the worker's error and closes the client when it does not answer", async () => {
      vi.mocked(pingApi).mockRejectedValueOnce(new Error("Failed to connect to server"));

      await expect(openBackend(options({ serverUrl: workerUrl }))).rejects.toThrow(
        "Failed to connect to server",
      );
      expect(closeApi).toHaveBeenCalledTimes(1);
    });

    it.each([{ recoverJobs: true }, { recoverJobs: false }] as const)(
      "starts relaying events without waiting for them (jobs: %o)",
      async (jobs) => {
        const backend = await openBackend(options({ serverUrl: workerUrl, jobs }));

        expect(createApiClient).toHaveBeenCalledWith(workerUrl, { subscriptions: true });
        expect(backend.pipeline).toBe(vi.mocked(PipelineClient).mock.instances[0]);
        expect(RemoteEventProxy.prototype.connect).toHaveBeenCalledTimes(1);
        expect(PipelineManager).not.toHaveBeenCalled();
      },
    );

    it("reports the worker connected while the relay is live", async () => {
      vi.mocked(RemoteEventProxy.prototype.isActive).mockReturnValue(true);

      const backend = await openBackend(
        options({ serverUrl: workerUrl, jobs: { recoverJobs: false } }),
      );

      expect(backend.isWorkerConnected?.()).toBe(true);
    });
  });

  describe("close", () => {
    it("stops the pipeline before the store", async () => {
      const order: string[] = [];
      vi.mocked(PipelineManager.prototype.stop).mockImplementation(async () => {
        order.push("pipeline");
      });
      vi.mocked(DocumentManagementService.prototype.shutdown).mockImplementation(
        async () => {
          order.push("store");
        },
      );
      const backend = await openBackend(options({ jobs: { recoverJobs: false } }));

      await backend.close();

      expect(order).toEqual(["pipeline", "store"]);
    });

    it("disconnects the relay before closing the client", async () => {
      const order: string[] = [];
      vi.mocked(RemoteEventProxy.prototype.disconnect).mockImplementation(() => {
        order.push("relay");
      });
      closeApi.mockImplementation(() => order.push("client"));
      const backend = await openBackend(
        options({ serverUrl: workerUrl, jobs: { recoverJobs: false } }),
      );

      await backend.close();

      expect(order).toEqual(["relay", "client"]);
    });

    it("runs every step when one fails and rejects with the first error", async () => {
      vi.mocked(PipelineManager.prototype.stop).mockRejectedValueOnce(new Error("stuck"));
      const backend = await openBackend(options({ jobs: { recoverJobs: false } }));

      await expect(backend.close()).rejects.toThrow("stuck");
      expect(DocumentManagementService.prototype.shutdown).toHaveBeenCalledTimes(1);
    });

    it("closes only once", async () => {
      const backend = await openBackend(options({ jobs: { recoverJobs: false } }));

      await backend.close();
      await backend.close();

      expect(PipelineManager.prototype.stop).toHaveBeenCalledTimes(1);
      expect(DocumentManagementService.prototype.shutdown).toHaveBeenCalledTimes(1);
    });
  });
});
