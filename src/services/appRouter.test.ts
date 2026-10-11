import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import { PipelineManager } from "../pipeline/PipelineManager";
import { PipelineJobStatus } from "../pipeline/types";
import { ScraperService } from "../scraper";
import { DocumentManagementService } from "../store/DocumentManagementService";
import { loadConfig } from "../utils/config";
import { appRouter, createAppRouterContext } from "./appRouter";
import type { SystemInfo } from "./systemInfo";

describe("appRouter.removeDocs", () => {
  let eventBus: EventBusService;
  let store: DocumentManagementService;
  let pipeline: PipelineManager;

  beforeEach(async () => {
    const appConfig = loadConfig();
    appConfig.app.storePath = ":memory:";
    appConfig.app.embeddingModel = "";
    appConfig.scraper.maxConcurrency = 1;
    eventBus = new EventBusService();
    store = new DocumentManagementService(eventBus, appConfig);
    await store.initialize();
    pipeline = new PipelineManager(store, eventBus, { recoverJobs: false, appConfig });

    // Each scrape runs until its job is cancelled, as a real crawl stops at the
    // next page once its signal aborts
    vi.spyOn(ScraperService.prototype, "scrape").mockImplementation(
      async (_options, _onProgress, signal) => {
        if (signal?.aborted) return;
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    );
  });

  afterEach(async () => {
    await pipeline.stop();
    await store.shutdown();
    vi.restoreAllMocks();
  });

  it("cancels the version's running job and removes the version", async () => {
    // Subscribed before the enqueue, which may start the job before it returns
    const running = new Promise<void>((resolve) => {
      const off = eventBus.on(EventType.JOB_STATUS_CHANGE, (job) => {
        if (job.status === PipelineJobStatus.RUNNING) {
          off();
          resolve();
        }
      });
    });
    await pipeline.start();
    const jobId = await pipeline.enqueueScrapeJob("React", "19.0", {
      url: "https://example.com/docs",
      library: "React",
      version: "19.0",
    });
    await running;
    const caller = appRouter.createCaller(
      createAppRouterContext({
        pipeline,
        docService: store,
        eventBus,
        systemInfo: {} as SystemInfo,
      }),
    );

    const result = await caller.removeDocs({ library: "react", version: " 19.0 " });

    expect(result.message).toBe("Successfully removed react@19.0.");
    expect((await pipeline.getJob(jobId))?.status).toBe(PipelineJobStatus.CANCELLED);
    expect(await store.listLibraries()).toEqual([]);
  });
});
