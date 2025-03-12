import { DocumentProcessingPipeline } from "./DocumentProcessingPipeline";
import { ScraperRegistry, ScraperService } from "../scraper";
import { VectorStoreManager } from "../store";
import { logger } from "../utils/logger";
import type { ScrapingProgress, ScrapeOptions } from "../types";
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock implementations
const mockScrape = vi.fn();
const mockAddDocument = vi.fn();

// Create VectorStoreManager instance and extend with mocked methods
const vectorStoreManager = new VectorStoreManager();
const mockedManager = Object.assign(vectorStoreManager, {
  initialize: vi.fn(),
  exists: vi.fn(),
  addDocument: mockAddDocument,
  searchStore: vi.fn(),
});

vi.mock("../scraper", () => ({
  ScraperRegistry: vi.fn(() => ({})),
  ScraperService: vi.fn(() => ({
    scrape: mockScrape,
  })),
}));

vi.mock("../store");

vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("DocumentProcessingPipeline", () => {
  let pipeline: DocumentProcessingPipeline;

  const mockScrapeOptions: ScrapeOptions = {
    url: "https://example.com",
    library: "test-lib",
    version: "1.0.0",
    maxPages: 100,
    maxDepth: 3,
    subpagesOnly: true,
  };

  const mockProgress: ScrapingProgress = {
    currentUrl: "https://example.com/page",
    pagesScraped: 1,
    maxPages: 10,
    depth: 1,
    maxDepth: 3,
    document: {
      content: "Test content",
      metadata: {
        library: "test-lib",
        version: "1.0.0",
        title: "Test Doc",
        url: "https://example.com/page",
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedManager.initialize.mockResolvedValue(undefined);
    mockedManager.exists.mockResolvedValue(true);
    pipeline = new DocumentProcessingPipeline(
      vectorStoreManager,
      "test-lib",
      "1.0.0"
    );
  });

  it("should initialize with correct state", () => {
    expect(ScraperRegistry).toHaveBeenCalled();
    expect(ScraperService).toHaveBeenCalled();
  });

  it("should process documents successfully", async () => {
    mockScrape.mockImplementation((options, callback) => {
      callback(mockProgress);
      return Promise.resolve();
    });

    const onProgress = vi.fn();
    pipeline.setCallbacks({ onProgress });

    await pipeline.process(mockScrapeOptions);

    expect(mockScrape).toHaveBeenCalledWith(
      mockScrapeOptions,
      expect.any(Function)
    );
    expect(onProgress).toHaveBeenCalledWith(mockProgress);
    expect(mockAddDocument).toHaveBeenCalledWith(
      "test-lib",
      "1.0.0",
      expect.any(Object)
    );
    expect(logger.info).toHaveBeenCalledWith("✅ Pipeline processing complete");
  });

  it("should prevent concurrent processing", async () => {
    mockScrape.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    const firstProcess = pipeline.process(mockScrapeOptions);
    await expect(pipeline.process(mockScrapeOptions)).rejects.toThrow(
      "Pipeline is already processing"
    );
    await firstProcess;
  });

  it("should handle document processing errors", async () => {
    const mockError = new Error("Storage error");
    const progressWithDocument = { ...mockProgress };

    mockScrape.mockImplementation((_, callback) => {
      callback(progressWithDocument);
      return Promise.resolve();
    });

    mockAddDocument.mockRejectedValue(mockError);

    const onError = vi.fn();
    pipeline.setCallbacks({ onError });

    await pipeline.process(mockScrapeOptions);

    expect(onError).toHaveBeenCalledWith(
      mockError,
      progressWithDocument.document
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to process document Test Doc")
    );
  });

  it("should handle scraping errors", async () => {
    const mockError = new Error("Scraping failed");
    mockScrape.mockRejectedValue(mockError);

    await expect(pipeline.process(mockScrapeOptions)).rejects.toThrow(
      mockError
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Pipeline failed")
    );
  });

  it("should handle stop during processing", async () => {
    let progressCallback: ((progress: ScrapingProgress) => void) | undefined;

    mockScrape.mockImplementation((_, callback) => {
      progressCallback = callback;
      return new Promise((resolve) => setTimeout(resolve, 1000));
    });

    const processPromise = pipeline.process(mockScrapeOptions);
    await pipeline.stop();

    // Simulate progress after stop
    if (progressCallback) {
      progressCallback(mockProgress);
    }

    await processPromise;

    expect(mockAddDocument).not.toHaveBeenCalled();
  });

  it("should ignore stop when not processing", async () => {
    await pipeline.stop();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("should properly handle callbacks when not set", async () => {
    mockScrape.mockImplementation((_, callback) => {
      callback(mockProgress);
      return Promise.resolve();
    });

    await pipeline.process(mockScrapeOptions);

    // Should not throw errors when callbacks are not set
    expect(logger.info).toHaveBeenCalledWith("✅ Pipeline processing complete");
  });
});
