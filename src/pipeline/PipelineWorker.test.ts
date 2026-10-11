import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScraperService } from "../scraper";
import {
  PageOutcome,
  type ScrapeResult,
  type ScraperProgressEvent,
} from "../scraper/types";
import type { DocumentManagementService } from "../store/DocumentManagementService";
import { CancellationError } from "./errors";
import { PipelineWorker } from "./PipelineWorker";
import { type InternalPipelineJob, PipelineJobStatus } from "./types";

const LIBRARY = "test-lib";
const VERSION = "1.0.0";

const scrapeResult: ScrapeResult = {
  textContent: "content",
  url: "https://example.com/page",
  title: "Page",
  sourceContentType: "text/html",
  contentType: "text/html",
  chunks: [],
  links: [],
  errors: [],
};

const emptyPage: NonNullable<ScraperProgressEvent["emptyPage"]> = {
  url: "https://example.com/page",
  title: "Empty page",
  sourceContentType: "text/html",
  contentType: "text/markdown",
  etag: '"v1"',
  lastModified: null,
  pipelineFailed: false,
};

/** A progress event for one processed page; fields not given are neutral. */
function progress(
  overrides: Partial<ScraperProgressEvent> & Pick<ScraperProgressEvent, "outcome">,
): ScraperProgressEvent {
  return {
    pagesScraped: 1,
    totalPages: 1,
    totalDiscovered: 1,
    pagesIndexed: 0,
    currentUrl: "https://example.com/page",
    depth: 1,
    maxDepth: 1,
    result: null,
    ...overrides,
  };
}

