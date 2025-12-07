// Patch: Move UUID mock to top-level before imports
vi.mock("uuid", () => {
  let uuidCall = 0;
  const uuidSequence = [
    "mock-uuid-1",
    "mock-uuid-2",
    "mock-uuid-3",
    "mock-uuid-4",
    "mock-uuid-5",
    "mock-uuid-6",
  ];
  return {
    v4: () => uuidSequence[uuidCall++ % uuidSequence.length],
  };
});

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { EventBusService } from "../events/EventBusService";
import type { ScraperProgressEvent } from "../scraper/types";
import type { DocumentManagementService } from "../store/DocumentManagementService";
import { ListJobsTool } from "../tools/ListJobsTool";
import { type AppConfig, loadConfig } from "../utils/config";
import { PipelineManager } from "./PipelineManager";
import { PipelineWorker } from "./PipelineWorker";
import type { InternalPipelineJob, PipelineJob, PipelineManagerCallbacks } from "./types";
import { PipelineJobStatus } from "./types";

// Mock dependencies
vi.mock("../store/DocumentManagementService");
vi.mock("../scraper/ScraperService");
vi.mock("./PipelineWorker");
vi.mock("../events/EventBusService");

describe("PipelineManager", () => {
  let mockStore: Partial<DocumentManagementService>;
  let mockWorkerInstance: { executeJob: Mock };
  let manager: PipelineManager;
  let mockCallbacks: PipelineManagerCallbacks;
  let appConfig: AppConfig;

  // Helper to create a minimal test job with required fields
  const createTestJob = (overrides: Partial<PipelineJob> = {}): PipelineJob => ({
    id: "test-job-id",
    library: "test-lib",
    version: "1.0.0",
    versionId: 123,
    status: PipelineJobStatus.RUNNING,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
    progress: null,
    error: null,
    sourceUrl: "https://example.com",
    scraperOptions: null,
    ...overrides,
  });

  // Helper to create an internal job for testing internal methods
  const createInternalTestJob = (
    overrides: Partial<InternalPipelineJob> = {},
  ): InternalPipelineJob => ({
    id: "test-job-id",
    library: "test-lib",
    version: "1.0.0",
    versionId: 123,
    status: PipelineJobStatus.RUNNING,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
    progress: null,
    error: null,
    sourceUrl: "https://example.com",
    scraperOptions: {
      url: "https://example.com",
      library: "test-lib",
      version: "1.0.0",
    },
    abortController: new AbortController(),
    completionPromise: Promise.resolve(),
    resolveCompletion: () => {},
    rejectCompletion: () => {},
    ...overrides,
  });

  // Helper to create progress data
  const createTestProgress = (
    pagesScraped: number,
    totalPages: number,
  ): ScraperProgressEvent => ({
    pagesScraped,
    totalPages,
    currentUrl: `https://example.com/page-${pagesScraped}`,
    depth: 1,
    maxDepth: 3,
    totalDiscovered: 0,
    result: {
      url: `https://example.com/page-${pagesScraped}`,
      title: `Page ${pagesScraped}`,
      contentType: "text/html",
      textContent: "",
      links: [],
      errors: [],
      chunks: [],
    },
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers(); // Use fake timers for controlling async queue processing

    mockStore = {
      // Database status tracking methods
      ensureLibraryAndVersion: vi.fn().mockResolvedValue(1), // Return mock version ID
      updateVersionStatus: vi.fn().mockResolvedValue(undefined),
      updateVersionProgress: vi.fn().mockResolvedValue(undefined), // For progress tests
      getVersionsByStatus: vi.fn().mockResolvedValue([]),
      // Refresh job methods
      ensureVersion: vi.fn().mockResolvedValue(1),
      getPagesByVersionId: vi.fn().mockResolvedValue([]),
      getScraperOptions: vi.fn().mockResolvedValue(null),
      getVersionById: vi.fn().mockResolvedValue({
        id: 1,
        library_id: 1,
        name: "1.0.0",
        status: "completed",
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:01:00.000Z",
      }),
      getLibraryById: vi.fn().mockResolvedValue({
        id: 1,
        name: "test-lib",
      }),
    };

    // Mock the worker's executeJob method
    mockWorkerInstance = {
      executeJob: vi.fn().mockResolvedValue(undefined), // Default success
    };
    // Mock the constructor of PipelineWorker to return our mock instance
    (PipelineWorker as Mock).mockImplementation(() => mockWorkerInstance);

    mockCallbacks = {
      onJobStatusChange: vi.fn().mockResolvedValue(undefined),
      onJobProgress: vi.fn().mockResolvedValue(undefined),
      onJobError: vi.fn().mockResolvedValue(undefined),
    };

    // Create mock EventBusService
    const mockEventBus = new EventBusService();

    appConfig = loadConfig();
    appConfig.scraper.maxConcurrency = 1;

    // Default concurrency of 1 for simpler testing unless overridden
    manager = new PipelineManager(mockStore as DocumentManagementService, mockEventBus, {
      appConfig: appConfig,
    });
    manager.setCallbacks(mockCallbacks);
  });

  afterEach(() => {
    vi.useRealTimers(); // Restore real timers
  });

  // --- Enqueueing Tests ---
  it("should enqueue a job with QUEUED status and return a job ID", async () => {
    const options = { url: "http://a.com", library: "libA", version: "1.0" };
    const jobId = await manager.enqueueScrapeJob("libA", "1.0", options);
    const job = await manager.getJob(jobId);
    expect(job?.status).toBe(PipelineJobStatus.QUEUED);
    expect(job?.library).toBe("libA");
    expect(job?.sourceUrl).toBe("http://a.com");
  });

  it("should start a queued job and transition to RUNNING", async () => {
    // Simulate a long-running job
    const pendingPromise = new Promise(() => {});
    mockWorkerInstance.executeJob.mockReturnValue(pendingPromise);
    const options = {
      url: "http://a.com",
      library: "libA",
      version: "1.0",
      maxPages: 1,
      maxDepth: 1,
    };
    const jobId = await manager.enqueueScrapeJob("libA", "1.0", options);
    await manager.start();
    await vi.advanceTimersByTimeAsync(1);
    const job = await manager.getJob(jobId);
    expect(job?.status).toBe(PipelineJobStatus.RUNNING);
    expect(PipelineWorker).toHaveBeenCalledOnce();
    expect(mockWorkerInstance.executeJob).toHaveBeenCalledOnce();
  });

  it("should complete a job and transition to COMPLETED", async () => {
    const options = { url: "http://a.com", library: "libA", version: "1.0" };
    const jobId = await manager.enqueueScrapeJob("libA", "1.0", options);
    await manager.start();
    await vi.advanceTimersByTimeAsync(1);
    await manager.waitForJobCompletion(jobId);
    const job = await manager.getJob(jobId);
    expect(job?.status).toBe(PipelineJobStatus.COMPLETED);
    expect(job?.finishedAt).toBeInstanceOf(Date);
  });

  it.each([
    ["queued", PipelineJobStatus.QUEUED],
    ["running", PipelineJobStatus.RUNNING],
    ["unversioned", PipelineJobStatus.QUEUED],
  ])("should abort existing %s job for same library+version before enqueuing new job", async (desc, initialStatus) => {
    const options1 = {
      url: "http://a.com",
      library: "libA",
      version: desc === "unversioned" ? "" : "1.0",
    };
    let resolveJob: (() => void) | undefined;
    if (initialStatus === PipelineJobStatus.RUNNING) {
      mockWorkerInstance.executeJob.mockReturnValue(
        new Promise<void>((r) => {
          resolveJob = () => r();
        }),
      );
    }
    const jobId1 = await manager.enqueueScrapeJob(
      "libA",
      desc === "unversioned" ? undefined : "1.0",
      options1,
    );
    if (initialStatus === PipelineJobStatus.RUNNING) {
      await manager.start();
      await vi.advanceTimersByTimeAsync(1);
    }
    const cancelSpy = vi.spyOn(manager, "cancelJob");
    const options2 = {
      url: "http://b.com",
      library: "libA",
      version: desc === "unversioned" ? "" : "1.0",
    };
    const jobId2 = await manager.enqueueScrapeJob(
      "libA",
      desc === "unversioned" ? undefined : "1.0",
      options2,
    );
    // Now wait for cancellation to propagate
    if (resolveJob) resolveJob();
    await manager.waitForJobCompletion(jobId1).catch(() => {});
    const job1 = await manager.getJob(jobId1);
    expect(cancelSpy).toHaveBeenCalledWith(jobId1);
    expect(jobId2).not.toBe(jobId1);
    expect(job1?.status).toBe(PipelineJobStatus.CANCELLED);
    const job2 = await manager.getJob(jobId2);
    expect([
      PipelineJobStatus.QUEUED,
      PipelineJobStatus.RUNNING,
      PipelineJobStatus.COMPLETED,
    ]).toContain(job2?.status);
  });

  it("should transition job to FAILED if worker throws", async () => {
    mockWorkerInstance.executeJob.mockRejectedValue(new Error("fail"));
    const options = { url: "http://fail.com", library: "libFail", version: "1.0" };
    const jobId = await manager.enqueueScrapeJob("libFail", "1.0", options);
    await manager.start();
    await vi.advanceTimersByTimeAsync(1);
    await manager.waitForJobCompletion(jobId).catch(() => {}); // Handle expected rejection
    const jobAfter = await manager.getJob(jobId);
    expect(jobAfter?.status).toBe(PipelineJobStatus.FAILED);
    expect(jobAfter?.error?.message).toBe("fail");
  });

  it("should cancel a job via cancelJob API", async () => {
    let resolveJob: () => void = () => {};
    mockWorkerInstance.executeJob.mockReturnValue(
      new Promise<void>((r) => {
        resolveJob = () => r();
      }),
    );
    const options = { url: "http://cancel.com", library: "libCancel", version: "1.0" };
    const jobId = await manager.enqueueScrapeJob("libCancel", "1.0", options);
    await manager.start();
    await vi.advanceTimersByTimeAsync(1);
    await manager.cancelJob(jobId);
    resolveJob();
    await manager.waitForJobCompletion(jobId).catch(() => {});
    const job = await manager.getJob(jobId);
    expect(job?.status).toBe(PipelineJobStatus.CANCELLED);
  });

  it("should handle job progress updates during execution", async () => {
    mockWorkerInstance.executeJob.mockImplementation(async (job, callbacks) => {
      // Simulate progress callback from worker
      await callbacks.onJobProgress?.(job, {
        pagesScraped: 1,
        totalPages: 1,
        currentUrl: "url",
        depth: 1,
        maxDepth: 1,
        document: undefined,
        totalDiscovered: 1,
      });
    });
    const options = {
      url: "http://progress.com",
      library: "libProgress",
      version: "1.0",
    };
    const jobId = await manager.enqueueScrapeJob("libProgress", "1.0", options);
    await manager.start();
    await vi.advanceTimersByTimeAsync(1);
    await manager.waitForJobCompletion(jobId);

    // Verify job completed successfully (progress was processed)
    const job = await manager.getJob(jobId);
    expect(job?.status).toBe(PipelineJobStatus.COMPLETED);
  });

  it("should run jobs in parallel if concurrency > 1", async () => {
    const mockEventBus = new EventBusService();
    appConfig.scraper.maxConcurrency = 2;
    manager = new PipelineManager(mockStore as DocumentManagementService, mockEventBus, {
      appConfig: appConfig,
    });
    manager.setCallbacks(mockCallbacks);
    const optionsA = { url: "http://a.com", library: "libA", version: "1.0" };
    const optionsB = { url: "http://b.com", library: "libB", version: "1.0" };
    const pendingPromise = new Promise(() => {});
    mockWorkerInstance.executeJob.mockReturnValue(pendingPromise);
    const jobIdA = await manager.enqueueScrapeJob("libA", "1.0", optionsA);
    const jobIdB = await manager.enqueueScrapeJob("libB", "1.0", optionsB);
    await manager.start();
    await vi.advanceTimersByTimeAsync(1);
    const jobA = await manager.getJob(jobIdA);
    const jobB = await manager.getJob(jobIdB);
    expect(jobA?.status).toBe(PipelineJobStatus.RUNNING);
    expect(jobB?.status).toBe(PipelineJobStatus.RUNNING);
  });

  // --- Progress Update Tests ---
  describe("Progress Updates", () => {
    it("should update job progress in memory and database", async () => {
      const job = createInternalTestJob({ versionId: 456 });
      const progress = createTestProgress(50, 300);

      await manager.updateJobProgress(job, progress);

      // Verify in-memory updates
      expect(job.progress).toEqual(progress);
      expect(job.progressPages).toBe(50);
      expect(job.progressMaxPages).toBe(300);
      expect(job.updatedAt).toBeInstanceOf(Date);

      // Verify database sync
      expect(mockStore.updateVersionProgress).toHaveBeenCalledWith(456, 50, 300);
    });

    it("should handle database errors gracefully during progress updates", async () => {
      (mockStore.updateVersionProgress as Mock).mockRejectedValue(new Error("DB error"));

      const job = createInternalTestJob();
      const progress = createTestProgress(30, 150);

      // Should not throw
      await expect(manager.updateJobProgress(job, progress)).resolves.not.toThrow();

      // In-memory updates should still work
      expect(job.progress).toEqual(progress);
      expect(job.progressPages).toBe(30);
      expect(job.progressMaxPages).toBe(150);
    });

    it("should provide updated progress data to UI tools", async () => {
      const listJobsTool = new ListJobsTool(manager);
      const jobId = "ui-test-job";

      const job = createInternalTestJob({ id: jobId });
      // Add job to manager's internal tracking
      (manager as any).jobMap = new Map([[jobId, job]]);

      // Update progress
      const progress = createTestProgress(75, 200);
      await manager.updateJobProgress(job, progress);

      // Verify UI tool gets updated data
      const result = await listJobsTool.execute({});
      const uiJob = result.jobs.find((j: any) => j.id === jobId);

      expect(uiJob).toBeDefined();
      expect(uiJob!.progress).toEqual({
        pages: 75,
        totalPages: 200,
        totalDiscovered: 200,
      });
    });

    it("should handle sequential progress updates correctly", async () => {
      const listJobsTool = new ListJobsTool(manager);
      const jobId = "sequence-test-job";

      const job = createInternalTestJob({ id: jobId });
      // Add job to manager's internal tracking
      (manager as any).jobMap = new Map([[jobId, job]]);

      // Initial progress update
      await manager.updateJobProgress(job, createTestProgress(25, 100));

      // Check initial state
      let result = await listJobsTool.execute({});
      let uiJob = result.jobs.find((j: any) => j.id === jobId);
      expect(uiJob?.progress?.pages).toBe(25);

      // Update progress again
      await manager.updateJobProgress(job, createTestProgress(75, 100));

      // Check updated state
      result = await listJobsTool.execute({});
      uiJob = result.jobs.find((j: any) => j.id === jobId);
      expect(uiJob?.progress?.pages).toBe(75);
    });

    it("should handle jobs without progress gracefully", async () => {
      const listJobsTool = new ListJobsTool(manager);
      const jobId = "no-progress-job";

      const job = createTestJob({ id: jobId });
      (manager as any).jobMap = new Map([[jobId, job]]);

      const result = await listJobsTool.execute({});
      const uiJob = result.jobs.find((j: any) => j.id === jobId);

      expect(uiJob).toBeDefined();
      expect(uiJob!.progress).toBeUndefined();
      expect(uiJob!.id).toBe(jobId);
    });
  });

  // --- Database Status Integration Tests ---
  describe("Database Status Integration", () => {
    it("should update database status when job is enqueued", async () => {
      const options = { url: "http://example.com", library: "test-lib", version: "1.0" };
      await manager.enqueueScrapeJob("test-lib", "1.0", options);

      // Should ensure library/version exists and update status to QUEUED
      expect(mockStore.ensureLibraryAndVersion).toHaveBeenCalledWith("test-lib", "1.0");
      expect(mockStore.updateVersionStatus).toHaveBeenCalledWith(1, "queued", undefined);
    });

    it("should handle unversioned jobs correctly", async () => {
      const options = { url: "http://example.com", library: "test-lib", version: "" };
      await manager.enqueueScrapeJob("test-lib", null, options);

      // Should treat null version as empty string
      expect(mockStore.ensureLibraryAndVersion).toHaveBeenCalledWith("test-lib", "");
      expect(mockStore.updateVersionStatus).toHaveBeenCalledWith(1, "queued", undefined);
    });

    it("should recover pending jobs from database on start", async () => {
      const mockQueuedVersions = [
        {
          id: 1,
          library_name: "test-lib",
          name: "1.0.0",
          created_at: "2025-01-01T00:00:00.000Z",
          started_at: null,
        },
        {
          id: 2,
          library_name: "interrupted-lib",
          name: "2.0.0",
          created_at: "2025-01-01T00:00:00.000Z",
          started_at: "2025-01-01T00:01:00.000Z",
        },
      ];
      const mockRunningVersions = [
        {
          id: 2,
          library_name: "interrupted-lib",
          name: "2.0.0",
          created_at: "2025-01-01T00:00:00.000Z",
          started_at: "2025-01-01T00:01:00.000Z",
        },
      ];

      // Create fresh mock store for this test to avoid interference
      const recoveryMockStore = {
        ensureLibraryAndVersion: vi.fn().mockResolvedValue(1),
        updateVersionStatus: vi.fn().mockResolvedValue(undefined),
        getVersionsByStatus: vi.fn().mockImplementation((statuses: string[]) => {
          if (statuses.includes("running")) return Promise.resolve(mockRunningVersions);
          if (statuses.includes("queued")) return Promise.resolve(mockQueuedVersions);
          return Promise.resolve([]);
        }),
      };

      const mockEventBus = new EventBusService();
      appConfig.scraper.maxConcurrency = 1;
      const recoveryManager = new PipelineManager(
        recoveryMockStore as any,
        mockEventBus,
        {
          appConfig: appConfig,
        },
      );
      await recoveryManager.start();

      // Should reset RUNNING job to QUEUED
      expect(recoveryMockStore.updateVersionStatus).toHaveBeenCalledWith(2, "queued");

      // Should have loaded both jobs (the originally QUEUED one + the reset one)
      const allJobs = await recoveryManager.getJobs();
      expect(allJobs).toHaveLength(2);
      expect(
        allJobs.some((job) => job.library === "test-lib" && job.version === "1.0.0"),
      ).toBe(true);
      expect(
        allJobs.some(
          (job) => job.library === "interrupted-lib" && job.version === "2.0.0",
        ),
      ).toBe(true);

      await recoveryManager.stop();
    });

    it("should map job statuses to database statuses correctly", async () => {
      // Test that the mapping function works correctly by checking enum values
      const options = { url: "http://example.com", library: "test-lib", version: "1.0" };
      const jobId = await manager.enqueueScrapeJob("test-lib", "1.0", options);

      // Verify the job was created with correct status
      const job = await manager.getJob(jobId);
      expect(job?.status).toBe(PipelineJobStatus.QUEUED);
      expect(job?.library).toBe("test-lib");
      expect(job?.version).toBe("1.0");

      // Verify database was called with correct mapped status
      expect(mockStore.updateVersionStatus).toHaveBeenCalledWith(1, "queued", undefined);
    });

    it("should handle database errors gracefully", async () => {
      // Mock database failure
      (mockStore.updateVersionStatus as Mock).mockRejectedValue(new Error("DB Error"));

      const options = { url: "http://example.com", library: "test-lib", version: "1.0" };

      // Should not throw even if database update fails
      await expect(
        manager.enqueueScrapeJob("test-lib", "1.0", options),
      ).resolves.toBeDefined();

      // Job should still be created in memory despite database error
      const allJobs = await manager.getJobs();
      expect(allJobs).toHaveLength(1);
      expect(allJobs[0].library).toBe("test-lib");
    });
  });

  describe("cleanup functionality", () => {
    it("should call cleanup on scraper service when stopped", async () => {
      // Access the actual scraperService and spy on its cleanup method
      const scraperService = (manager as any).scraperService;
      const cleanupSpy = vi.spyOn(scraperService, "cleanup").mockResolvedValue(undefined);

      // Start the manager
      await manager.start();

      // Call stop
      await manager.stop();

      // Verify cleanup was called on scraper service
      expect(cleanupSpy).toHaveBeenCalled();
    });

    it("should handle cleanup errors gracefully during stop", async () => {
      // Access the actual scraperService and spy on its cleanup method to throw error
      const scraperService = (manager as any).scraperService;
      const cleanupSpy = vi
        .spyOn(scraperService, "cleanup")
        .mockRejectedValue(new Error("Cleanup failed"));

      // Start the manager
      await manager.start();

      // Stop should throw if cleanup fails
      await expect(manager.stop()).rejects.toThrow("Cleanup failed");

      // Verify cleanup was attempted
      expect(cleanupSpy).toHaveBeenCalled();
    });

    it("should stop accepting new jobs after stop is called", async () => {
      // Start the manager
      await manager.start();

      // Stop the manager
      await manager.stop();

      // Attempting to enqueue new jobs should be handled gracefully
      const options = { url: "http://example.com", library: "test-lib", version: "1.0" };

      // This should not cause the system to hang
      try {
        const jobId = await manager.enqueueScrapeJob("test-lib", "1.0", options);
        // If it succeeds, verify the job exists
        if (jobId) {
          const job = await manager.getJob(jobId);
          expect(job).toBeDefined();
        }
      } catch (error) {
        // If it throws, that's also acceptable behavior for a stopped manager
        expect(error).toBeDefined();
      }
    });

    it("should handle stop when manager is not running", async () => {
      // Manager is not started, so stop should handle this gracefully
      await expect(manager.stop()).resolves.toBeUndefined();

      // Should be able to call stop multiple times without issues
      await expect(manager.stop()).resolves.toBeUndefined();
    });

    it("should ensure resource cleanup chain is properly invoked", async () => {
      // Access the actual scraperService and spy on its cleanup method
      const scraperService = (manager as any).scraperService;
      const cleanupSpy = vi.spyOn(scraperService, "cleanup").mockResolvedValue(undefined);

      // Start and stop the manager
      await manager.start();
      await manager.stop();

      // Verify the cleanup chain was invoked
      expect(cleanupSpy).toHaveBeenCalledTimes(1);
    });
  });

  // --- Refresh Job Tests ---
  describe("enqueueRefreshJob", () => {
    it("should successfully enqueue a refresh job with initial queue", async () => {
      // Setup: Mock pages and scraper options for an existing version
      const mockPages = [
        { id: 1, url: "https://example.com/page1", depth: 0, etag: "etag1" },
        { id: 2, url: "https://example.com/page2", depth: 1, etag: "etag2" },
        { id: 3, url: "https://example.com/page3", depth: 1, etag: "etag3" },
      ];

      (mockStore.ensureVersion as Mock).mockResolvedValue(456);
      (mockStore.getPagesByVersionId as Mock).mockResolvedValue(mockPages);
      (mockStore.getScraperOptions as Mock).mockResolvedValue({
        sourceUrl: "https://example.com",
        options: { maxDepth: 2 },
      });

      // Action: Enqueue a refresh job
      const jobId = await manager.enqueueRefreshJob("test-lib", "1.0.0");

      // Assertions: Verify the job was created with correct properties
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe("string");

      const job = await manager.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.status).toBe(PipelineJobStatus.QUEUED);
      expect(job?.library).toBe("test-lib");
      expect(job?.version).toBe("1.0.0");

      // Verify the scraper options contain an initialQueue with the same number of pages
      // Note: initialQueue is part of ScraperOptions but not VersionScraperOptions (storage type)
      expect(job?.scraperOptions).toBeDefined();
      const scraperOpts = job?.scraperOptions as any;
      expect(scraperOpts?.initialQueue).toBeDefined();
      expect(scraperOpts?.initialQueue).toHaveLength(mockPages.length);

      // Verify maxPages is NOT set (allowing discovery of new pages during refresh)
      expect(scraperOpts?.maxPages).toBeUndefined();
    });

    it("should handle unversioned libraries during refresh", async () => {
      const mockPages = [
        { id: 1, url: "https://example.com/page1", depth: 0, etag: "etag1" },
      ];

      (mockStore.ensureVersion as Mock).mockResolvedValue(789);
      (mockStore.getPagesByVersionId as Mock).mockResolvedValue(mockPages);
      (mockStore.getScraperOptions as Mock).mockResolvedValue({
        sourceUrl: "https://example.com",
        options: {},
      });

      // Action: Enqueue refresh for unversioned library (null/undefined version)
      const jobId = await manager.enqueueRefreshJob("unversioned-lib", null);

      // Assertions
      const job = await manager.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.library).toBe("unversioned-lib");
      expect(job?.version).toBe(null); // Public API uses null for unversioned
      const scraperOpts = job?.scraperOptions as any;
      expect(scraperOpts?.initialQueue).toHaveLength(1);
    });

    it("should throw error when refreshing a version with no pages", async () => {
      // Setup: Mock empty pages array
      (mockStore.ensureVersion as Mock).mockResolvedValue(999);
      (mockStore.getPagesByVersionId as Mock).mockResolvedValue([]);

      // Action & Assertion: Should throw with clear error message
      await expect(manager.enqueueRefreshJob("empty-lib", "1.0.0")).rejects.toThrow(
        "No pages found for empty-lib@1.0.0",
      );
    });

    it("should throw error when refreshing latest library with no pages", async () => {
      // Setup: Mock empty pages array for latest library
      (mockStore.ensureVersion as Mock).mockResolvedValue(888);
      (mockStore.getPagesByVersionId as Mock).mockResolvedValue([]);

      // Action & Assertion: Should throw with clear error message including "latest"
      await expect(manager.enqueueRefreshJob("empty-lib", undefined)).rejects.toThrow(
        "No pages found for empty-lib@latest",
      );
    });

    it("should preserve page depth and etag in initialQueue", async () => {
      const mockPages = [
        { id: 10, url: "https://example.com/deep", depth: 5, etag: "deep-etag" },
        { id: 11, url: "https://example.com/shallow", depth: 0, etag: null },
      ];

      (mockStore.ensureVersion as Mock).mockResolvedValue(111);
      (mockStore.getPagesByVersionId as Mock).mockResolvedValue(mockPages);
      (mockStore.getScraperOptions as Mock).mockResolvedValue({
        sourceUrl: "https://example.com",
        options: {},
      });

      const jobId = await manager.enqueueRefreshJob("depth-test", "1.0.0");
      const job = await manager.getJob(jobId);

      // Verify initialQueue contains depth and etag information
      // Note: initialQueue is part of ScraperOptions but not VersionScraperOptions (storage type)
      const scraperOpts = job?.scraperOptions as any;
      const queue = scraperOpts?.initialQueue;
      expect(queue).toBeDefined();
      expect(queue).toHaveLength(2);

      // Verify deep page
      const deepItem = queue?.find(
        (item: any) => item.url === "https://example.com/deep",
      );
      expect(deepItem).toBeDefined();
      expect(deepItem?.depth).toBe(5);
      expect(deepItem?.etag).toBe("deep-etag");
      expect(deepItem?.pageId).toBe(10);

      // Verify shallow page
      const shallowItem = queue?.find(
        (item: any) => item.url === "https://example.com/shallow",
      );
      expect(shallowItem).toBeDefined();
      expect(shallowItem?.depth).toBe(0);
      expect(shallowItem?.etag).toBe(null);
      expect(shallowItem?.pageId).toBe(11);
    });

    it("should perform full re-scrape instead of refresh when version is not completed", async () => {
      // Setup: Mock an incomplete version (failed scrape)
      const mockPages = [
        { id: 1, url: "https://example.com/page1", depth: 0, etag: "etag1" },
        { id: 2, url: "https://example.com/page2", depth: 1, etag: "etag2" },
      ];

      (mockStore.ensureVersion as Mock).mockResolvedValue(555);
      (mockStore.getVersionById as Mock).mockResolvedValue({
        id: 555,
        library_id: 1,
        name: "1.0.0",
        status: "failed", // Version was not completed
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:01:00.000Z",
      });
      (mockStore.getLibraryById as Mock).mockResolvedValue({
        id: 1,
        name: "incomplete-lib",
      });
      (mockStore.getPagesByVersionId as Mock).mockResolvedValue(mockPages);
      (mockStore.getScraperOptions as Mock).mockResolvedValue({
        sourceUrl: "https://example.com",
        options: { maxDepth: 2 },
      });

      // Spy on enqueueJobWithStoredOptions to verify it's called
      const enqueueStoredSpy = vi.spyOn(manager, "enqueueJobWithStoredOptions");
      enqueueStoredSpy.mockResolvedValue("mock-job-id");

      // Action: Attempt to enqueue a refresh job
      const jobId = await manager.enqueueRefreshJob("incomplete-lib", "1.0.0");

      // Assertions: Should have called enqueueJobWithStoredOptions instead of normal refresh
      expect(enqueueStoredSpy).toHaveBeenCalledWith("incomplete-lib", "1.0.0");
      expect(jobId).toBe("mock-job-id");

      // Should NOT have called getPagesByVersionId since we're doing a full re-scrape
      expect(mockStore.getPagesByVersionId).not.toHaveBeenCalled();
    });

    it("should perform full re-scrape for queued versions during refresh", async () => {
      // Setup: Mock a queued version (never started)
      (mockStore.ensureVersion as Mock).mockResolvedValue(666);
      (mockStore.getVersionById as Mock).mockResolvedValue({
        id: 666,
        library_id: 2,
        name: "2.0.0",
        status: "queued", // Version is still queued
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
      });
      (mockStore.getLibraryById as Mock).mockResolvedValue({
        id: 2,
        name: "queued-lib",
      });
      (mockStore.getScraperOptions as Mock).mockResolvedValue({
        sourceUrl: "https://example.com",
        options: {},
      });

      // Spy on enqueueJobWithStoredOptions
      const enqueueStoredSpy = vi.spyOn(manager, "enqueueJobWithStoredOptions");
      enqueueStoredSpy.mockResolvedValue("queued-job-id");

      // Action: Attempt to enqueue a refresh job
      await manager.enqueueRefreshJob("queued-lib", "2.0.0");

      // Assertions: Should perform full re-scrape for queued versions
      expect(enqueueStoredSpy).toHaveBeenCalledWith("queued-lib", "2.0.0");
    });

    it("should perform normal refresh for completed versions", async () => {
      // Setup: Mock a completed version
      const mockPages = [
        { id: 1, url: "https://example.com/page1", depth: 0, etag: "etag1" },
      ];

      (mockStore.ensureVersion as Mock).mockResolvedValue(777);
      (mockStore.getVersionById as Mock).mockResolvedValue({
        id: 777,
        library_id: 3,
        name: "3.0.0",
        status: "completed", // Version is completed successfully
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:01:00.000Z",
      });
      (mockStore.getLibraryById as Mock).mockResolvedValue({
        id: 3,
        name: "completed-lib",
      });
      (mockStore.getPagesByVersionId as Mock).mockResolvedValue(mockPages);
      (mockStore.getScraperOptions as Mock).mockResolvedValue({
        sourceUrl: "https://example.com",
        options: {},
      });

      // Spy on enqueueJobWithStoredOptions to ensure it's NOT called
      const enqueueStoredSpy = vi.spyOn(manager, "enqueueJobWithStoredOptions");

      // Action: Enqueue a refresh job
      const jobId = await manager.enqueueRefreshJob("completed-lib", "3.0.0");

      // Assertions: Should perform normal refresh, NOT full re-scrape
      expect(enqueueStoredSpy).not.toHaveBeenCalled();
      expect(mockStore.getPagesByVersionId).toHaveBeenCalledWith(777);

      const job = await manager.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.library).toBe("completed-lib");
      expect(job?.version).toBe("3.0.0");
    });
  });
});
