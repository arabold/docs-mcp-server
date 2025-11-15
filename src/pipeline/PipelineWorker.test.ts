import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ScraperService } from "../scraper";
import type { ScrapeResult, ScraperProgressEvent } from "../scraper/types";
import type { DocumentManagementService } from "../store/DocumentManagementService";
import { PipelineWorker } from "./PipelineWorker";
import type { InternalPipelineJob, PipelineManagerCallbacks } from "./types";
import { PipelineJobStatus } from "./types";

// Mock dependencies
vi.mock("../store/DocumentManagementService");
vi.mock("../scraper/ScraperService");

describe("PipelineWorker", () => {
  let mockStore: Partial<DocumentManagementService>;
  let mockScraperService: Partial<ScraperService>;
  let mockCallbacks: PipelineManagerCallbacks;
  let worker: PipelineWorker;
  let mockJob: InternalPipelineJob;
  let abortController: AbortController;

  beforeEach(() => {
    vi.resetAllMocks();

    mockStore = {
      addScrapeResult: vi.fn().mockResolvedValue(undefined),
      removeAllDocuments: vi.fn().mockResolvedValue(undefined),
      deletePage: vi.fn().mockResolvedValue(undefined),
    };

    mockScraperService = {
      // Mock scrape to allow simulation of progress callbacks
      scrape: vi.fn().mockImplementation(async (_options, _progressCallback, _signal) => {
        // Default: simulate immediate completion with no documents
        return Promise.resolve();
      }),
    };

    mockCallbacks = {
      onJobProgress: vi.fn().mockResolvedValue(undefined),
      onJobError: vi.fn().mockResolvedValue(undefined),
      onJobStatusChange: vi.fn().mockResolvedValue(undefined), // Not used by worker directly, but part of type
    };

    worker = new PipelineWorker(
      mockStore as DocumentManagementService,
      mockScraperService as ScraperService,
    );

    // Create a default mock job for tests
    abortController = new AbortController();
    mockJob = {
      id: "test-job-id",
      library: "test-lib",
      version: "1.0.0",
      status: PipelineJobStatus.RUNNING, // Assume worker receives a running job
      progress: null,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: null,
      abortController: abortController,
      completionPromise: Promise.resolve(), // Mock promise parts if needed, but worker doesn't use them directly
      resolveCompletion: vi.fn(),
      rejectCompletion: vi.fn(),
      sourceUrl: "http://example.com",
      scraperOptions: {
        url: "http://example.com",
        library: "test-lib",
        version: "1.0.0",
        maxPages: 10,
        maxDepth: 1,
      },
    };
  });

  it("should execute job successfully, calling scrape, addScrapeResult, and onJobProgress", async () => {
    const mockProcessed1: ScrapeResult = {
      textContent: "doc1",
      url: "url1",
      title: "Doc 1",
      contentType: "text/html",
      chunks: [],
      links: [],
      errors: [],
    };
    const mockProcessed2: ScrapeResult = {
      textContent: "doc2",
      url: "url2",
      title: "Doc 2",
      contentType: "text/html",
      chunks: [],
      links: [],
      errors: [],
    };

    // Configure mock scrape to yield progress
    (mockScraperService.scrape as Mock).mockImplementation(
      async (_options, progressCallback, _signal) => {
        const progress1: ScraperProgressEvent = {
          pagesScraped: 1,
          totalPages: 2,
          currentUrl: "url1",
          depth: 1,
          maxDepth: 1,
          result: mockProcessed1,
          totalDiscovered: 0,
        };
        await progressCallback(progress1);

        const progress2: ScraperProgressEvent = {
          pagesScraped: 2,
          totalPages: 2,
          currentUrl: "url2",
          depth: 1,
          maxDepth: 1,
          result: mockProcessed2,
          totalDiscovered: 0,
        };
        await progressCallback(progress2);
      },
    );

    await worker.executeJob(mockJob, mockCallbacks);

    // Verify documents were cleared before scraping started
    expect(mockStore.removeAllDocuments).toHaveBeenCalledOnce();
    expect(mockStore.removeAllDocuments).toHaveBeenCalledWith(
      mockJob.library,
      mockJob.version,
    );

    // Verify scrape was called with the complete scraper options
    expect(mockScraperService.scrape).toHaveBeenCalledOnce();
    expect(mockScraperService.scrape).toHaveBeenCalledWith(
      mockJob.scraperOptions, // Now passes the complete options directly
      expect.any(Function), // The progress callback
      abortController.signal,
    );

    // Verify addScrapeResult was called for each document
    expect(mockStore.addScrapeResult).toHaveBeenCalledTimes(2);
    expect(mockStore.addScrapeResult).toHaveBeenCalledWith(
      mockJob.library,
      mockJob.version,
      1,
      mockProcessed1,
    );
    expect(mockStore.addScrapeResult).toHaveBeenCalledWith(
      mockJob.library,
      mockJob.version,
      1,
      mockProcessed2,
    );

    // Verify onJobProgress was called
    expect(mockCallbacks.onJobProgress).toHaveBeenCalledTimes(2);
    expect(mockCallbacks.onJobProgress).toHaveBeenCalledWith(
      mockJob,
      expect.objectContaining({ result: mockProcessed1 }),
    );
    expect(mockCallbacks.onJobProgress).toHaveBeenCalledWith(
      mockJob,
      expect.objectContaining({ result: mockProcessed2 }),
    );

    // Verify job progress object was NOT updated directly by worker
    // The worker should only call callbacks - the manager handles progress updates
    expect(mockJob.progress).toBeNull(); // Should remain null since worker doesn't update it directly

    // Verify no errors were reported
    expect(mockCallbacks.onJobError).not.toHaveBeenCalled();
  });

  it("should re-throw error if scraperService.scrape fails", async () => {
    const scraperError = new Error("Scraper failed");
    (mockScraperService.scrape as Mock).mockRejectedValue(scraperError);

    await expect(worker.executeJob(mockJob, mockCallbacks)).rejects.toThrow(scraperError);

    // Verify dependencies were called appropriately
    expect(mockScraperService.scrape).toHaveBeenCalledOnce();
    expect(mockStore.addScrapeResult).not.toHaveBeenCalled();
    expect(mockCallbacks.onJobProgress).not.toHaveBeenCalled();
    expect(mockCallbacks.onJobError).not.toHaveBeenCalled();
  });

  it("should call onJobError and continue if store.addScrapeResult fails", async () => {
    const mockProcessed: ScrapeResult = {
      textContent: "doc1",
      url: "url1",
      title: "Doc 1",
      contentType: "text/html",
      chunks: [],
      links: [],
      errors: [],
    };
    const storeError = new Error("Database error");

    // Simulate scrape yielding one document
    (mockScraperService.scrape as Mock).mockImplementation(
      async (_options, progressCallback, _signal) => {
        const progress: ScraperProgressEvent = {
          pagesScraped: 1,
          totalPages: 1,
          currentUrl: "url1",
          depth: 1,
          maxDepth: 1,
          result: mockProcessed,
          totalDiscovered: 0,
        };
        await progressCallback(progress);
      },
    );

    // Simulate addScrapeResult failing
    (mockStore.addScrapeResult as Mock).mockRejectedValue(storeError);

    // Execute the job - should complete despite the error
    await expect(worker.executeJob(mockJob, mockCallbacks)).resolves.toBeUndefined();

    // Verify scrape was called
    expect(mockScraperService.scrape).toHaveBeenCalledOnce();
    // Verify addScrapeResult was called
    expect(mockStore.addScrapeResult).toHaveBeenCalledOnce();
    // Verify onJobProgress was called
    expect(mockCallbacks.onJobProgress).toHaveBeenCalledOnce();
    // Verify onJobError was called with the page that failed
    expect(mockCallbacks.onJobError).toHaveBeenCalledOnce();
    expect(mockCallbacks.onJobError).toHaveBeenCalledWith(
      mockJob,
      storeError,
      mockProcessed,
    );
  });

  it("should throw CancellationError if cancelled during scrape progress", async () => {
    const mockProcessed: ScrapeResult = {
      textContent: "doc1",
      url: "url1",
      title: "Doc 1",
      contentType: "text/html",
      chunks: [],
      links: [],
      errors: [],
    };

    // Simulate scrape checking signal and throwing
    (mockScraperService.scrape as Mock).mockImplementation(
      async (_options, progressCallback, _signal) => {
        const progress: ScraperProgressEvent = {
          pagesScraped: 1,
          totalPages: 2,
          currentUrl: "url1",
          depth: 1,
          maxDepth: 1,
          result: mockProcessed,
          totalDiscovered: 0,
        };
        // Simulate cancellation happening *before* progress is processed by worker
        abortController.abort();
        // The worker's callback wrapper will check signal and throw
        await progressCallback(progress);
        // This part should not be reached
        throw new Error("Should have been cancelled");
      },
    );

    // Call executeJob once and check the specific error message
    await expect(worker.executeJob(mockJob, mockCallbacks)).rejects.toThrow(
      "Job cancelled during scraping progress",
    );
    // Also verify it's an instance of CancellationError if needed, though message check is often sufficient
    // await expect(worker.executeJob(mockJob, mockCallbacks)).rejects.toBeInstanceOf(CancellationError);

    // Verify scrape was called
    expect(mockScraperService.scrape).toHaveBeenCalledOnce();
    // Verify addScrapeResult was NOT called
    expect(mockStore.addScrapeResult).not.toHaveBeenCalled();
    // Verify onJobProgress was NOT called because cancellation check happens first
    expect(mockCallbacks.onJobProgress).not.toHaveBeenCalled();
    // Verify onJobError was NOT called
    expect(mockCallbacks.onJobError).not.toHaveBeenCalled();
  });

  it("should throw CancellationError if cancelled after scrape completes", async () => {
    // Simulate scrape completing successfully
    (mockScraperService.scrape as Mock).mockImplementation(
      async (_options, _progressCallback, _signal) => {
        // No progress needed for this test
        return Promise.resolve();
      },
    );

    // Abort *after* scrape would have finished but before worker checks again
    abortController.abort();

    // Call executeJob once and check the specific error message
    await expect(worker.executeJob(mockJob, mockCallbacks)).rejects.toThrow(
      "Job cancelled",
    );
    // Also verify it's an instance of CancellationError if needed
    // await expect(worker.executeJob(mockJob, mockCallbacks)).rejects.toBeInstanceOf(CancellationError);

    // Verify scrape was called (now only once)
    expect(mockScraperService.scrape).toHaveBeenCalledOnce();
    // Verify other callbacks not called
    expect(mockStore.addScrapeResult).not.toHaveBeenCalled();
    expect(mockCallbacks.onJobProgress).not.toHaveBeenCalled();
    expect(mockCallbacks.onJobError).not.toHaveBeenCalled();
  });

  it("should fail the job if document deletion fails during refresh", async () => {
    const deletionError = new Error("Database deletion failed");

    // Simulate scrape yielding a deletion event (404 page)
    (mockScraperService.scrape as Mock).mockImplementation(
      async (_options, progressCallback, _signal) => {
        const progress: ScraperProgressEvent = {
          pagesScraped: 1,
          totalPages: 1,
          currentUrl: "url1",
          depth: 1,
          maxDepth: 1,
          deleted: true, // This is a deletion event
          result: null,
          pageId: 123, // Page ID to delete
          totalDiscovered: 0,
        };
        await progressCallback(progress);
      },
    );

    // Simulate deletePage failing
    (mockStore.deletePage as Mock).mockRejectedValue(deletionError);

    // Execute the job - should fail due to deletion error
    await expect(worker.executeJob(mockJob, mockCallbacks)).rejects.toThrow(
      "Database deletion failed",
    );

    // Verify scrape was called
    expect(mockScraperService.scrape).toHaveBeenCalledOnce();
    // Verify deletion was attempted
    expect(mockStore.deletePage).toHaveBeenCalledWith(123);
    // Verify onJobProgress was called
    expect(mockCallbacks.onJobProgress).toHaveBeenCalledOnce();
    // Verify onJobError was called with the deletion error
    expect(mockCallbacks.onJobError).toHaveBeenCalledOnce();
    expect(mockCallbacks.onJobError).toHaveBeenCalledWith(mockJob, deletionError);
    // Verify addScrapeResult was NOT called (deletion failed before that)
    expect(mockStore.addScrapeResult).not.toHaveBeenCalled();
  });

  describe("Database operations based on fetch status", () => {
    it("should perform NO database writes for a 304 Not Modified status", async () => {
      // Simulate scrape yielding a 304 Not Modified event
      (mockScraperService.scrape as Mock).mockImplementation(
        async (_options, progressCallback, _signal) => {
          const progress: ScraperProgressEvent = {
            pagesScraped: 1,
            totalPages: 1,
            currentUrl: "url1",
            depth: 1,
            maxDepth: 1,
            result: null, // No result for 304
            deleted: false,
            pageId: 123, // Page ID from refresh queue
            totalDiscovered: 0,
          };
          await progressCallback(progress);
        },
      );

      await worker.executeJob(mockJob, mockCallbacks);

      // Verify NO database operations were performed
      expect(mockStore.deletePage).not.toHaveBeenCalled();
      expect(mockStore.addScrapeResult).not.toHaveBeenCalled();

      // Verify progress was still reported
      expect(mockCallbacks.onJobProgress).toHaveBeenCalledOnce();
      expect(mockCallbacks.onJobProgress).toHaveBeenCalledWith(
        mockJob,
        expect.objectContaining({
          result: null,
          deleted: false,
          pageId: 123,
        }),
      );
    });

    it("should DELETE existing documents and INSERT new ones for a 200 OK status on an existing page", async () => {
      const mockResult: ScrapeResult = {
        textContent: "updated content",
        url: "url1",
        title: "Updated Doc",
        contentType: "text/html",
        chunks: [],
        links: [],
        errors: [],
      };

      // Simulate scrape yielding a 200 OK event with pageId (existing page)
      (mockScraperService.scrape as Mock).mockImplementation(
        async (_options, progressCallback, _signal) => {
          const progress: ScraperProgressEvent = {
            pagesScraped: 1,
            totalPages: 1,
            currentUrl: "url1",
            depth: 1,
            maxDepth: 1,
            result: mockResult,
            pageId: 123, // Existing page ID
            totalDiscovered: 0,
          };
          await progressCallback(progress);
        },
      );

      await worker.executeJob(mockJob, mockCallbacks);

      // Verify DELETE was called first
      expect(mockStore.deletePage).toHaveBeenCalledOnce();
      expect(mockStore.deletePage).toHaveBeenCalledWith(123);

      // Verify INSERT (addScrapeResult) was called after deletion
      expect(mockStore.addScrapeResult).toHaveBeenCalledOnce();
      expect(mockStore.addScrapeResult).toHaveBeenCalledWith(
        mockJob.library,
        mockJob.version,
        1,
        mockResult,
      );

      // Verify call order: delete before add
      const deleteCallOrder = (mockStore.deletePage as Mock).mock.invocationCallOrder[0];
      const addCallOrder = (mockStore.addScrapeResult as Mock).mock
        .invocationCallOrder[0];
      expect(deleteCallOrder).toBeLessThan(addCallOrder);

      // Verify progress was reported
      expect(mockCallbacks.onJobProgress).toHaveBeenCalledOnce();
    });

    it("should INSERT new documents for a 200 OK status on a new page", async () => {
      const mockResult: ScrapeResult = {
        textContent: "new content",
        url: "url2",
        title: "New Doc",
        contentType: "text/html",
        chunks: [],
        links: [],
        errors: [],
      };

      // Simulate scrape yielding a 200 OK event without pageId (new page)
      (mockScraperService.scrape as Mock).mockImplementation(
        async (_options, progressCallback, _signal) => {
          const progress: ScraperProgressEvent = {
            pagesScraped: 1,
            totalPages: 1,
            currentUrl: "url2",
            depth: 1,
            maxDepth: 1,
            result: mockResult,
            pageId: undefined, // No pageId = new page
            totalDiscovered: 0,
          };
          await progressCallback(progress);
        },
      );

      await worker.executeJob(mockJob, mockCallbacks);

      // Verify NO deletion was performed (new page)
      expect(mockStore.deletePage).not.toHaveBeenCalled();

      // Verify INSERT (addScrapeResult) was called
      expect(mockStore.addScrapeResult).toHaveBeenCalledOnce();
      expect(mockStore.addScrapeResult).toHaveBeenCalledWith(
        mockJob.library,
        mockJob.version,
        1,
        mockResult,
      );

      // Verify progress was reported
      expect(mockCallbacks.onJobProgress).toHaveBeenCalledOnce();
    });

    it("should call deletePage for a 404 Not Found status", async () => {
      // Simulate scrape yielding a 404 Not Found event
      (mockScraperService.scrape as Mock).mockImplementation(
        async (_options, progressCallback, _signal) => {
          const progress: ScraperProgressEvent = {
            pagesScraped: 1,
            totalPages: 1,
            currentUrl: "url1",
            depth: 1,
            maxDepth: 1,
            result: null,
            deleted: true, // 404 - page was deleted
            pageId: 123,
            totalDiscovered: 0,
          };
          await progressCallback(progress);
        },
      );

      await worker.executeJob(mockJob, mockCallbacks);

      // Verify deletion was called
      expect(mockStore.deletePage).toHaveBeenCalledOnce();
      expect(mockStore.deletePage).toHaveBeenCalledWith(123);

      // Verify NO insert was performed
      expect(mockStore.addScrapeResult).not.toHaveBeenCalled();

      // Verify progress was reported
      expect(mockCallbacks.onJobProgress).toHaveBeenCalledOnce();
      expect(mockCallbacks.onJobProgress).toHaveBeenCalledWith(
        mockJob,
        expect.objectContaining({
          deleted: true,
          pageId: 123,
        }),
      );
    });
  });
});
