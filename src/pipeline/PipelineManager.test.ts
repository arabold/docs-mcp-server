import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import { ScraperService } from "../scraper";
import {
  PageOutcome,
  ScrapeMode,
  type ScraperOptions,
  type ScraperProgressEvent,
} from "../scraper/types";
import { DocumentManagementService } from "../store/DocumentManagementService";
import {
  LibraryAlreadyExistsError,
  LibraryNotFoundInStoreError,
  VersionAlreadyExistsError,
} from "../store/errors";
import { VersionStatus } from "../store/types";
import { type AppConfig, loadConfig } from "../utils/config";
import { PipelineStateError } from "./errors";
import { PipelineManager } from "./PipelineManager";
import { type PipelineJob, PipelineJobStatus } from "./types";

const SOURCE_URL = "https://example.com/docs";

function scrapeOptions(
  library: string,
  version = "1.0",
  overrides: Partial<ScraperOptions> = {},
): ScraperOptions {
  return { url: SOURCE_URL, library, version, ...overrides };
}

function progress(pagesScraped: number, totalPages: number): ScraperProgressEvent {
  return {
    pagesScraped,
    totalPages,
    totalDiscovered: totalPages,
    pagesIndexed: pagesScraped - 1,
    currentUrl: `${SOURCE_URL}/page-${pagesScraped}`,
    depth: 1,
    maxDepth: 3,
    outcome: PageOutcome.Unchanged,
    result: null,
  };
}

/** A promise and the function that resolves it. */
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A progress event for a page the worker stores. */
function storedPage(): ScraperProgressEvent {
  const url = `${SOURCE_URL}/guide`;
  return {
    ...progress(1, 1),
    currentUrl: url,
    outcome: PageOutcome.Stored,
    result: {
      url,
      title: "Guide",
      sourceContentType: "text/html",
      contentType: "text/markdown",
      textContent: "Install the package first.",
      links: [],
      errors: [],
      chunks: [
        {
          types: ["text"],
          content: "Install the package first.",
          section: { level: 1, path: ["Guide"] },
        },
      ],
    },
  };
}

