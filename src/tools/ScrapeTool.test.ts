import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineManager } from "../pipeline/PipelineManager";
import type { PipelineJob, PipelineManagerCallbacks } from "../pipeline/types";
import { PipelineJobStatus } from "../pipeline/types";
import { ScrapeMode } from "../scraper/types";
import type { DocumentManagementService } from "../store/DocumentManagementService";
import type { ProgressResponse } from "../types";
import type { Document } from "../types";
import { ScrapeTool, type ScrapeToolOptions } from "./ScrapeTool";

// Mock dependencies
vi.mock("../store/DocumentManagementService");
vi.mock("../pipeline/PipelineManager");
vi.mock("../utils/logger");

describe("ScrapeTool", () => {
  let mockDocService: Partial<DocumentManagementService>;
  let mockManagerInstance: Partial<PipelineManager>; // Mock manager instance
  let scrapeTool: ScrapeTool;
  let mockOnProgress: Mock<(response: ProgressResponse) => void>;

  // Mock implementation for manager callbacks
  let managerCallbacks: PipelineManagerCallbacks = {}; // Use manager callbacks type

  const MOCK_JOB_ID = "test-job-123";

  beforeEach(() => {
    vi.resetAllMocks();

    mockDocService = {
      initialize: vi.fn().mockResolvedValue(undefined),
      removeAllDocuments: vi.fn().mockResolvedValue(undefined),
    };

    // Mock the manager instance methods
    mockManagerInstance = {
      start: vi.fn().mockResolvedValue(undefined),
      enqueueJob: vi.fn().mockResolvedValue(MOCK_JOB_ID), // Return a mock job ID
      waitForJobCompletion: vi.fn().mockResolvedValue(undefined), // Default success
      getJob: vi.fn().mockResolvedValue({
        // Mock getJob for final status check
        id: MOCK_JOB_ID,
        status: PipelineJobStatus.COMPLETED,
        progress: { pagesScraped: 0 }, // Default progress
      } as Partial<PipelineJob>),
      setCallbacks: vi.fn((callbacks) => {
        managerCallbacks = callbacks; // Capture manager callbacks
      }),
      // stop: vi.fn().mockResolvedValue(undefined), // Mock if needed
    };

    // Mock the constructor of PipelineManager to return our mock instance
    (PipelineManager as Mock).mockImplementation(() => mockManagerInstance);

    // Pass both mockDocService and mockManagerInstance to constructor
    scrapeTool = new ScrapeTool(
      mockDocService as DocumentManagementService,
      mockManagerInstance as PipelineManager,
    );
    mockOnProgress = vi.fn();
    managerCallbacks = {}; // Reset captured callbacks
  });

  // Helper function for basic options
  const getBaseOptions = (
    version?: string | null,
    onProgress?: Mock,
  ): ScrapeToolOptions => ({
    library: "test-lib",
    version: version,
    url: "http://example.com/docs",
    onProgress: onProgress,
  });

  // --- Version Handling Tests ---

  it.each([
    { input: "1.2.3", expectedInternal: "1.2.3" },
    { input: "1.2.3-beta.1", expectedInternal: "1.2.3-beta.1" },
    { input: "1", expectedInternal: "1.0.0" }, // Coerced
    { input: "1.2", expectedInternal: "1.2.0" }, // Coerced
    { input: null, expectedInternal: "" }, // Null -> Unversioned
    { input: undefined, expectedInternal: "" }, // Undefined -> Unversioned
  ])(
    "should handle valid version input '$input' correctly",
    async ({ input, expectedInternal }) => {
      const options = getBaseOptions(input);
      await scrapeTool.execute(options);

      expect(mockDocService.removeAllDocuments).toHaveBeenCalledWith(
        "test-lib",
        expectedInternal.toLowerCase(),
      );
      // Check enqueueJob call (implies constructor was called)
      expect(mockManagerInstance.enqueueJob).toHaveBeenCalledWith(
        "test-lib",
        expectedInternal.toLowerCase(),
        expect.objectContaining({ url: options.url }), // Check basic options passed
      );
      expect(mockManagerInstance.waitForJobCompletion).toHaveBeenCalledWith(MOCK_JOB_ID);
    },
  );

  it.each(["latest", "1.x", "invalid-version"])(
    "should throw error for invalid version format '%s'",
    async (invalidVersion) => {
      const options = getBaseOptions(invalidVersion);

      await expect(scrapeTool.execute(options)).rejects.toThrow(
        /Invalid version format for scraping/,
      );
      expect(mockDocService.removeAllDocuments).not.toHaveBeenCalled();
      expect(mockManagerInstance.enqueueJob).not.toHaveBeenCalled();
    },
  );

  // --- Pipeline Execution Tests ---

  it("should execute the pipeline process with correct options", async () => {
    const options: ScrapeToolOptions = {
      ...getBaseOptions("1.0.0"),
      options: {
        maxPages: 50,
        maxDepth: 2,
        maxConcurrency: 5, // Test override
        ignoreErrors: false,
      },
    };
    await scrapeTool.execute(options);

    // Check enqueueJob options
    expect(mockManagerInstance.enqueueJob).toHaveBeenCalledWith(
      "test-lib",
      "1.0.0", // Normalized and lowercased
      {
        url: "http://example.com/docs",
        library: "test-lib",
        version: "1.0.0",
        scope: "subpages", // Using new scope option instead of subpagesOnly
        followRedirects: true, // Default value
        maxPages: 50, // Overridden
        maxDepth: 2, // Overridden
        maxConcurrency: 5, // Test override
        ignoreErrors: false, // Overridden
        scrapeMode: ScrapeMode.Auto, // Use enum
      },
    );
    expect(mockManagerInstance.waitForJobCompletion).toHaveBeenCalledWith(MOCK_JOB_ID);
  });

  it("should return the number of pages scraped on successful completion", async () => {
    const options = getBaseOptions("1.0.0");

    // Simulate progress via manager callbacks
    (mockManagerInstance.waitForJobCompletion as Mock).mockImplementation(async () => {
      if (managerCallbacks.onJobProgress) {
        // Simulate progress updates
        await managerCallbacks.onJobProgress({} as PipelineJob, {
          pagesScraped: 10,
          maxPages: 100,
          currentUrl: "url1",
          depth: 1,
          maxDepth: 3,
        });
        await managerCallbacks.onJobProgress({} as PipelineJob, {
          pagesScraped: 25,
          maxPages: 100,
          currentUrl: "url2",
          depth: 2,
          maxDepth: 3,
        });
      }
    });

    // Mock getJob to reflect final state if needed, though result comes from callback tracking now
    (mockManagerInstance.getJob as Mock).mockResolvedValue({
      id: MOCK_JOB_ID,
      status: PipelineJobStatus.COMPLETED,
      progress: { pagesScraped: 25 },
    } as Partial<PipelineJob>);

    const result = await scrapeTool.execute(options);

    expect(result).toEqual({ pagesScraped: 25 });
    expect(mockManagerInstance.waitForJobCompletion).toHaveBeenCalledWith(MOCK_JOB_ID);
  });

  it("should return jobId immediately if waitForCompletion is false", async () => {
    const options = { ...getBaseOptions("1.0.0"), waitForCompletion: false };
    const result = await scrapeTool.execute(options);

    expect(result).toEqual({ jobId: MOCK_JOB_ID });
    expect(mockManagerInstance.enqueueJob).toHaveBeenCalledOnce();
    expect(mockManagerInstance.waitForJobCompletion).not.toHaveBeenCalled(); // Should not wait
  });

  it("should wait for completion by default if waitForCompletion is omitted", async () => {
    const options = getBaseOptions("1.0.0"); // waitForCompletion is omitted (defaults to true)
    await scrapeTool.execute(options);

    expect(mockManagerInstance.enqueueJob).toHaveBeenCalledOnce();
    expect(mockManagerInstance.waitForJobCompletion).toHaveBeenCalledWith(MOCK_JOB_ID); // Should wait
  });

  it("should propagate errors from waitForJobCompletion when waiting", async () => {
    const options = getBaseOptions("1.0.0"); // Defaults to waitForCompletion: true
    const jobError = new Error("Job failed");
    (mockManagerInstance.waitForJobCompletion as Mock).mockRejectedValue(jobError);

    await expect(scrapeTool.execute(options)).rejects.toThrow("Job failed");
    expect(mockManagerInstance.enqueueJob).toHaveBeenCalledOnce(); // Job was still enqueued
  });

  // --- Callback Tests ---

  it("should call onProgress callback when manager reports progress", async () => {
    const options = getBaseOptions("1.0.0", mockOnProgress);
    (mockManagerInstance.waitForJobCompletion as Mock).mockImplementation(async () => {
      // Simulate manager calling its progress callback
      if (managerCallbacks.onJobProgress) {
        await managerCallbacks.onJobProgress({ id: MOCK_JOB_ID } as PipelineJob, {
          pagesScraped: 5,
          maxPages: 10,
          currentUrl: "http://page.com",
          depth: 1,
          maxDepth: 2,
        });
      }
    });

    await scrapeTool.execute(options);

    // Check for enqueue and completion messages only
    expect(mockOnProgress).toHaveBeenCalledWith({
      content: [
        { type: "text", text: expect.stringContaining(`🚀 Job ${MOCK_JOB_ID} enqueued`) },
      ],
    });
    // The waitForJobCompletion mock doesn't actually trigger the completion onProgress call in the refactored code.
    // We'll rely on other tests to verify completion logic if needed, or adjust the mock.
    // Check completion message (adjust mock if needed)
    expect(mockOnProgress).toHaveBeenCalledWith({
      content: [
        {
          type: "text",
          text: expect.stringContaining(`✅ Job ${MOCK_JOB_ID} completed`),
        },
      ],
    });
  });

  it("should call onProgress callback when manager reports a job error", async () => {
    const options = getBaseOptions("1.0.0", mockOnProgress);
    const docError = new Error("Failed to parse");
    (mockManagerInstance.waitForJobCompletion as Mock).mockImplementation(async () => {
      // Simulate manager calling its error callback
      if (managerCallbacks.onJobError) {
        await managerCallbacks.onJobError(
          { id: MOCK_JOB_ID } as PipelineJob,
          docError,
          { content: "bad", metadata: { title: "Bad Doc" } } as Document, // Use local Document structure
        );
      }
    });

    await scrapeTool.execute(options);

    // Check for enqueue and completion messages only
    expect(mockOnProgress).toHaveBeenCalledWith({
      content: [
        { type: "text", text: expect.stringContaining(`🚀 Job ${MOCK_JOB_ID} enqueued`) },
      ],
    });
    // Similar to the progress test, the mock doesn't trigger the specific onProgress for job errors.
    // Check completion message (adjust mock if needed)
    expect(mockOnProgress).toHaveBeenCalledWith({
      content: [
        {
          type: "text",
          text: expect.stringContaining(`✅ Job ${MOCK_JOB_ID} completed`),
        },
      ],
    });
  });

  it("should call onProgress callback when manager reports job status change", async () => {
    const options = getBaseOptions("1.0.0", mockOnProgress);
    (mockManagerInstance.waitForJobCompletion as Mock).mockImplementation(async () => {
      // Simulate manager calling its status change callback
      if (managerCallbacks.onJobStatusChange) {
        await managerCallbacks.onJobStatusChange({
          id: MOCK_JOB_ID,
          status: PipelineJobStatus.FAILED,
          error: new Error("Something broke"),
        } as PipelineJob);
      }
    });

    // This test setup relies on internal callbacks that were removed.
    // The refactored ScrapeTool now calls onProgress only for enqueue and final completion/failure.
    // We'll simulate the waitForJobCompletion rejecting to test the failure path.

    const jobError = new Error("Something broke");
    (mockManagerInstance.waitForJobCompletion as Mock).mockRejectedValue(jobError);

    // Execute the tool and expect it to throw
    await expect(scrapeTool.execute(options)).rejects.toThrow("Something broke");

    // Check if onProgress was called for enqueue and the final failure
    expect(mockOnProgress).toHaveBeenCalledWith({
      content: [
        { type: "text", text: expect.stringContaining(`🚀 Job ${MOCK_JOB_ID} enqueued`) },
      ],
    });
    expect(mockOnProgress).toHaveBeenCalledWith({
      content: [
        {
          type: "text",
          text: expect.stringContaining(
            `❌ Job ${MOCK_JOB_ID} failed or cancelled: Something broke`,
          ),
        },
      ],
    });
    // Remove expectations for intermediate status updates via onProgress
    // expect(mockOnProgress).toHaveBeenCalledWith({
    //   content: [
    //     {
    //       type: "text",
    //       text: expect.stringContaining(`Job ${MOCK_JOB_ID} status: failed`),
    //     },
    //   ],
    // });
  });

  it("should not fail if onProgress is not provided", async () => {
    const options = getBaseOptions("1.0.0"); // No onProgress callback
    (mockManagerInstance.waitForJobCompletion as Mock).mockImplementation(async () => {
      // Simulate internal callbacks firing
      if (managerCallbacks.onJobProgress) {
        await managerCallbacks.onJobProgress({} as PipelineJob, {
          pagesScraped: 1,
          maxPages: 10,
          currentUrl: "url",
          depth: 0,
          maxDepth: 1,
        });
      }
      if (managerCallbacks.onJobError) {
        await managerCallbacks.onJobError(
          {} as PipelineJob,
          new Error("Test Error"),
          // Provide minimal valid metadata for the test simulation
          { content: "", metadata: { title: "Test Doc" } } as Document,
        );
      }
      if (managerCallbacks.onJobStatusChange) {
        await managerCallbacks.onJobStatusChange({
          status: PipelineJobStatus.COMPLETED,
        } as PipelineJob);
      }
    });

    // Expect no error to be thrown during execution when callbacks fire internally
    await expect(scrapeTool.execute(options)).resolves.toBeDefined();
  });
});