describe("PipelineWorker", () => {
  const store = {
    removeAllDocuments: vi.fn(),
    addScrapeResult: vi.fn(),
    addEmptyPage: vi.fn(),
    deletePage: vi.fn(),
  };
  const scraper = { scrape: vi.fn() };
  const callbacks = { onJobProgress: vi.fn(), onJobError: vi.fn() };
  const worker = new PipelineWorker(
    store as unknown as DocumentManagementService,
    scraper as unknown as ScraperService,
  );
  let job: InternalPipelineJob;

  /** Makes the scraper report the given events, in order, then finish. */
  function scrapeReports(...events: ScraperProgressEvent[]) {
    scraper.scrape.mockImplementation(
      async (_options, onProgress: (event: ScraperProgressEvent) => Promise<void>) => {
        for (const event of events) {
          await onProgress(event);
        }
      },
    );
  }

  /** Every write the worker made to the store after the initial clear. */
  function storeWrites() {
    return [
      ...store.addScrapeResult.mock.calls.map((args) => ["addScrapeResult", ...args]),
      ...store.addEmptyPage.mock.calls.map((args) => ["addEmptyPage", ...args]),
      ...store.deletePage.mock.calls.map((args) => ["deletePage", ...args]),
    ];
  }

  beforeEach(() => {
    vi.resetAllMocks();
    scraper.scrape.mockResolvedValue(undefined);
    job = {
      id: "test-job-id",
      library: LIBRARY,
      version: VERSION,
      versionId: 1,
      status: PipelineJobStatus.RUNNING,
      progress: null,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: null,
      abortController: new AbortController(),
      completionPromise: Promise.resolve(),
      resolveCompletion: vi.fn(),
      rejectCompletion: vi.fn(),
      sourceUrl: "https://example.com",
      scraperOptions: {
        url: "https://example.com",
        library: LIBRARY,
        version: VERSION,
        maxPages: 10,
        maxDepth: 1,
      },
    };
  });

  it("scrapes with the job's options and abort signal", async () => {
    await worker.executeJob(job, callbacks);

    expect(scraper.scrape).toHaveBeenCalledWith(
      job.scraperOptions,
      expect.any(Function),
      job.abortController.signal,
    );
  });

  describe("clearing the version before scraping", () => {
    it("removes the stored documents first by default", async () => {
      await worker.executeJob(job, callbacks);

      expect(store.removeAllDocuments).toHaveBeenCalledWith(LIBRARY, VERSION);
      expect(store.removeAllDocuments.mock.invocationCallOrder[0]).toBeLessThan(
        scraper.scrape.mock.invocationCallOrder[0],
      );
    });

    it.each([
      ["a refresh", { isRefresh: true }],
      ["clean: false", { clean: false }],
    ])("keeps the stored documents for %s", async (_label, options) => {
      job.scraperOptions = { ...job.scraperOptions, ...options };

      await worker.executeJob(job, callbacks);

      expect(store.removeAllDocuments).not.toHaveBeenCalled();
    });
  });

  it("reports every progress event to the manager", async () => {
    const events = [
      progress({ outcome: PageOutcome.Stored, result: scrapeResult }),
      progress({ outcome: PageOutcome.Unchanged, pageId: 7 }),
    ];
    scrapeReports(...events);

    await worker.executeJob(job, callbacks);

    expect(callbacks.onJobProgress.mock.calls).toEqual(
      events.map((event) => [job, event]),
    );
  });

  describe("page outcomes", () => {
    it.each([
      [
        "Stored, new page",
        progress({ outcome: PageOutcome.Stored, result: scrapeResult }),
        [["addScrapeResult", LIBRARY, VERSION, 1, scrapeResult, undefined]],
      ],
      // The old row is retired inside the store's write transaction, so the
      // precedence check can still compare it against the new content.
      [
        "Stored, refreshed page",
        progress({ outcome: PageOutcome.Stored, result: scrapeResult, pageId: 123 }),
        [["addScrapeResult", LIBRARY, VERSION, 1, scrapeResult, 123]],
      ],
      ["Stored, no result", progress({ outcome: PageOutcome.Stored }), []],
      [
        "Empty, page",
        progress({ outcome: PageOutcome.Empty, emptyPage, pageId: 123 }),
        [
          [
            "addEmptyPage",
            LIBRARY,
            VERSION,
            1,
            {
              url: emptyPage.url,
              contentUrl: undefined,
              title: emptyPage.title,
              sourceContentType: emptyPage.sourceContentType,
              contentType: emptyPage.contentType,
              etag: emptyPage.etag,
              lastModified: emptyPage.lastModified,
              isAdditionalRepresentation: undefined,
            },
            123,
          ],
        ],
      ],
      // A failed extraction says nothing about the page, so stored content stays.
      [
        "Empty, pipeline failed",
        progress({
          outcome: PageOutcome.Empty,
          emptyPage: { ...emptyPage, pipelineFailed: true },
          pageId: 123,
        }),
        [],
      ],
      ["Empty, container", progress({ outcome: PageOutcome.Empty }), []],
      [
        "Absent, stored page",
        progress({ outcome: PageOutcome.Absent, deleted: true, pageId: 123 }),
        [["deletePage", 123]],
      ],
      // A broken link found mid-crawl has nothing stored to remove.
      [
        "Absent, never stored",
        progress({ outcome: PageOutcome.Absent, deleted: true }),
        [],
      ],
      ["Unchanged", progress({ outcome: PageOutcome.Unchanged, pageId: 123 }), []],
      ["Skipped", progress({ outcome: PageOutcome.Skipped }), []],
      ["Failed", progress({ outcome: PageOutcome.Failed, pageId: 123 }), []],
    ])("%s", async (_label, event, expectedWrites) => {
      scrapeReports(event);

      await worker.executeJob(job, callbacks);

      expect(storeWrites()).toEqual(expectedWrites);
      expect(callbacks.onJobError).not.toHaveBeenCalled();
    });
  });

  describe("store failures", () => {
    const storeError = new Error("Database error");

    it.each([
      [
        "storing content",
        "addScrapeResult",
        progress({ outcome: PageOutcome.Stored, result: scrapeResult }),
        [scrapeResult],
      ],
      [
        "recording an empty page",
        "addEmptyPage",
        progress({ outcome: PageOutcome.Empty, emptyPage }),
        [],
      ],
    ] as const)(
      "reports a failure %s and continues the job",
      async (_label, method, event, page) => {
        store[method].mockRejectedValue(storeError);
        scrapeReports(event, event);

        await expect(worker.executeJob(job, callbacks)).resolves.toBeUndefined();

        expect(store[method]).toHaveBeenCalledTimes(2);
        expect(callbacks.onJobError).toHaveBeenCalledWith(job, storeError, ...page);
      },
    );

    // Leaving the documents of a deleted page behind would corrupt the index.
    it("reports a failure deleting a page and fails the job", async () => {
      store.deletePage.mockRejectedValue(storeError);
      scrapeReports(
        progress({ outcome: PageOutcome.Absent, deleted: true, pageId: 123 }),
      );

      await expect(worker.executeJob(job, callbacks)).rejects.toBe(storeError);

      expect(callbacks.onJobError).toHaveBeenCalledWith(job, storeError);
    });
  });

  it("rethrows a scraper failure without reporting it as a page error", async () => {
    const scraperError = new Error("Scraper failed");
    scraper.scrape.mockRejectedValue(scraperError);

    await expect(worker.executeJob(job, callbacks)).rejects.toBe(scraperError);

    expect(callbacks.onJobError).not.toHaveBeenCalled();
  });

  describe("cancellation", () => {
    it("stops at the next progress event without storing or reporting it", async () => {
      scraper.scrape.mockImplementation(
        async (_options, onProgress: (event: ScraperProgressEvent) => Promise<void>) => {
          job.abortController.abort();
          await onProgress(
            progress({ outcome: PageOutcome.Stored, result: scrapeResult }),
          );
        },
      );

      const error = await worker.executeJob(job, callbacks).catch((e) => e);

      expect(error).toBeInstanceOf(CancellationError);
      expect(error.message).toBe("Job cancelled during scraping progress");
      expect(storeWrites()).toEqual([]);
      expect(callbacks.onJobProgress).not.toHaveBeenCalled();
    });

    it("fails a job whose signal aborted by the time the scrape returns", async () => {
      scraper.scrape.mockImplementation(async () => {
        job.abortController.abort();
      });

      const error = await worker.executeJob(job, callbacks).catch((e) => e);

      expect(error).toBeInstanceOf(CancellationError);
      expect(error.message).toBe("Job cancelled");
    });
  });
});