describe("PipelineManager", () => {
  let appConfig: AppConfig;
  let eventBus: EventBusService;
  let store: DocumentManagementService;
  let manager: PipelineManager;
  /** The scrape every job runs; each test decides what it does. */
  let scrape: MockInstance<ScraperService["scrape"]>;
  let statusEvents: PipelineJob[];

  function createManager(options: { recoverJobs?: boolean; concurrency?: number } = {}) {
    appConfig.scraper.maxConcurrency = options.concurrency ?? 1;
    return new PipelineManager(store, eventBus, {
      recoverJobs: options.recoverJobs ?? false,
      appConfig,
    });
  }

  /**
   * Makes every scrape wait until it is released or its job is cancelled, the
   * way a real crawl stops at the next page once its signal aborts.
   */
  function holdScrapes(): () => void {
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    scrape.mockImplementation(async (_options, _onProgress, signal) => {
      if (signal?.aborted) return;
      await new Promise<void>((resolve) => {
        void released.then(resolve);
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    });
    return release;
  }

  /**
   * Makes the next job store one page and holds that write open until
   * `release()`, the way a job can still be storing a page when it is
   * cancelled. Resolves `writing` once the write has started.
   */
  function holdPageWrite() {
    const writing = deferred();
    const gate = deferred();
    const write = store.addScrapeResult.bind(store);
    vi.spyOn(store, "addScrapeResult").mockImplementationOnce(async (...args) => {
      writing.resolve();
      await gate.promise;
      return write(...args);
    });
    scrape.mockImplementationOnce(async (_options, onProgress) => {
      await onProgress(storedPage());
    });
    return { writing: writing.promise, release: gate.resolve };
  }

  /**
   * Resolves once the manager has announced the status. The announcement comes
   * after the store write, so the transition is complete by then.
   */
  function reachStatus(jobId: string, status: PipelineJobStatus): Promise<void> {
    const reached = (job: PipelineJob) => job.id === jobId && job.status === status;
    if (statusEvents.some(reached)) return Promise.resolve();
    return new Promise((resolve) => {
      const off = eventBus.on(EventType.JOB_STATUS_CHANGE, (job) => {
        if (reached(job)) {
          off();
          resolve();
        }
      });
    });
  }

  async function statusOf(jobId: string) {
    return (await manager.getJob(jobId))?.status;
  }

  /** Seeds a version as an earlier run would have left it. */
  async function seedVersion(
    library: string,
    version: string,
    status: VersionStatus,
    seed: {
      options?: Partial<ScraperOptions> | null;
      pages?: Array<{
        url: string;
        depth: number;
        etag: string | null;
        contentUrl?: string;
      }>;
    } = {},
  ): Promise<number> {
    const versionId = await store.ensureVersion({ library, version });
    for (const page of seed.pages ?? []) {
      await store.addEmptyPage(library, version, page.depth, {
        url: page.url,
        contentUrl: page.contentUrl,
        title: page.url,
        sourceContentType: "text/html",
        contentType: "text/html",
        etag: page.etag,
        lastModified: null,
      });
    }
    if (seed.options !== null) {
      await store.storeScraperOptions(versionId, {
        ...scrapeOptions(library, version),
        ...seed.options,
      });
    }
    await store.updateVersionStatus(versionId, status);
    return versionId;
  }

  beforeEach(async () => {
    appConfig = loadConfig();
    appConfig.app.storePath = ":memory:";
    appConfig.app.embeddingModel = "";
    eventBus = new EventBusService();
    store = new DocumentManagementService(eventBus, appConfig);
    await store.initialize();

    scrape = vi.spyOn(ScraperService.prototype, "scrape").mockResolvedValue(undefined);
    statusEvents = [];
    eventBus.on(EventType.JOB_STATUS_CHANGE, (job) => {
      statusEvents.push(job);
    });

    manager = createManager();
  });

  afterEach(async () => {
    await manager.stop();
    // Settle whatever a test left queued or held, so no job writes to the store
    // after it closes.
    const jobs = await manager.getJobs();
    for (const job of jobs) {
      await manager.cancelJob(job.id);
    }
    await Promise.all(
      jobs.map((job) => manager.waitForJobCompletion(job.id).catch(() => {})),
    );
    await store.shutdown();
    vi.restoreAllMocks();
  });

  describe("enqueueScrapeJob", () => {
    it("queues the job and records it in the store", async () => {
      const jobId = await manager.enqueueScrapeJob("libA", "1.0", scrapeOptions("libA"));

      const job = await manager.getJob(jobId);
      expect(job).toMatchObject({
        status: PipelineJobStatus.QUEUED,
        library: "libA",
        version: "1.0",
        sourceUrl: SOURCE_URL,
        versionStatus: VersionStatus.QUEUED,
      });
      const versionId = await store.ensureVersion({ library: "libA", version: "1.0" });
      expect((await store.getVersionById(versionId))?.status).toBe(VersionStatus.QUEUED);
      expect((await store.getScraperOptions(versionId))?.sourceUrl).toBe(SOURCE_URL);
    });

    it.each([null, undefined, ""])(
      "treats version %j as unversioned",
      async (version) => {
        const jobId = await manager.enqueueScrapeJob(
          "libA",
          version,
          scrapeOptions("libA", ""),
        );

        expect((await manager.getJob(jobId))?.version).toBeNull();
        const versionId = await store.ensureVersion({ library: "libA", version: "" });
        expect((await store.getVersionById(versionId))?.status).toBe(
          VersionStatus.QUEUED,
        );
      },
    );

    it.each([
      ["defaults scrapeMode to auto", {}, ScrapeMode.Auto],
      // Hash routes only exist in a rendered page.
      [
        "upgrades fetch to playwright when hashes are preserved",
        { scrapeMode: ScrapeMode.Fetch, preserveHashes: true },
        ScrapeMode.Playwright,
      ],
    ])("%s", async (_label, overrides, expectedMode) => {
      const jobId = await manager.enqueueScrapeJob(
        "libA",
        "1.0",
        scrapeOptions("libA", "1.0", overrides),
      );

      expect((await manager.getJob(jobId))?.scraperOptions?.scrapeMode).toBe(
        expectedMode,
      );
    });

    it("queues the job even when the store cannot record its status", async () => {
      vi.spyOn(store, "updateVersionStatus").mockRejectedValue(new Error("DB error"));

      const jobId = await manager.enqueueScrapeJob("libA", "1.0", scrapeOptions("libA"));

      expect(await statusOf(jobId)).toBe(PipelineJobStatus.QUEUED);
    });
  });

  describe("removeVersion", () => {
    /** A promise with its resolve function, to hold a store call open. */
    it("cancels the version's running job and removes the version once it has ended", async () => {
      holdScrapes();
      await manager.start();
      const jobId = await manager.enqueueScrapeJob(
        "React",
        "19.0",
        scrapeOptions("React", "19.0"),
      );
      await reachStatus(jobId, PipelineJobStatus.RUNNING);

      await manager.removeVersion("react", "19.0");

      expect(await statusOf(jobId)).toBe(PipelineJobStatus.CANCELLED);
      expect(await store.listLibraries()).toEqual([]);
    });

    it("matches the running job however the library and version are padded or cased", async () => {
      holdScrapes();
      await manager.start();
      const jobId = await manager.enqueueScrapeJob(
        "react",
        "19.0",
        scrapeOptions("react", "19.0"),
      );
      await reachStatus(jobId, PipelineJobStatus.RUNNING);

      await manager.removeVersion(" React ", " 19.0 ");

      expect(await statusOf(jobId)).toBe(PipelineJobStatus.CANCELLED);
      expect(await store.listLibraries()).toEqual([]);
    });

    it("waits for a job already being cancelled before removing its version", async () => {
      const write = holdPageWrite();
      await manager.start();
      const jobId = await manager.enqueueScrapeJob(
        "React",
        "19.0",
        scrapeOptions("React", "19.0"),
      );
      await write.writing;
      await manager.cancelJob(jobId);
      expect(await statusOf(jobId)).toBe(PipelineJobStatus.CANCELLING);

      const removed = manager.removeVersion("React", "19.0");
      await new Promise((resolve) => setImmediate(resolve));
      write.release();
      await removed;
      await manager.waitForJobCompletion(jobId);

      // The page stored after the cancel would otherwise bring the version back
      expect(await store.listLibraries()).toEqual([]);
      expect(await statusOf(jobId)).toBe(PipelineJobStatus.CANCELLED);
    });

    it("waits for an enqueue in progress, then cancels the job it registered", async () => {
      const gate = deferred();
      const claim = store.claimVersion.bind(store);
      vi.spyOn(store, "claimVersion").mockImplementationOnce(async (...args) => {
        await gate.promise;
        return claim(...args);
      });

      const enqueued = manager.enqueueScrapeJob(
        "React",
        "19.0",
        scrapeOptions("React", "19.0"),
      );
      const removed = manager.removeVersion("React", "19.0");
      gate.resolve();
      const jobId = await enqueued;
      await removed;

      expect(await statusOf(jobId)).toBe(PipelineJobStatus.CANCELLED);
      expect(await store.listLibraries()).toEqual([]);
    });

    it("keeps a refresh in progress from bringing back a version removed meanwhile", async () => {
      await seedVersion("React", "19.0", VersionStatus.COMPLETED, {
        pages: [{ url: `${SOURCE_URL}/guide`, depth: 0, etag: null }],
      });
      const reading = deferred();
      const gate = deferred();
      const readOptions = store.getScraperOptions.bind(store);
      vi.spyOn(store, "getScraperOptions").mockImplementationOnce(async (...args) => {
        reading.resolve();
        await gate.promise;
        return readOptions(...args);
      });

      const refreshed = manager.enqueueRefreshJob("React", "19.0");
      // The refresh has read the version and its pages but registered no job yet
      await reading.promise;
      const removed = manager.removeVersion("React", "19.0");
      await new Promise((resolve) => setImmediate(resolve));
      gate.resolve();
      const jobId = await refreshed;
      await removed;

      expect(await statusOf(jobId)).toBe(PipelineJobStatus.CANCELLED);
      expect(await store.listLibraries()).toEqual([]);
    });

    it("holds an enqueue of the same version until the removal is done", async () => {
      await seedVersion("React", "19.0", VersionStatus.COMPLETED);
      const gate = deferred();
      const remove = store.removeVersion.bind(store);
      vi.spyOn(store, "removeVersion").mockImplementationOnce(async (...args) => {
        await gate.promise;
        return remove(...args);
      });
      const claim = vi.spyOn(store, "claimVersion");

      const removed = manager.removeVersion("React", "19.0");
      const enqueued = manager.enqueueScrapeJob(
        "React",
        "19.0",
        scrapeOptions("React", "19.0"),
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(claim).not.toHaveBeenCalled();

      gate.resolve();
      await removed;
      // The version is gone, so the default reject-version claim succeeds
      const jobId = await enqueued;
      expect(await statusOf(jobId)).toBe(PipelineJobStatus.QUEUED);
    });
  });

  describe("overwrite protection", () => {
    it.each([
      ["queued by an earlier enqueue", false],
      ["stored by an earlier run", true],
    ])("rejects a version %s and leaves its job alone", async (_label, stored) => {
      if (stored) await seedVersion("React", "19.0.0", VersionStatus.COMPLETED);
      const firstId = stored
        ? undefined
        : await manager.enqueueScrapeJob("React", "19.0.0", scrapeOptions("React"));

      await expect(
        manager.enqueueScrapeJob("react", "19.0.0", scrapeOptions("react")),
      ).rejects.toBeInstanceOf(VersionAlreadyExistsError);

      const jobs = await manager.getJobs();
      expect(jobs.map((job) => job.id)).toEqual(firstId ? [firstId] : []);
      if (firstId) expect(await statusOf(firstId)).toBe(PipelineJobStatus.QUEUED);
    });

    it("appends into an existing version, since appending clears nothing", async () => {
      await seedVersion("React", "19.0.0", VersionStatus.COMPLETED);

      const jobId = await manager.enqueueScrapeJob(
        "React",
        "19.0.0",
        scrapeOptions("React", "19.0.0", { clean: false }),
      );

      expect(await statusOf(jobId)).toBe(PipelineJobStatus.QUEUED);
    });

    it("still rejects an append when the caller refuses an existing library", async () => {
      await seedVersion("React", "18.0.0", VersionStatus.COMPLETED);

      await expect(
        manager.enqueueScrapeJob(
          "React",
          "19.0.0",
          scrapeOptions("React", "19.0.0", { clean: false }),
          { onExisting: "reject-library" },
        ),
      ).rejects.toBeInstanceOf(LibraryAlreadyExistsError);
    });

    it("reports a job under the library's stored display name", async () => {
      await seedVersion("React", "18.0.0", VersionStatus.COMPLETED);

      const jobId = await manager.enqueueScrapeJob(
        "react",
        "19.0.0",
        scrapeOptions("react"),
      );

      expect((await manager.getJob(jobId))?.library).toBe("React");
    });
  });

  describe("replacing a job in flight", () => {
    // The store buckets by folded library name and normalized version label, so
    // two jobs that differ only in spelling would clean and write one bucket in
    // parallel, the second deleting what the first had written.
    it.each([
      ["the same library and version", ["libA", "1.0"], ["libA", "1.0"]],
      ["an unversioned library", ["libA", undefined], ["libA", null]],
      ["a differently spelled version", ["libA", " LATEST "], ["libA", "latest"]],
      ["a differently cased library", ["LibA", "1.0"], [" liba ", "1.0"]],
    ] as const)("supersedes a queued job for %s", async (_label, first, second) => {
      const firstId = await manager.enqueueScrapeJob(
        first[0],
        first[1],
        scrapeOptions(first[0]),
      );
      const secondId = await manager.enqueueScrapeJob(
        second[0],
        second[1],
        scrapeOptions(second[0]),
        { onExisting: "replace" },
      );

      expect(await statusOf(firstId)).toBe(PipelineJobStatus.CANCELLED);
      expect(await statusOf(secondId)).toBe(PipelineJobStatus.QUEUED);
    });

    it("supersedes a running job for the same library and version, then runs the new one", async () => {
      const release = holdScrapes();
      await manager.start();
      const firstId = await manager.enqueueScrapeJob(
        "libA",
        "1.0",
        scrapeOptions("libA"),
      );
      await reachStatus(firstId, PipelineJobStatus.RUNNING);

      const secondId = await manager.enqueueScrapeJob(
        "libA",
        "1.0",
        scrapeOptions("libA"),
        { onExisting: "replace" },
      );
      await manager.waitForJobCompletion(firstId);
      await reachStatus(secondId, PipelineJobStatus.RUNNING);
      release();
      await manager.waitForJobCompletion(secondId);

      expect(await statusOf(firstId)).toBe(PipelineJobStatus.CANCELLED);
      expect(await statusOf(secondId)).toBe(PipelineJobStatus.COMPLETED);
    });

    it("keeps the superseded job's last page out of the new job's version", async () => {
      // With room for both, the new job could otherwise start next to the old one
      manager = createManager({ concurrency: 2 });
      const write = holdPageWrite();
      await manager.start();
      const firstId = await manager.enqueueScrapeJob(
        "libA",
        "1.0",
        scrapeOptions("libA"),
      );
      await write.writing;

      const replaced = manager.enqueueScrapeJob("libA", "1.0", scrapeOptions("libA"), {
        onExisting: "replace",
      });
      await new Promise((resolve) => setImmediate(resolve));
      write.release();
      const secondId = await replaced;
      await manager.waitForJobCompletion(secondId);
      await manager.waitForJobCompletion(firstId);

      const versionId = await store.ensureVersion({ library: "libA", version: "1.0" });
      expect(await store.getPagesByVersionId(versionId)).toEqual([]);
    });

    it("keeps jobs for different versions of a library", async () => {
      const firstId = await manager.enqueueScrapeJob(
        "libA",
        "1.0",
        scrapeOptions("libA"),
      );
      await manager.enqueueScrapeJob("libA", "2.0", scrapeOptions("libA", "2.0"));

      expect(await statusOf(firstId)).toBe(PipelineJobStatus.QUEUED);
    });
  });

  describe("running jobs", () => {
    it("runs an enqueued job to completion", async () => {
      await manager.start();
      const jobId = await manager.enqueueScrapeJob("libA", "1.0", scrapeOptions("libA"));
      await manager.waitForJobCompletion(jobId);

      const job = await manager.getJob(jobId);
      expect(job?.status).toBe(PipelineJobStatus.COMPLETED);
      expect(job?.startedAt).toBeInstanceOf(Date);
      expect(job?.finishedAt).toBeInstanceOf(Date);
      expect(scrape).toHaveBeenCalledWith(
        expect.objectContaining({ url: SOURCE_URL, library: "libA", version: "1.0" }),
        expect.any(Function),
        expect.any(AbortSignal),
      );
      const versionId = await store.ensureVersion({ library: "libA", version: "1.0" });
      expect((await store.getVersionById(versionId))?.status).toBe(
        VersionStatus.COMPLETED,
      );
    });

    it("announces each status change on the event bus", async () => {
      await manager.start();
      const jobId = await manager.enqueueScrapeJob("libA", "1.0", scrapeOptions("libA"));
      await manager.waitForJobCompletion(jobId);

      expect(
        statusEvents.filter((job) => job.id === jobId).map((job) => job.status),
      ).toEqual([
        PipelineJobStatus.QUEUED,
        PipelineJobStatus.RUNNING,
        PipelineJobStatus.COMPLETED,
      ]);
    });

    it("fails the job when the scrape throws, and rejects its completion", async () => {
      scrape.mockRejectedValue(new Error("fail"));
      await manager.start();
      const jobId = await manager.enqueueScrapeJob("libA", "1.0", scrapeOptions("libA"));
      await expect(manager.waitForJobCompletion(jobId)).rejects.toThrow("fail");

      const job = await manager.getJob(jobId);
      expect(job?.status).toBe(PipelineJobStatus.FAILED);
      expect(job?.error?.message).toBe("fail");
      const versionId = await store.ensureVersion({ library: "libA", version: "1.0" });
      expect(await store.getVersionById(versionId)).toMatchObject({
        status: VersionStatus.FAILED,
        error_message: "fail",
      });
    });

    it("starts the next queued job when a job finishes at concurrency 1", async () => {
      const release = holdScrapes();
      await manager.start();
      const firstId = await manager.enqueueScrapeJob(
        "libA",
        "1.0",
        scrapeOptions("libA"),
      );
      const secondId = await manager.enqueueScrapeJob(
        "libB",
        "1.0",
        scrapeOptions("libB"),
      );
      await reachStatus(firstId, PipelineJobStatus.RUNNING);

      expect(await statusOf(secondId)).toBe(PipelineJobStatus.QUEUED);

      release();
      await manager.waitForJobCompletion(firstId);
      await manager.waitForJobCompletion(secondId);
      expect(await statusOf(secondId)).toBe(PipelineJobStatus.COMPLETED);
    });

    it("runs jobs in parallel up to the configured concurrency", async () => {
      manager = createManager({ concurrency: 2 });
      holdScrapes();
      await manager.start();
      const firstId = await manager.enqueueScrapeJob(
        "libA",
        "1.0",
        scrapeOptions("libA"),
      );
      const secondId = await manager.enqueueScrapeJob(
        "libB",
        "1.0",
        scrapeOptions("libB"),
      );

      await reachStatus(firstId, PipelineJobStatus.RUNNING);
      await reachStatus(secondId, PipelineJobStatus.RUNNING);
    });

    it("leaves jobs queued after stop and runs them on the next start", async () => {
      await manager.start();
      await manager.stop();

      const jobId = await manager.enqueueScrapeJob("libA", "1.0", scrapeOptions("libA"));
      expect(await statusOf(jobId)).toBe(PipelineJobStatus.QUEUED);
      expect(scrape).not.toHaveBeenCalled();

      await manager.start();
      await manager.waitForJobCompletion(jobId);
      expect(await statusOf(jobId)).toBe(PipelineJobStatus.COMPLETED);
    });

    // start() reads every QUEUED/RUNNING version as interrupted, including those
    // of jobs still queued in memory: with recoverJobs it re-enqueues them,
    // cancelling the original job; without, it marks their version failed.
    it.todo("keeps jobs enqueued before start() out of interrupted-job recovery");

    it("can be stopped when it is not running", async () => {
      await expect(manager.stop()).resolves.toBeUndefined();
      await expect(manager.stop()).resolves.toBeUndefined();
    });
  });

  describe("progress", () => {
    function scrapeReporting(...events: ScraperProgressEvent[]) {
      scrape.mockImplementation(async (_options, onProgress) => {
        for (const event of events) {
          await onProgress(event);
        }
      });
    }

    it("keeps the latest progress on the job, in the store and on the event bus", async () => {
      const progressEvents: ScraperProgressEvent[] = [];
      eventBus.on(EventType.JOB_PROGRESS, ({ progress }) => {
        progressEvents.push(progress);
      });
      scrapeReporting(progress(1, 4), progress(3, 4));
      await manager.start();
      const jobId = await manager.enqueueScrapeJob("libA", "1.0", scrapeOptions("libA"));
      await manager.waitForJobCompletion(jobId);

      expect(await manager.getJob(jobId)).toMatchObject({
        progress: progress(3, 4),
        progressPages: 3,
        progressMaxPages: 4,
        progressPagesIndexed: 2,
      });
      const versionId = await store.ensureVersion({ library: "libA", version: "1.0" });
      expect(await store.getVersionById(versionId)).toMatchObject({
        progress_pages: 3,
        progress_max_pages: 4,
      });
      expect(progressEvents).toEqual([progress(1, 4), progress(3, 4)]);
    });

    it("keeps progress and completes the job when the store cannot record progress", async () => {
      vi.spyOn(store, "updateVersionProgress").mockRejectedValue(new Error("DB error"));
      scrapeReporting(progress(2, 5));
      await manager.start();
      const jobId = await manager.enqueueScrapeJob("libA", "1.0", scrapeOptions("libA"));
      await manager.waitForJobCompletion(jobId);

      expect(await manager.getJob(jobId)).toMatchObject({
        status: PipelineJobStatus.COMPLETED,
        progressPages: 2,
        progressMaxPages: 5,
      });
    });
  });

  describe("cancellation", () => {
    it("cancels a queued job, resolves its completion and never runs it", async () => {
      const jobId = await manager.enqueueScrapeJob("libA", "1.0", scrapeOptions("libA"));

      await manager.cancelJob(jobId);
      await manager.start();

      await expect(manager.waitForJobCompletion(jobId)).resolves.toBeUndefined();
      const job = await manager.getJob(jobId);
      expect(job?.status).toBe(PipelineJobStatus.CANCELLED);
      expect(job?.finishedAt).toBeInstanceOf(Date);
      expect(scrape).not.toHaveBeenCalled();
    });

    it("cancels a running job through its signal and resolves its completion", async () => {
      holdScrapes();
      await manager.start();
      const jobId = await manager.enqueueScrapeJob("libA", "1.0", scrapeOptions("libA"));
      await reachStatus(jobId, PipelineJobStatus.RUNNING);

      await manager.cancelJob(jobId);

      await expect(manager.waitForJobCompletion(jobId)).resolves.toBeUndefined();
      expect(
        statusEvents.filter((job) => job.id === jobId).map((job) => job.status),
      ).toEqual([
        PipelineJobStatus.QUEUED,
        PipelineJobStatus.RUNNING,
        PipelineJobStatus.CANCELLING,
        PipelineJobStatus.CANCELLED,
      ]);
      const versionId = await store.ensureVersion({ library: "libA", version: "1.0" });
      expect((await store.getVersionById(versionId))?.status).toBe(
        VersionStatus.CANCELLED,
      );
    });

    it("leaves a finished job as it is", async () => {
      await manager.start();
      const jobId = await manager.enqueueScrapeJob("libA", "1.0", scrapeOptions("libA"));
      await manager.waitForJobCompletion(jobId);

      await manager.cancelJob(jobId);

      expect(await statusOf(jobId)).toBe(PipelineJobStatus.COMPLETED);
    });

    it("ignores an unknown job id", async () => {
      await expect(manager.cancelJob("unknown")).resolves.toBeUndefined();
    });

    it("rejects waiting for an unknown job id", async () => {
      await expect(manager.waitForJobCompletion("unknown")).rejects.toBeInstanceOf(
        PipelineStateError,
      );
    });
  });

  describe("clearCompletedJobs", () => {
    it("removes finished jobs, keeps the others and announces the change", async () => {
      const jobListChanges = vi.fn();
      eventBus.on(EventType.JOB_LIST_CHANGE, jobListChanges);
      scrape.mockRejectedValueOnce(new Error("fail"));
      await manager.start();
      const failedId = await manager.enqueueScrapeJob(
        "libA",
        "1.0",
        scrapeOptions("libA"),
      );
      await manager.waitForJobCompletion(failedId).catch(() => {});
      const completedId = await manager.enqueueScrapeJob(
        "libB",
        "1.0",
        scrapeOptions("libB"),
      );
      await manager.waitForJobCompletion(completedId);
      await manager.stop();
      const cancelledId = await manager.enqueueScrapeJob(
        "libC",
        "1.0",
        scrapeOptions("libC"),
      );
      await manager.cancelJob(cancelledId);
      const queuedId = await manager.enqueueScrapeJob(
        "libD",
        "1.0",
        scrapeOptions("libD"),
      );

      const cleared = await manager.clearCompletedJobs();

      expect(cleared).toBe(3);
      expect((await manager.getJobs()).map((job) => job.id)).toEqual([queuedId]);
      expect(jobListChanges).toHaveBeenCalledOnce();
    });

    it("returns 0 and announces nothing when no job has finished", async () => {
      const jobListChanges = vi.fn();
      eventBus.on(EventType.JOB_LIST_CHANGE, jobListChanges);
      await manager.enqueueScrapeJob("libA", "1.0", scrapeOptions("libA"));

      expect(await manager.clearCompletedJobs()).toBe(0);
      expect(jobListChanges).not.toHaveBeenCalled();
    });
  });

  describe("enqueueRefreshJob", () => {
    const pages = [
      { url: `${SOURCE_URL}/deep`, depth: 5, etag: '"deep"' },
      { url: `${SOURCE_URL}/shallow`, depth: 0, etag: null },
    ];

    it.each([
      ["1.0", "1.0"],
      [null, null],
    ])("re-checks every stored page of version %j", async (version, publicVersion) => {
      await seedVersion("libA", version ?? "", VersionStatus.COMPLETED, {
        pages,
        options: { maxDepth: 2, maxPages: 50 },
      });

      const jobId = await manager.enqueueRefreshJob("libA", version);

      const job = await manager.getJob(jobId);
      expect(job?.version).toBe(publicVersion);
      expect(job?.scraperOptions).toMatchObject({ isRefresh: true, maxDepth: 2 });
      const queue = job?.scraperOptions?.initialQueue ?? [];
      expect(queue).toHaveLength(2);
      expect(queue).toEqual(
        expect.arrayContaining(
          pages.map((page) =>
            expect.objectContaining({
              url: page.url,
              depth: page.depth,
              etag: page.etag,
              pageId: expect.any(Number),
            }),
          ),
        ),
      );
    });

    it("requests a representation from where its content came from", async () => {
      const contentUrl = `${SOURCE_URL}/page.md`;
      await seedVersion("libA", "1.0", VersionStatus.COMPLETED, {
        pages: [{ url: `${SOURCE_URL}/page`, depth: 1, etag: '"md"', contentUrl }],
      });

      const jobId = await manager.enqueueRefreshJob("libA", "1.0");

      const job = await manager.getJob(jobId);
      expect(job?.scraperOptions?.initialQueue).toEqual([
        expect.objectContaining({ url: contentUrl, identityUrl: `${SOURCE_URL}/page` }),
      ]);
    });

    it.each([
      ["1.0", "No pages found for libA@1.0"],
      [undefined, "No pages found for libA@latest"],
    ])("rejects version %j when it has no pages", async (version, message) => {
      await seedVersion("libA", version ?? "", VersionStatus.COMPLETED);

      await expect(manager.enqueueRefreshJob("libA", version)).rejects.toThrow(message);
    });

    it.each([VersionStatus.FAILED, VersionStatus.QUEUED])(
      "re-scrapes a %s version from scratch with its stored options",
      async (status) => {
        await seedVersion("libA", "1.0", status, { pages, options: { maxDepth: 2 } });

        const jobId = await manager.enqueueRefreshJob("libA", "1.0");

        const options = (await manager.getJob(jobId))?.scraperOptions;
        expect(options).toMatchObject({ url: SOURCE_URL, maxDepth: 2 });
        expect(options?.isRefresh).toBeUndefined();
        expect(options?.initialQueue).toBeUndefined();
      },
    );

    it("rejects an unknown library without creating it", async () => {
      await expect(manager.enqueueRefreshJob("Reakt", "")).rejects.toBeInstanceOf(
        LibraryNotFoundInStoreError,
      );

      expect(await store.listLibraries()).toEqual([]);
      expect(await manager.getJobs()).toEqual([]);
    });

    it("names the library as it is stored in its errors", async () => {
      await seedVersion("React", "1.0.0", VersionStatus.COMPLETED);

      await expect(manager.enqueueRefreshJob("react", "1.0.0")).rejects.toThrow(
        "No pages found for React@1.0.0",
      );
    });

    it("rejects re-scraping a version without stored options", async () => {
      await seedVersion("libA", "1.0", VersionStatus.FAILED, { options: null });

      await expect(manager.enqueueRefreshJob("libA", "1.0")).rejects.toThrow(
        "No stored scraper options found for libA@1.0",
      );
    });

    it.each([
      ["keeps stored preserveHashes", { preserveHashes: true }, undefined, true],
      ["overrides stored preserveHashes", { preserveHashes: true }, false, false],
    ])("%s", async (_label, stored, override, expected) => {
      await seedVersion("libA", "1.0", VersionStatus.COMPLETED, {
        pages: [{ url: `${SOURCE_URL}/#/guide`, depth: 0, etag: null }],
        options: stored,
      });

      const jobId = await manager.enqueueRefreshJob("libA", "1.0", {
        preserveHashes: override,
      });

      expect((await manager.getJob(jobId))?.scraperOptions?.preserveHashes).toBe(
        expected,
      );
    });

    it("defaults scrapeMode to auto when the stored options predate it", async () => {
      // The seeded options carry no scrapeMode, like those written before it was stored.
      await seedVersion("libA", "1.0", VersionStatus.COMPLETED, {
        pages: [{ url: `${SOURCE_URL}/page`, depth: 0, etag: null }],
        options: { preserveHashes: true },
      });

      const jobId = await manager.enqueueRefreshJob("libA", "1.0");

      expect((await manager.getJob(jobId))?.scraperOptions?.scrapeMode).toBe(
        ScrapeMode.Auto,
      );
    });
  });

  describe("interrupted jobs on start", () => {
    async function seedInterrupted() {
      const runningId = await seedVersion("lib-a", "1.0", VersionStatus.RUNNING);
      const queuedId = await seedVersion("lib-b", "2.0", VersionStatus.QUEUED);
      return { runningId, queuedId };
    }

    it("re-enqueues them when recovery is enabled", async () => {
      await seedInterrupted();
      manager = createManager({ recoverJobs: true });
      holdScrapes();

      await manager.start();

      const jobs = await manager.getJobs();
      expect(jobs.map((job) => [job.library, job.version, job.sourceUrl])).toEqual(
        expect.arrayContaining([
          ["lib-a", "1.0", SOURCE_URL],
          ["lib-b", "2.0", SOURCE_URL],
        ]),
      );
      expect(jobs).toHaveLength(2);
    });

    it("marks a version failed when recovery cannot re-enqueue it", async () => {
      const versionId = await seedVersion("lib-a", "1.0", VersionStatus.RUNNING, {
        options: null,
      });
      manager = createManager({ recoverJobs: true });

      await manager.start();

      expect(await store.getVersionById(versionId)).toMatchObject({
        status: VersionStatus.FAILED,
        error_message: expect.stringContaining("Recovery failed"),
      });
      expect(await manager.getJobs()).toEqual([]);
    });

    it("marks them failed without enqueueing when recovery is disabled", async () => {
      const { runningId, queuedId } = await seedInterrupted();
      manager = createManager({ recoverJobs: false });

      await manager.start();

      for (const versionId of [runningId, queuedId]) {
        expect(await store.getVersionById(versionId)).toMatchObject({
          status: VersionStatus.FAILED,
          error_message: "Job interrupted",
        });
      }
      expect(await manager.getJobs()).toEqual([]);
    });
  });
});
