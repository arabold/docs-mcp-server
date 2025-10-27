import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { PipelineManager } from "../pipeline/PipelineManager";
import type { PipelineJob } from "../pipeline/types";
import { PipelineJobStatus } from "../pipeline/types";
import { ScrapeMode } from "../scraper/types";
import { ScrapeTool, type ScrapeToolOptions } from "./ScrapeTool";

// Mock dependencies
vi.mock("../pipeline/PipelineManager");
vi.mock("../utils/logger");

describe("ScrapeTool", () => {
  let mockManagerInstance: Partial<PipelineManager>; // Mock manager instance
  let scrapeTool: ScrapeTool;

  const MOCK_JOB_ID = "test-job-123";

  beforeEach(() => {
    vi.resetAllMocks();

    // Mock the manager instance methods
    mockManagerInstance = {
      start: vi.fn().mockResolvedValue(undefined),
      enqueueScrapeJob: vi.fn().mockResolvedValue(MOCK_JOB_ID), // Return a mock job ID
      waitForJobCompletion: vi.fn().mockResolvedValue(undefined), // Default success
      getJob: vi.fn().mockResolvedValue({
        // Mock getJob for final status check
        id: MOCK_JOB_ID,
        status: PipelineJobStatus.COMPLETED,
        progress: { pagesScraped: 0 }, // Default progress
      } as Partial<PipelineJob>),
      // setCallbacks mock removed
      // stop: vi.fn().mockResolvedValue(undefined), // Mock if needed
    };

    // Mock the constructor of PipelineManager to return our mock instance
    (PipelineManager as Mock).mockImplementation(() => mockManagerInstance);

    // Pass mockManagerInstance to constructor
    scrapeTool = new ScrapeTool(mockManagerInstance as PipelineManager);
    // mockOnProgress initialization removed
    // managerCallbacks reset removed
  });

  // Helper function for basic options
  const getBaseOptions = (version?: string | null): ScrapeToolOptions => ({
    library: "test-lib",
    version: version,
    url: "http://example.com/docs",
  });

  // --- Version Handling Tests ---

  it.each([
    { input: "1.2.3", expectedInternal: "1.2.3" },
    { input: "1.2.3-beta.1", expectedInternal: "1.2.3-beta.1" },
    { input: "1", expectedInternal: "1.0.0" }, // Coerced
    { input: "1.2", expectedInternal: "1.2.0" }, // Coerced
    { input: null, expectedInternal: null }, // Null -> Unversioned (normalize to null for pipeline)
    { input: undefined, expectedInternal: null }, // Undefined -> Unversioned (normalize to null for pipeline)
  ])(
    "should handle valid version input '$input' correctly",
    async ({ input, expectedInternal }) => {
      const options = getBaseOptions(input);
      await scrapeTool.execute(options);

      // Check enqueueScrapeJob call (implies constructor was called)
      const expectedVersionArg =
        typeof expectedInternal === "string"
          ? expectedInternal.toLowerCase()
          : expectedInternal; // null stays null

      expect(mockManagerInstance.enqueueScrapeJob).toHaveBeenCalledWith(
        "test-lib",
        expectedVersionArg,
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
      expect(mockManagerInstance.enqueueScrapeJob).not.toHaveBeenCalled();
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

    // Check enqueueScrapeJob options
    expect(mockManagerInstance.enqueueScrapeJob).toHaveBeenCalledWith(
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

    // Removed simulation of progress via manager callbacks as they are no longer used internally by ScrapeTool

    // Mock getJob to reflect final state
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
    expect(mockManagerInstance.enqueueScrapeJob).toHaveBeenCalledOnce();
    expect(mockManagerInstance.waitForJobCompletion).not.toHaveBeenCalled(); // Should not wait
  });

  it("should wait for completion by default if waitForCompletion is omitted", async () => {
    const options = getBaseOptions("1.0.0"); // waitForCompletion is omitted (defaults to true)
    await scrapeTool.execute(options);

    expect(mockManagerInstance.enqueueScrapeJob).toHaveBeenCalledOnce();
    expect(mockManagerInstance.waitForJobCompletion).toHaveBeenCalledWith(MOCK_JOB_ID); // Should wait
  });

  it("should propagate errors from waitForJobCompletion when waiting", async () => {
    const options = getBaseOptions("1.0.0"); // Defaults to waitForCompletion: true
    const jobError = new Error("Job failed");
    (mockManagerInstance.waitForJobCompletion as Mock).mockRejectedValue(jobError);

    await expect(scrapeTool.execute(options)).rejects.toThrow("Job failed");
    expect(mockManagerInstance.enqueueScrapeJob).toHaveBeenCalledOnce(); // Job was still enqueued
  });

  it("should pass custom headers to the pipeline manager", async () => {
    const options: ScrapeToolOptions = {
      ...getBaseOptions("2.0.0"),
      options: {
        headers: {
          Authorization: "Bearer test-token",
          "X-Custom-Header": "custom-value",
        },
      },
    };
    await scrapeTool.execute(options);
    expect(mockManagerInstance.enqueueScrapeJob).toHaveBeenCalledWith(
      "test-lib",
      "2.0.0",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer test-token",
          "X-Custom-Header": "custom-value",
        },
      }),
    );
  });
});
