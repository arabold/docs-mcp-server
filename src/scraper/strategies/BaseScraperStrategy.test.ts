import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressCallback } from "../../types";
import { AppConfigSchema, DEFAULT_CONFIG, loadConfig } from "../../utils/config";
import { FetchStatus } from "../fetcher/types";
import {
  PageOutcome,
  type QueueItem,
  type ScraperOptions,
  type ScraperProgressEvent,
} from "../types";
import { BaseScraperStrategy } from "./BaseScraperStrategy";

// Mock logger

// Mock implementation for testing abstract class
class TestScraperStrategy extends BaseScraperStrategy {
  canHandle(): boolean {
    return true;
  }
  processItem = vi.fn();

  // Expose the visited set for testing
  getVisitedUrls(): Set<string> {
    return this.visited;
  }
}

function createTestConfig(overrides?: { abortOnFailureRate?: number }) {
  return AppConfigSchema.parse({
    ...DEFAULT_CONFIG,
    scraper: {
      ...DEFAULT_CONFIG.scraper,
      ...(overrides?.abortOnFailureRate !== undefined
        ? { abortOnFailureRate: overrides.abortOnFailureRate }
        : {}),
    },
  });
}

describe("BaseScraperStrategy", () => {
  let strategy: TestScraperStrategy;

  beforeEach(() => {
    strategy = new TestScraperStrategy(loadConfig());
    strategy.processItem.mockClear();
  });

  it("should process items and call progressCallback", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 1,
      maxDepth: 1,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    strategy.processItem.mockResolvedValue({
      content: {
        textContent: "test",
        metadata: {},
        links: [],
        errors: [],
        chunks: [],
      },
      links: [],
      status: FetchStatus.SUCCESS,
    });

    await strategy.scrape(options, progressCallback);

    expect(strategy.processItem).toHaveBeenCalledTimes(1);
    expect(progressCallback).toHaveBeenCalledWith({
      pagesScraped: 1,
      totalPages: 1,
      totalDiscovered: 1,
      pagesIndexed: 1,
      currentUrl: "https://example.com/",
      depth: 0,
      maxDepth: 1,
      outcome: PageOutcome.Stored,
      pageId: undefined,
      result: {
        url: "https://example.com/",
        title: "",
        sourceContentType: "",
        contentType: "",
        textContent: "test",
        etag: null,
        lastModified: null,
        links: [],
        errors: [],
        chunks: [],
      },
    } satisfies ScraperProgressEvent);
  });

  it("should respect maxPages", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 2,
      maxDepth: 1,
    };

    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    strategy.processItem.mockResolvedValue({
      content: {
        textContent: "test",
        metadata: {},
        links: [],
        errors: [],
        chunks: [],
      },
      links: ["https://example.com/page2", "https://example.com/page3"],
      status: FetchStatus.SUCCESS,
    });

    await strategy.scrape(options, progressCallback);
    expect(strategy.processItem).toHaveBeenCalledTimes(2);
  });

  it("should always throw errors at depth 0 even when ignoreErrors is true", async () => {
    // Root URL errors should never be ignored - the job is invalid if the starting point fails
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 1,
      maxDepth: 1,
      ignoreErrors: true, // Even with this set to true...
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    const error = new Error("Root URL failed");

    strategy.processItem.mockRejectedValue(error);

    // ...errors at depth 0 should still throw
    await expect(strategy.scrape(options, progressCallback)).rejects.toThrowError(
      "Root URL failed",
    );
    expect(strategy.processItem).toHaveBeenCalledTimes(1);
  });

  it("should throw when the root page returns NOT_FOUND during a normal scrape", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 1,
      maxDepth: 1,
      ignoreErrors: true,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    strategy.processItem.mockResolvedValue({
      url: options.url,
      links: [],
      status: FetchStatus.NOT_FOUND,
    });

    await expect(strategy.scrape(options, progressCallback)).rejects.toThrow(
      "Root page not found",
    );
  });

  it("should not abort via the failure-rate threshold when many llms.txt seeds fail", async () => {
    // A dead llms.txt index must not fail the scrape by the back door: past the
    // 10-attempt minimum sample, counting seeds as failures would trip
    // abortOnFailureRate even though these 404s are deliberately non-fatal.
    const seedCount = 20;
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: seedCount + 1,
      maxDepth: 1,
      ignoreErrors: true,
      initialQueue: [
        { url: "https://example.com/", depth: 0 },
        ...Array.from({ length: seedCount }, (_, i) => ({
          url: `https://example.com/dead-${i}`,
          depth: 0,
          fromLlmsTxt: true,
        })),
      ],
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    strategy.processItem.mockImplementation(async (item) => {
      if (item.url === "https://example.com/") {
        return {
          url: item.url,
          links: [],
          status: FetchStatus.SUCCESS,
          content: {
            textContent: "Root content",
            chunks: [{ content: "Root content" }],
          },
        };
      }
      return { url: item.url, links: [], status: FetchStatus.NOT_FOUND };
    });

    await expect(strategy.scrape(options, progressCallback)).resolves.not.toThrow();
  });

  it("should not throw Root page not found when a fromLlmsTxt item returns NOT_FOUND", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 2,
      maxDepth: 1,
      ignoreErrors: true,
      initialQueue: [
        {
          url: "https://example.com/broken-doc",
          depth: 0,
          fromLlmsTxt: true,
        },
        {
          url: "https://example.com/valid-doc",
          depth: 0,
          fromLlmsTxt: true,
        },
      ],
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    strategy.processItem.mockImplementation(async (item) => {
      if (item.url === "https://example.com/broken-doc") {
        return {
          url: item.url,
          links: [],
          status: FetchStatus.NOT_FOUND,
        };
      }
      return {
        url: item.url,
        links: [],
        status: FetchStatus.SUCCESS,
        content: {
          textContent: "Valid document content",
          chunks: [{ content: "Valid document content" }],
        },
      };
    });

    await expect(strategy.scrape(options, progressCallback)).resolves.not.toThrow();
    expect(progressCallback).toHaveBeenCalled();
  });

  it("should not abort the scrape when only an llms.txt-seeded url returns NOT_FOUND", async () => {
    // The real requested root succeeds and seeds a depth-0 llms.txt URL that
    // 404s. A dead llms.txt entry must not abort a scrape whose actual root
    // resolved fine.
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 5,
      maxDepth: 1,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    strategy.processItem
      .mockResolvedValueOnce({
        content: {
          textContent: "root content",
          metadata: {},
          links: [],
          errors: [],
          chunks: [],
        },
        links: [],
        status: FetchStatus.SUCCESS,
        queueItems: [
          { url: "https://example.com/llms-seed", depth: 0, fromLlmsTxt: true },
        ],
      })
      .mockResolvedValueOnce({
        url: "https://example.com/llms-seed",
        links: [],
        status: FetchStatus.NOT_FOUND,
      });

    await expect(strategy.scrape(options, progressCallback)).resolves.not.toThrow();
    expect(strategy.processItem).toHaveBeenCalledTimes(2);
  });

  it("should treat a tracked root page returning NOT_FOUND during refresh as a deletion", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 2,
      maxDepth: 1,
      initialQueue: [
        {
          url: "https://example.com/",
          depth: 0,
          pageId: 123,
        },
      ],
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    strategy.processItem.mockResolvedValue({
      url: options.url,
      links: [],
      status: FetchStatus.NOT_FOUND,
    });

    await expect(strategy.scrape(options, progressCallback)).resolves.toBeUndefined();
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        currentUrl: "https://example.com/",
        deleted: true,
        pageId: 123,
        result: null,
      }),
    );
  });

  it("should not mark non-refresh child NOT_FOUND pages as deleted", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 2,
      maxDepth: 1,
      ignoreErrors: true,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    strategy.processItem
      .mockResolvedValueOnce({
        url: options.url,
        links: ["https://example.com/missing"],
        status: FetchStatus.SUCCESS,
        content: {
          title: "Root",
          textContent: "Root content",
          links: [],
          errors: [],
          chunks: [],
        },
      })
      .mockResolvedValueOnce({
        url: "https://example.com/missing",
        links: [],
        status: FetchStatus.NOT_FOUND,
      });

    await expect(strategy.scrape(options, progressCallback)).resolves.toBeUndefined();

    const deletedCalls = progressCallback.mock.calls.filter((call) => call[0].deleted);
    expect(deletedCalls).toHaveLength(0);
  });

  it("should ignore errors at depth > 0 when ignoreErrors is true", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 10,
      maxDepth: 2,
      ignoreErrors: true,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    const error = new Error("Child page error");

    // First call (depth 0) succeeds and returns a link
    // Second call (depth 1) fails
    strategy.processItem
      .mockResolvedValueOnce({
        url: "https://example.com/",
        links: ["https://example.com/page1"],
        status: FetchStatus.SUCCESS,
        content: {
          title: "Test",
          textContent: "Test content",
          links: [],
          errors: [],
          chunks: [],
        },
      })
      .mockRejectedValueOnce(error);

    // Should complete without throwing because error is at depth > 0
    await strategy.scrape(options, progressCallback);

    expect(strategy.processItem).toHaveBeenCalledTimes(2);
  });

  it("should abort when child-page failure rate exceeds the threshold after minimum sample", async () => {
    const config = createTestConfig({ abortOnFailureRate: 0.5 });
    strategy = new TestScraperStrategy(config);
    strategy.processItem.mockClear();

    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 20,
      maxDepth: 2,
      ignoreErrors: true,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      if (item.depth === 0) {
        return {
          url: item.url,
          links: Array.from(
            { length: 10 },
            (_, index) => `https://example.com/page-${index + 1}`,
          ),
          status: FetchStatus.SUCCESS,
          content: {
            title: "Root",
            textContent: "Root content",
            links: [],
            errors: [],
            chunks: [],
          },
        };
      }

      const pageNumber = Number.parseInt(item.url.split("page-")[1] ?? "0", 10);
      if (pageNumber <= 6) {
        throw new Error(`Child page ${pageNumber} failed`);
      }

      return {
        url: item.url,
        links: [],
        status: FetchStatus.SUCCESS,
        content: {
          title: `Page ${pageNumber}`,
          textContent: `Content ${pageNumber}`,
          links: [],
          errors: [],
          chunks: [],
        },
      };
    });

    await expect(strategy.scrape(options, progressCallback)).rejects.toThrow(
      /Scrape aborted after \d+\/\d+ child pages failed/,
    );
  });

  it("should continue when child-page failure rate stays at the threshold", async () => {
    const config = createTestConfig({ abortOnFailureRate: 0.5 });
    strategy = new TestScraperStrategy(config);
    strategy.processItem.mockClear();

    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 20,
      maxDepth: 2,
      ignoreErrors: true,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      if (item.depth === 0) {
        return {
          url: item.url,
          links: Array.from(
            { length: 10 },
            (_, index) => `https://example.com/page-${index + 1}`,
          ),
          status: FetchStatus.SUCCESS,
          content: {
            title: "Root",
            textContent: "Root content",
            links: [],
            errors: [],
            chunks: [],
          },
        };
      }

      const pageNumber = Number.parseInt(item.url.split("page-")[1] ?? "0", 10);
      if (pageNumber <= 5) {
        throw new Error(`Child page ${pageNumber} failed`);
      }

      return {
        url: item.url,
        links: [],
        status: FetchStatus.SUCCESS,
        content: {
          title: `Page ${pageNumber}`,
          textContent: `Content ${pageNumber}`,
          links: [],
          errors: [],
          chunks: [],
        },
      };
    });

    await expect(strategy.scrape(options, progressCallback)).resolves.toBeUndefined();
    expect(strategy.processItem).toHaveBeenCalledTimes(11);
  });

  it("should not count refresh deletions toward the child-page failure threshold", async () => {
    const config = createTestConfig({ abortOnFailureRate: 0 });
    strategy = new TestScraperStrategy(config);
    strategy.processItem.mockClear();

    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 20,
      maxDepth: 1,
      ignoreErrors: true,
      initialQueue: Array.from({ length: 10 }, (_, index) => ({
        url: `https://example.com/deleted-${index + 1}`,
        depth: 1,
        pageId: index + 1,
      })),
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      if (item.depth === 0) {
        return {
          url: item.url,
          links: [],
          status: FetchStatus.SUCCESS,
          content: {
            title: "Root",
            textContent: "Root content",
            links: [],
            errors: [],
            chunks: [],
          },
        };
      }

      return {
        url: item.url,
        links: [],
        status: FetchStatus.NOT_FOUND,
      };
    });

    await expect(strategy.scrape(options, progressCallback)).resolves.toBeUndefined();
    expect(progressCallback).toHaveBeenCalledTimes(11);
  });

  it("should throw errors when ignoreErrors is false", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 1,
      maxDepth: 1,
      ignoreErrors: false,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    const error = new Error("Test error");

    strategy.processItem.mockRejectedValue(error);

    // Use resolves.toThrowError to check if the promise rejects with the expected error
    await expect(strategy.scrape(options, progressCallback)).rejects.toThrowError(
      "Test error",
    );
    expect(strategy.processItem).toHaveBeenCalledTimes(1);
    expect(progressCallback).not.toHaveBeenCalled();
  });

  it("should count non-refresh child NOT_FOUND as a terminal failure but continue crawling", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 3,
      maxDepth: 1,
      ignoreErrors: false,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    strategy.processItem
      .mockResolvedValueOnce({
        url: options.url,
        links: ["https://example.com/missing", "https://example.com/valid"],
        status: FetchStatus.SUCCESS,
        content: {
          title: "Root",
          textContent: "Root content",
          links: [],
          errors: [],
          chunks: [],
        },
      })
      .mockResolvedValueOnce({
        url: "https://example.com/missing",
        links: [],
        status: FetchStatus.NOT_FOUND,
      })
      .mockResolvedValueOnce({
        url: "https://example.com/valid",
        links: [],
        status: FetchStatus.SUCCESS,
        content: {
          title: "Valid",
          textContent: "Valid content",
          links: [],
          errors: [],
          chunks: [],
        },
      });

    // Scrape should complete without throwing — the 404 is counted as a failure
    // for the rate-based threshold, but does not abort the crawl on its own.
    await expect(strategy.scrape(options, progressCallback)).resolves.not.toThrow();

    // Every dequeued item reports an outcome, so the 404 appears too — as Absent,
    // carrying no content.
    const calls = progressCallback.mock.calls.map((c) => c[0]);
    const stored = calls.filter((c) => c.outcome === PageOutcome.Stored);
    expect(stored.map((c) => c.currentUrl)).toEqual([
      "https://example.com/",
      "https://example.com/valid",
    ]);
    expect(
      calls.find((c) => c.currentUrl === "https://example.com/missing"),
    ).toMatchObject({ outcome: PageOutcome.Absent, result: null });
  });

  it("should deduplicate URLs and avoid processing the same URL twice", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 5,
      maxDepth: 2,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    // Return the same URLs multiple times to simulate duplicate links
    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      if (item.url === "https://example.com/") {
        return {
          content: {
            textContent: "main page",
            metadata: {},
            links: [],
            errors: [],
            chunks: [],
          },
          links: [
            "https://example.com/page1",
            "https://example.com/page1", // Duplicate
            "https://example.com/page2",
            "https://example.com/page2/", // Duplicate with trailing slash
          ],
          status: FetchStatus.SUCCESS,
        };
      }
      return {
        content: {
          textContent: "sub page",
          metadata: {},
          links: [],
          errors: [],
          chunks: [],
        },
        links: [],
        status: FetchStatus.SUCCESS,
      };
    });

    await strategy.scrape(options, progressCallback);

    // The initial URL (example.com) plus two unique sub-pages should be processed
    expect(strategy.processItem).toHaveBeenCalledTimes(3);

    // Check that duplicate URLs were properly normalized and not visited twice
    const visitedUrls = Array.from(strategy.getVisitedUrls());
    expect(visitedUrls).toContain("https://example.com/");
    expect(visitedUrls).toContain("https://example.com/page1");
    expect(visitedUrls).toContain("https://example.com/page2");
    expect(visitedUrls.length).toBe(3); // No duplicates in the visited set

    // Verify progress callback was called for each unique page
    expect(progressCallback).toHaveBeenCalledTimes(3);
  });

  it("should handle URL normalization for deduplication", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 10,
      maxDepth: 2,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    // First page returns variations of the same URL
    let firstPageCalled = false;
    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      if (item.url === "https://example.com/") {
        firstPageCalled = true;
        return {
          content: {
            textContent: "main page",
            metadata: {},
            links: [],
            errors: [],
            chunks: [],
          },
          links: [
            "https://example.com/path/",
            "https://example.com/path", // Without trailing slash
            "https://example.com/path?q=1",
            "https://example.com/path?q=1#anchor", // With anchor
            "https://example.com/path", // Different case
          ],
          status: FetchStatus.SUCCESS,
        };
      }
      return {
        content: {
          textContent: "sub page",
          metadata: {},
          links: [],
          errors: [],
          chunks: [],
        },
        links: [],
        status: FetchStatus.SUCCESS,
      };
    });

    await strategy.scrape(options, progressCallback);

    // We should see the root page + unique normalized URLs (likely 3 unique URLs after normalization)
    expect(firstPageCalled).toBe(true);

    // Check the specific URLs that were processed via the mock calls
    const processedUrls = strategy.processItem.mock.calls.map((call) => call[0].url);

    // Expect the root URL was processed
    expect(processedUrls.includes("https://example.com/")).toBe(true);

    // Expect we have 3 unique normalized URLs including the root URL
    expect(strategy.processItem).toHaveBeenCalledTimes(3);
    expect(progressCallback).toHaveBeenCalledTimes(3);
  });

  it("should keep distinct hash routes separate when preserveHashes is enabled", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 10,
      maxDepth: 1,
      preserveHashes: true,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      if (item.url === "https://example.com/") {
        return {
          content: {
            textContent: "main page",
            metadata: {},
            links: [],
            errors: [],
            chunks: [],
          },
          links: [
            "https://example.com/#/guide",
            "https://example.com/#/api",
            "https://example.com/#/guide",
          ],
          status: FetchStatus.SUCCESS,
        };
      }

      return {
        content: {
          textContent: item.url,
          metadata: {},
          links: [],
          errors: [],
          chunks: [],
        },
        links: [],
        status: FetchStatus.SUCCESS,
      };
    });

    await strategy.scrape(options, progressCallback);

    expect(strategy.processItem).toHaveBeenCalledTimes(3);
    const visitedUrls = Array.from(strategy.getVisitedUrls());
    expect(visitedUrls).toContain("https://example.com/");
    expect(visitedUrls).toContain("https://example.com/#/guide");
    expect(visitedUrls).toContain("https://example.com/#/api");
  });

  it("should process page via shortest path (breadth-first search)", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 99,
      maxDepth: 3,
      maxConcurrency: 3,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    // Simulate the link structure and timing
    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      // Simulate a tree structure: https://example.com/ (d=0)
      // A (d=1) -> B (d=2) -> C (d=3) -> X (d=4)
      //                    -> E (d=3) -> X (d=4)
      // B (d=1) -> C (d=2) -> X (d=3)
      // D (d=1) -> E (d=2) -> X (d=3)
      const url = item.url;
      let links: string[] = [];
      if (url === "https://example.com/") {
        links = [
          "https://example.com/A",
          "https://example.com/B",
          "https://example.com/D",
        ];
      } else if (url === "https://example.com/A") {
        links = ["https://example.com/B"];
      } else if (url === "https://example.com/B") {
        links = ["https://example.com/C", "https://example.com/E"];
      } else if (url === "https://example.com/C") {
        links = ["https://example.com/X"];
      } else if (url === "https://example.com/D") {
        await new Promise((resolve) => setTimeout(resolve, 50));
        links = ["https://example.com/E"];
      } else if (url === "https://example.com/E") {
        await new Promise((resolve) => setTimeout(resolve, 50));
        links = ["https://example.com/X"];
      }
      // X has no links
      return {
        content: {
          textContent: `Content for ${url}`,
          metadata: {},
          links: [],
          errors: [],
          chunks: [],
        },
        links,
        status: FetchStatus.SUCCESS,
      };
    });

    await strategy.scrape(options, progressCallback);

    // Verify which URLs were actually processed and their order
    const processedCalls = strategy.processItem.mock.calls.map((call) => call[0]);
    const processedUrls = processedCalls.map((item) => item.url);

    // Assert the exact order for breadth-first search
    expect(processedUrls).toEqual([
      "https://example.com/",
      "https://example.com/A",
      "https://example.com/B",
      "https://example.com/D",
      "https://example.com/C",
      "https://example.com/E",
      "https://example.com/X",
    ]);

    // Verify X was processed exactly once and at the correct depth (3)
    const xCalls = processedCalls.filter((item) => item.url === "https://example.com/X");
    expect(xCalls.length).toBe(1);
    expect(xCalls[0].depth).toBe(3);

    // Total calls: /, A, B, C, D, E, X = 7
    expect(strategy.processItem).toHaveBeenCalledTimes(7);
  });

  describe("URL filtering with includePatterns and excludePatterns", () => {
    beforeEach(() => {
      strategy = new TestScraperStrategy(loadConfig());
      strategy.processItem.mockClear();
    });

    it("should only process URLs matching includePatterns (glob)", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/docs/start",
        library: "test",
        version: "1.0.0",
        maxPages: 5,
        maxDepth: 1,
        scope: "hostname",
        includePatterns: ["docs/*"],
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      strategy.processItem.mockImplementation(async (item: QueueItem) => {
        if (item.url === "https://example.com/docs/start") {
          return {
            content: {
              textContent: "main",
              metadata: {},
              links: [],
              errors: [],
              chunks: [],
            },
            links: [
              "https://example.com/docs/intro",
              "https://example.com/docs/other",
              "https://example.com/api/should-not-include",
            ],
            status: FetchStatus.SUCCESS,
          };
        }
        return {
          content: {
            textContent: "sub",
            metadata: {},
            links: [],
            errors: [],
            chunks: [],
          },
          links: [],
          status: FetchStatus.SUCCESS,
        };
      });
      await strategy.scrape(options, progressCallback);
      const processedUrls = strategy.processItem.mock.calls.map((call) => call[0].url);
      expect(processedUrls).toContain("https://example.com/docs/start");
      expect(processedUrls).toContain("https://example.com/docs/intro");
      expect(processedUrls).toContain("https://example.com/docs/other");
      expect(processedUrls).not.toContain("https://example.com/api/should-not-include");
    });

    it("should only process URLs matching includePatterns (regex)", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/docs/start",
        library: "test",
        version: "1.0.0",
        maxPages: 5,
        maxDepth: 1,
        scope: "hostname",
        includePatterns: ["/docs\\/intro.*/"],
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      strategy.processItem.mockImplementation(async (item: QueueItem) => {
        if (item.url === "https://example.com/docs/start") {
          return {
            content: {
              textContent: "main",
              metadata: {},
              links: [],
              errors: [],
              chunks: [],
            },
            links: [
              "https://example.com/docs/intro",
              "https://example.com/docs/intro2",
              "https://example.com/docs/other",
            ],
            status: FetchStatus.SUCCESS,
          };
        }
        return {
          content: {
            textContent: "sub",
            metadata: {},
            links: [],
            errors: [],
            chunks: [],
          },
          links: [],
          status: FetchStatus.SUCCESS,
        };
      });
      await strategy.scrape(options, progressCallback);
      const processedUrls = strategy.processItem.mock.calls.map((call) => call[0].url);
      expect(processedUrls).toContain("https://example.com/docs/intro");
      expect(processedUrls).toContain("https://example.com/docs/intro2");
      expect(processedUrls).not.toContain("https://example.com/docs/other");
    });

    it("should exclude URLs matching excludePatterns (glob)", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/docs/start",
        library: "test",
        version: "1.0.0",
        maxPages: 5,
        maxDepth: 1,
        scope: "hostname",
        excludePatterns: ["docs/private/*"],
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      strategy.processItem.mockImplementation(async (item: QueueItem) => {
        if (item.url === "https://example.com/docs/start") {
          return {
            content: {
              textContent: "main",
              metadata: {},
              links: [],
              errors: [],
              chunks: [],
            },
            links: [
              "https://example.com/docs/intro",
              "https://example.com/docs/private/secret",
              "https://example.com/docs/other",
            ],
            status: FetchStatus.SUCCESS,
          };
        }
        return {
          content: {
            textContent: "sub",
            metadata: {},
            links: [],
            errors: [],
            chunks: [],
          },
          links: [],
          status: FetchStatus.SUCCESS,
        };
      });
      await strategy.scrape(options, progressCallback);
      const processedUrls = strategy.processItem.mock.calls.map((call) => call[0].url);
      expect(processedUrls).toContain("https://example.com/docs/intro");
      expect(processedUrls).toContain("https://example.com/docs/other");
      expect(processedUrls).not.toContain("https://example.com/docs/private/secret");
    });

    it("should exclude URLs matching excludePatterns (regex)", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/docs/start",
        library: "test",
        version: "1.0.0",
        maxPages: 5,
        maxDepth: 1,
        scope: "hostname",
        excludePatterns: ["/private/"],
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      strategy.processItem.mockImplementation(async (item: QueueItem) => {
        if (item.url === "https://example.com/docs/start") {
          return {
            content: {
              textContent: "main",
              metadata: {},
              links: [],
              errors: [],
              chunks: [],
            },
            links: [
              "https://example.com/docs/intro",
              "https://example.com/docs/private/secret",
              "https://example.com/docs/other",
            ],
            status: FetchStatus.SUCCESS,
          };
        }
        return {
          content: {
            textContent: "sub",
            metadata: {},
            links: [],
            errors: [],
            chunks: [],
          },
          links: [],
          status: FetchStatus.SUCCESS,
        };
      });
      await strategy.scrape(options, progressCallback);
      const processedUrls = strategy.processItem.mock.calls.map((call) => call[0].url);
      expect(processedUrls).toContain("https://example.com/docs/intro");
      expect(processedUrls).toContain("https://example.com/docs/other");
      expect(processedUrls).not.toContain("https://example.com/docs/private/secret");
    });

    it("should apply excludePatterns precedence over includePatterns", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/docs/start",
        library: "test",
        version: "1.0.0",
        maxPages: 5,
        maxDepth: 1,
        scope: "hostname",
        includePatterns: ["docs/*"],
        excludePatterns: ["docs/private/*"],
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      strategy.processItem.mockImplementation(async (item: QueueItem) => {
        if (item.url === "https://example.com/docs/start") {
          return {
            content: {
              textContent: "main",
              metadata: {},
              links: [],
              errors: [],
              chunks: [],
            },
            links: [
              "https://example.com/docs/intro",
              "https://example.com/docs/private/secret",
              "https://example.com/docs/other",
            ],
            status: FetchStatus.SUCCESS,
          };
        }
        return {
          content: {
            textContent: "sub",
            metadata: {},
            links: [],
            errors: [],
            chunks: [],
          },
          links: [],
          status: FetchStatus.SUCCESS,
        };
      });
      await strategy.scrape(options, progressCallback);
      const processedUrls = strategy.processItem.mock.calls.map((call) => call[0].url);
      expect(processedUrls).toContain("https://example.com/docs/intro");
      expect(processedUrls).toContain("https://example.com/docs/other");
      expect(processedUrls).not.toContain("https://example.com/docs/private/secret");
    });
  });

  describe("Refresh mode with initialQueue", () => {
    beforeEach(() => {
      strategy = new TestScraperStrategy(loadConfig());
      strategy.processItem.mockClear();
    });

    it("should prioritize initialQueue items before discovering new links", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/",
        library: "test",
        version: "1.0.0",
        maxPages: 10,
        maxDepth: 2,
        initialQueue: [
          {
            url: "https://example.com/existing-page1",
            depth: 1,
            pageId: 101,
            etag: "etag1",
          },
          {
            url: "https://example.com/existing-page2",
            depth: 1,
            pageId: 102,
            etag: "etag2",
          },
        ],
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      strategy.processItem.mockImplementation(async (item: QueueItem) => {
        if (item.url === "https://example.com/") {
          return {
            content: {
              textContent: "root",
              metadata: {},
              links: [],
              errors: [],
              chunks: [],
            },
            links: ["https://example.com/new-page"],
            status: FetchStatus.SUCCESS,
          };
        }
        return {
          content: {
            textContent: "page content",
            metadata: {},
            links: [],
            errors: [],
            chunks: [],
          },
          links: [],
          status: FetchStatus.SUCCESS,
        };
      });

      await strategy.scrape(options, progressCallback);

      // Verify initialQueue items are processed before discovered links
      const processedUrls = strategy.processItem.mock.calls.map((call) => call[0].url);
      const rootIndex = processedUrls.indexOf("https://example.com/");
      const existing1Index = processedUrls.indexOf("https://example.com/existing-page1");
      const existing2Index = processedUrls.indexOf("https://example.com/existing-page2");
      const newPageIndex = processedUrls.indexOf("https://example.com/new-page");

      // Root URL should be processed first (it's added before initialQueue items)
      expect(rootIndex).toBe(0);

      // InitialQueue items should be processed before newly discovered links
      expect(existing1Index).toBeLessThan(newPageIndex);
      expect(existing2Index).toBeLessThan(newPageIndex);
    });

    it("should preserve pageId from initialQueue items", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/",
        library: "test",
        version: "1.0.0",
        maxPages: 10,
        maxDepth: 2,
        initialQueue: [
          {
            url: "https://example.com/page1",
            depth: 1,
            pageId: 123,
            etag: "etag1",
          },
        ],
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      strategy.processItem.mockResolvedValue({
        content: {
          textContent: "test",
          metadata: {},
          links: [],
          errors: [],
          chunks: [],
        },
        links: [],
        status: FetchStatus.SUCCESS,
      });

      await strategy.scrape(options, progressCallback);

      // Verify pageId flows through to processItem call
      const page1Call = strategy.processItem.mock.calls.find(
        (call) => call[0].url === "https://example.com/page1",
      );
      expect(page1Call).toBeDefined();
      expect(page1Call![0].pageId).toBe(123);
    });

    it("should preserve etag from initialQueue items", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/",
        library: "test",
        version: "1.0.0",
        maxPages: 10,
        maxDepth: 2,
        initialQueue: [
          {
            url: "https://example.com/page1",
            depth: 1,
            pageId: 123,
            etag: '"test-etag-123"',
          },
        ],
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      strategy.processItem.mockResolvedValue({
        content: {
          textContent: "test",
          metadata: {},
          links: [],
          errors: [],
          chunks: [],
        },
        links: [],
        status: FetchStatus.SUCCESS,
      });

      await strategy.scrape(options, progressCallback);

      // Verify etag flows through to processItem call
      const page1Call = strategy.processItem.mock.calls.find(
        (call) => call[0].url === "https://example.com/page1",
      );
      expect(page1Call).toBeDefined();
      expect(page1Call![0].etag).toBe('"test-etag-123"');
    });

    it("should not duplicate root URL if already in initialQueue", async () => {
      const rootUrl = "https://example.com/";
      const options: ScraperOptions = {
        url: rootUrl,
        library: "test",
        version: "1.0.0",
        maxPages: 10,
        maxDepth: 2,
        initialQueue: [
          {
            url: rootUrl,
            depth: 0,
            pageId: 100,
            etag: '"root-etag"',
          },
          {
            url: "https://example.com/page1",
            depth: 1,
            pageId: 101,
            etag: '"page1-etag"',
          },
        ],
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      strategy.processItem.mockResolvedValue({
        content: {
          textContent: "test",
          metadata: {},
          links: [],
          errors: [],
          chunks: [],
        },
        links: [],
        status: FetchStatus.SUCCESS,
      });

      await strategy.scrape(options, progressCallback);

      // Count how many times root URL was processed
      const rootCalls = strategy.processItem.mock.calls.filter(
        (call) => call[0].url === rootUrl,
      );
      expect(rootCalls).toHaveLength(1);

      // Verify it used the pageId and etag from initialQueue
      expect(rootCalls[0][0].pageId).toBe(100);
      expect(rootCalls[0][0].etag).toBe('"root-etag"');
    });
  });

  describe("Page counting with different fetch statuses", () => {
    beforeEach(() => {
      strategy = new TestScraperStrategy(loadConfig());
      strategy.processItem.mockClear();
    });

    it("should count pages that return 200 OK", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/",
        library: "test",
        version: "1.0.0",
        maxPages: 3,
        maxDepth: 1,
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      strategy.processItem.mockResolvedValue({
        content: {
          textContent: "test",
          metadata: {},
          links: [],
          errors: [],
          chunks: [],
        },
        links: ["https://example.com/page1", "https://example.com/page2"],
        status: FetchStatus.SUCCESS,
      });

      await strategy.scrape(options, progressCallback);

      // Verify all 3 pages were counted (root + 2 links)
      expect(progressCallback).toHaveBeenCalledTimes(3);
      const lastCall = progressCallback.mock.calls[2][0];
      expect(lastCall.pagesScraped).toBe(3);
    });

    it("should count pages that return 304 Not Modified", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/",
        library: "test",
        version: "1.0.0",
        maxPages: 3,
        maxDepth: 1,
        initialQueue: [
          { url: "https://example.com/page1", depth: 1, pageId: 101, etag: "etag1" },
        ],
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      strategy.processItem.mockImplementation(async (item: QueueItem) => {
        if (item.url === "https://example.com/") {
          return {
            content: {
              textContent: "root",
              metadata: {},
              links: [],
              errors: [],
              chunks: [],
            },
            links: ["https://example.com/page1"],
            status: FetchStatus.SUCCESS,
          };
        }
        // page1 returns 304
        return {
          content: null,
          links: [],
          status: FetchStatus.NOT_MODIFIED,
          etag: "etag1",
        };
      });

      await strategy.scrape(options, progressCallback);

      // Verify both pages were counted (root=200, page1=304)
      expect(progressCallback).toHaveBeenCalledTimes(2);
      const lastCall = progressCallback.mock.calls[1][0];
      expect(lastCall.pagesScraped).toBe(2);
    });

    it("should count pages that return 404 Not Found", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/",
        library: "test",
        version: "1.0.0",
        maxPages: 3,
        maxDepth: 1,
        initialQueue: [
          {
            url: "https://example.com/deleted-page",
            depth: 1,
            pageId: 101,
            etag: "etag1",
          },
        ],
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      strategy.processItem.mockImplementation(async (item: QueueItem) => {
        if (item.url === "https://example.com/") {
          return {
            content: {
              textContent: "root",
              metadata: {},
              links: [],
              errors: [],
              chunks: [],
            },
            links: [],
            status: FetchStatus.SUCCESS,
          };
        }
        // deleted-page returns 404
        return {
          content: null,
          links: [],
          status: FetchStatus.NOT_FOUND,
        };
      });

      await strategy.scrape(options, progressCallback);

      // Verify both pages were counted (root=200, deleted-page=404)
      expect(progressCallback).toHaveBeenCalledTimes(2);
      const lastCall = progressCallback.mock.calls[1][0];
      expect(lastCall.pagesScraped).toBe(2);
    });
  });

  describe("Progress callbacks with different statuses", () => {
    beforeEach(() => {
      strategy = new TestScraperStrategy(loadConfig());
      strategy.processItem.mockClear();
    });

    it("should call progressCallback with result=null for 304 responses", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/",
        library: "test",
        version: "1.0.0",
        maxPages: 2,
        maxDepth: 1,
        initialQueue: [
          { url: "https://example.com/page1", depth: 1, pageId: 101, etag: "etag1" },
        ],
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      strategy.processItem.mockImplementation(async (item: QueueItem) => {
        if (item.url === "https://example.com/") {
          return {
            content: {
              textContent: "root",
              metadata: {},
              links: [],
              errors: [],
              chunks: [],
            },
            links: [],
            status: FetchStatus.SUCCESS,
          };
        }
        // page1 returns 304
        return {
          content: null,
          links: [],
          status: FetchStatus.NOT_MODIFIED,
          etag: "etag1",
        };
      });

      await strategy.scrape(options, progressCallback);

      // Find the 304 response progress call
      const progress304 = progressCallback.mock.calls.find(
        (call) => call[0].currentUrl === "https://example.com/page1",
      );
      expect(progress304).toBeDefined();
      expect(progress304![0].result).toBeNull();
    });

    it("should call progressCallback with deleted=true for 404 responses", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/",
        library: "test",
        version: "1.0.0",
        maxPages: 2,
        maxDepth: 1,
        initialQueue: [
          { url: "https://example.com/deleted", depth: 1, pageId: 101, etag: "etag1" },
        ],
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      strategy.processItem.mockImplementation(async (item: QueueItem) => {
        if (item.url === "https://example.com/") {
          return {
            content: {
              textContent: "root",
              metadata: {},
              links: [],
              errors: [],
              chunks: [],
            },
            links: [],
            status: FetchStatus.SUCCESS,
          };
        }
        // deleted page returns 404
        return {
          content: null,
          links: [],
          status: FetchStatus.NOT_FOUND,
        };
      });

      await strategy.scrape(options, progressCallback);

      // Find the 404 response progress call
      const progress404 = progressCallback.mock.calls.find(
        (call) => call[0].currentUrl === "https://example.com/deleted",
      );
      expect(progress404).toBeDefined();
      expect(progress404![0].deleted).toBe(true);
      expect(progress404![0].result).toBeNull();
    });

    it("should include pageId in progress for refresh operations", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/",
        library: "test",
        version: "1.0.0",
        maxPages: 3,
        maxDepth: 1,
        initialQueue: [
          { url: "https://example.com/page1", depth: 1, pageId: 101, etag: "etag1" },
          { url: "https://example.com/page2", depth: 1, pageId: 102, etag: "etag2" },
        ],
      };
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      strategy.processItem.mockResolvedValue({
        content: {
          textContent: "test",
          metadata: {},
          links: [],
          errors: [],
          chunks: [],
        },
        links: [],
        status: FetchStatus.SUCCESS,
      });

      await strategy.scrape(options, progressCallback);

      // Verify pageId flows through to progress events for initialQueue items
      const page1Progress = progressCallback.mock.calls.find(
        (call) => call[0].currentUrl === "https://example.com/page1",
      );
      const page2Progress = progressCallback.mock.calls.find(
        (call) => call[0].currentUrl === "https://example.com/page2",
      );

      expect(page1Progress).toBeDefined();
      expect(page1Progress![0].pageId).toBe(101);

      expect(page2Progress).toBeDefined();
      expect(page2Progress![0].pageId).toBe(102);
    });
  });
});

describe("BaseScraperStrategy skipped (unprocessable) items", () => {
  const baseOptions = (): ScraperOptions => ({
    url: "https://example.com",
    library: "test",
    version: "1.0",
    maxPages: 2000,
    maxDepth: 2,
    ignoreErrors: true,
  });

  it("does not count skips toward the child-page failure rate", async () => {
    // 900 skips against 100 successes. If skips counted as failures the observed
    // rate would be 0.9 and the crawl would abort at the 0.5 threshold.
    const strategy = new TestScraperStrategy(
      createTestConfig({ abortOnFailureRate: 0.5 }),
    );
    const links = Array.from({ length: 1000 }, (_, i) => `https://example.com/p${i}`);

    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      if (item.depth === 0) {
        return { url: item.url, links, status: FetchStatus.SUCCESS };
      }
      const index = Number(item.url.split("/p")[1]);
      if (index < 900) {
        return { url: item.url, links: [], status: FetchStatus.SKIPPED };
      }
      return {
        url: item.url,
        links: [],
        status: FetchStatus.SUCCESS,
        content: { textContent: "ok", chunks: [], links: [], errors: [] },
      };
    });

    await expect(
      strategy.scrape(baseOptions(), vi.fn<ProgressCallback<ScraperProgressEvent>>()),
    ).resolves.toBeUndefined();
  });

  it("still aborts when genuine failures exceed the threshold alongside skips", async () => {
    const strategy = new TestScraperStrategy(
      createTestConfig({ abortOnFailureRate: 0.5 }),
    );
    const links = Array.from({ length: 40 }, (_, i) => `https://example.com/p${i}`);

    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      if (item.depth === 0) {
        return { url: item.url, links, status: FetchStatus.SUCCESS };
      }
      const index = Number(item.url.split("/p")[1]);
      if (index < 20) {
        return { url: item.url, links: [], status: FetchStatus.SKIPPED };
      }
      throw new Error("boom");
    });

    await expect(
      strategy.scrape(baseOptions(), vi.fn<ProgressCallback<ScraperProgressEvent>>()),
    ).rejects.toThrow(/Scrape aborted/);
  });

  it("produces no content and no progress result for a skipped child", async () => {
    const strategy = new TestScraperStrategy(loadConfig());
    strategy.processItem.mockImplementation(async (item: QueueItem) =>
      item.depth === 0
        ? {
            url: item.url,
            links: ["https://example.com/asset"],
            status: FetchStatus.SUCCESS,
            content: { textContent: "root", chunks: [], links: [], errors: [] },
          }
        : { url: item.url, links: [], status: FetchStatus.SKIPPED },
    );
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    await strategy.scrape(baseOptions(), progressCallback);

    const events = progressCallback.mock.calls.map((c) => c[0]);
    expect(events.filter((e) => e.result).length).toBe(1);
    expect(
      events.find((e) => e.currentUrl === "https://example.com/asset"),
    ).toMatchObject({ outcome: PageOutcome.Skipped, result: null });
  });

  it("does not fail the job when an llms.txt seed is unprocessable", async () => {
    // llms.txt seeds are queued at depth 0 but are one of several discovery
    // seeds, so one unreadable entry must not abort the whole scrape.
    const strategy = new TestScraperStrategy(loadConfig());
    strategy.processItem.mockImplementation(async (item: QueueItem) =>
      item.fromLlmsTxt
        ? { url: item.url, links: [], status: FetchStatus.SKIPPED }
        : {
            url: item.url,
            links: [],
            status: FetchStatus.SUCCESS,
            content: { textContent: "root", chunks: [], links: [], errors: [] },
            queueItems: [
              { url: "https://example.com/seed", depth: 0, fromLlmsTxt: true },
            ],
          },
    );

    await expect(
      strategy.scrape(baseOptions(), vi.fn<ProgressCallback<ScraperProgressEvent>>()),
    ).resolves.toBeUndefined();
  });

  it("does not fail a refresh when a stored depth-0 page becomes unprocessable", async () => {
    const strategy = new TestScraperStrategy(loadConfig());
    strategy.processItem.mockResolvedValue({
      url: "https://example.com",
      links: [],
      status: FetchStatus.SKIPPED,
    });

    await expect(
      strategy.scrape(
        {
          ...baseOptions(),
          initialQueue: [{ url: "https://example.com", depth: 0, pageId: 42 }],
          isRefresh: true,
        },
        vi.fn<ProgressCallback<ScraperProgressEvent>>(),
      ),
    ).resolves.toBeUndefined();
  });

  it("fails the job when the start URL itself is unprocessable", async () => {
    const strategy = new TestScraperStrategy(loadConfig());
    strategy.processItem.mockResolvedValue({
      url: "https://example.com",
      links: [],
      status: FetchStatus.SKIPPED,
    });

    await expect(
      strategy.scrape(baseOptions(), vi.fn<ProgressCallback<ScraperProgressEvent>>()),
    ).rejects.toThrow(/Cannot process content type/);
  });
});

describe("BaseScraperStrategy progress counter semantics", () => {
  // The original defect was a relationship between two counters, not a wrong
  // value in either, so every assertion here checks all four together.
  const opts = (o: Partial<ScraperOptions> = {}): ScraperOptions => ({
    url: "https://example.com",
    library: "test",
    version: "1.0",
    maxPages: 1000,
    maxDepth: 3,
    ignoreErrors: true,
    ...o,
  });

  const page = (url: string, links: string[] = []) => ({
    url,
    links,
    status: FetchStatus.SUCCESS,
    content: { textContent: "content", chunks: [], links: [], errors: [] },
  });

  const lastEvent = (cb: { mock: { calls: [ScraperProgressEvent][] } }) =>
    cb.mock.calls.at(-1)?.[0];

  it("reaches its denominator when the queue drains", async () => {
    const strategy = new TestScraperStrategy(loadConfig());
    strategy.processItem.mockImplementation(async (item: QueueItem) =>
      item.depth === 0
        ? page(item.url, ["https://example.com/a", "https://example.com/b"])
        : page(item.url),
    );
    const cb = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    await strategy.scrape(opts(), cb);

    expect(lastEvent(cb)).toMatchObject({
      pagesScraped: 3,
      totalPages: 3,
      totalDiscovered: 3,
      pagesIndexed: 3,
    });
  });

  it("counts a URL discovered from two pages exactly once", async () => {
    const strategy = new TestScraperStrategy(loadConfig());
    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      if (item.depth === 0)
        return page(item.url, ["https://example.com/a", "https://example.com/b"]);
      // Both children link the same third page.
      if (item.url.endsWith("/a") || item.url.endsWith("/b"))
        return page(item.url, ["https://example.com/shared"]);
      return page(item.url);
    });
    const cb = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    await strategy.scrape(opts(), cb);

    expect(lastEvent(cb)).toMatchObject({
      pagesScraped: 4,
      totalPages: 4,
      totalDiscovered: 4,
      pagesIndexed: 4,
    });
  });

  it("excludes over-depth links from the denominator", async () => {
    // The original inflation: links beyond maxDepth were counted at enqueue and
    // then discarded at dequeue, so the denominator could never be reached.
    const strategy = new TestScraperStrategy(loadConfig());
    strategy.processItem.mockImplementation(async (item: QueueItem) =>
      page(item.url, [`${item.url}/deeper`]),
    );
    const cb = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    await strategy.scrape(opts({ maxDepth: 2 }), cb);

    // Root plus two levels; the depth-3 link is never queued.
    expect(lastEvent(cb)).toMatchObject({
      pagesScraped: 3,
      totalPages: 3,
      totalDiscovered: 3,
      pagesIndexed: 3,
    });
  });

  it("queues nothing beyond the root at maxDepth 0", async () => {
    const strategy = new TestScraperStrategy(loadConfig());
    strategy.processItem.mockImplementation(async (item: QueueItem) =>
      page(item.url, ["https://example.com/a", "https://example.com/b"]),
    );
    const cb = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    await strategy.scrape(opts({ maxDepth: 0 }), cb);

    expect(lastEvent(cb)).toMatchObject({
      pagesScraped: 1,
      totalPages: 1,
      totalDiscovered: 1,
      pagesIndexed: 1,
    });
  });

  it("delivers maxPages indexed pages even when items produce nothing", async () => {
    // maxPages is a request for pages, not a budget for attempts: asking for 5
    // should yield 5, and the denominator stretches to keep the fraction whole.
    const strategy = new TestScraperStrategy(loadConfig());
    const links = Array.from({ length: 40 }, (_, i) => `https://example.com/p${i}`);
    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      if (item.depth === 0) return page(item.url, links);
      const index = Number(item.url.split("/p")[1]);
      // Every other child yields nothing.
      return index % 2 === 0
        ? { url: item.url, links: [], status: FetchStatus.SKIPPED }
        : page(item.url);
    });
    const cb = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    await strategy.scrape(opts({ maxPages: 5, maxConcurrency: 1 }), cb);

    const final = lastEvent(cb);
    expect(final?.pagesIndexed).toBe(5);
    expect(final?.pagesScraped).toBeGreaterThan(5);
    expect(final?.pagesScraped).toBe(final?.totalPages);
    expect(final?.totalDiscovered).toBeGreaterThan(final?.totalPages ?? 0);
  });

  it("clamps an initial queue larger than maxPages", async () => {
    // Previously both counters were initialised to queue.length with no clamp,
    // so a large refresh reported e.g. 1000/1500 forever.
    const strategy = new TestScraperStrategy(loadConfig());
    strategy.processItem.mockImplementation(async (item: QueueItem) => page(item.url));
    const initialQueue = Array.from({ length: 30 }, (_, i) => ({
      url: `https://example.com/stored${i}`,
      depth: 0,
      pageId: i + 1,
    }));
    const cb = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    await strategy.scrape(opts({ maxPages: 10, initialQueue, isRefresh: true }), cb);

    const final = lastEvent(cb);
    expect(final?.pagesIndexed).toBe(10);
    expect(final?.pagesScraped).toBe(10);
    expect(final?.totalPages).toBe(10);
  });

  it("advances only the processed count for each non-content outcome", async () => {
    const strategy = new TestScraperStrategy(loadConfig());
    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      if (item.depth === 0)
        return page(item.url, [
          "https://example.com/unchanged",
          "https://example.com/gone",
          "https://example.com/asset",
        ]);
      if (item.url.endsWith("/unchanged"))
        return { url: item.url, links: [], status: FetchStatus.NOT_MODIFIED };
      if (item.url.endsWith("/gone"))
        return { url: item.url, links: [], status: FetchStatus.NOT_FOUND };
      return { url: item.url, links: [], status: FetchStatus.SKIPPED };
    });
    const cb = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    await strategy.scrape(opts(), cb);

    const outcomes = cb.mock.calls.map(([e]) => e.outcome).sort();
    expect(outcomes).toEqual(
      [
        PageOutcome.Absent,
        PageOutcome.Skipped,
        PageOutcome.Stored,
        PageOutcome.Unchanged,
      ].sort(),
    );
    expect(lastEvent(cb)).toMatchObject({
      pagesScraped: 4,
      totalPages: 4,
      pagesIndexed: 1,
    });
  });

  it("does not adjust the counters when a crawl is cancelled", async () => {
    const strategy = new TestScraperStrategy(loadConfig());
    const controller = new AbortController();
    let children = 0;
    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      if (item.depth === 0)
        return page(
          item.url,
          Array.from({ length: 10 }, (_, i) => `https://example.com/p${i}`),
        );
      // Let one child report first: the root's own event fires before its links
      // have been counted, so it legitimately reads 1/1.
      children += 1;
      if (children > 1) controller.abort();
      return page(item.url);
    });
    const cb = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    await expect(
      strategy.scrape(opts({ maxConcurrency: 1 }), cb, controller.signal),
    ).rejects.toThrow();

    const final = lastEvent(cb);
    expect(final?.pagesScraped).toBeLessThan(final?.totalPages ?? 0);
  });
});

describe("BaseScraperStrategy empty-page reporting", () => {
  const opts = (): ScraperOptions => ({
    url: "https://example.com/page",
    library: "test",
    version: "1.0",
    maxPages: 10,
    maxDepth: 0,
  });

  it("carries the validators for a clean empty result", async () => {
    const strategy = new TestScraperStrategy(loadConfig());
    strategy.processItem.mockResolvedValue({
      url: "https://example.com/page",
      title: "Empty",
      sourceContentType: "text/html",
      contentType: "text/markdown",
      etag: '"v2"',
      lastModified: "2026-01-01T00:00:00.000Z",
      links: [],
      pipelineFailed: false,
      status: FetchStatus.SUCCESS,
    });
    const cb = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    await strategy.scrape(opts(), cb);

    expect(cb.mock.calls.at(-1)?.[0]).toMatchObject({
      outcome: PageOutcome.Empty,
      pagesIndexed: 0,
      emptyPage: {
        etag: '"v2"',
        lastModified: "2026-01-01T00:00:00.000Z",
        pipelineFailed: false,
      },
    });
  });

  it("withholds the validators when the pipeline failed", async () => {
    // Storing the etag against a failure we do not understand would make every
    // later refresh answer 304 and never retry, turning a transient extraction
    // fault into permanent data loss.
    const strategy = new TestScraperStrategy(loadConfig());
    strategy.processItem.mockResolvedValue({
      url: "https://example.com/page",
      sourceContentType: "text/html",
      contentType: "text/html",
      etag: '"v2"',
      lastModified: "2026-01-01T00:00:00.000Z",
      links: [],
      pipelineFailed: true,
      status: FetchStatus.SUCCESS,
    });
    const cb = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    await strategy.scrape(opts(), cb);

    expect(cb.mock.calls.at(-1)?.[0]?.emptyPage).toMatchObject({
      etag: null,
      lastModified: null,
      pipelineFailed: true,
    });
  });

  it("does not record a container as an empty page", async () => {
    // A directory listing yields links and no content. It is processed, but it
    // is not a page and must not be written to the index.
    const strategy = new TestScraperStrategy(loadConfig());
    strategy.processItem.mockResolvedValue({
      url: "file:///docs",
      links: [],
      isContainer: true,
      status: FetchStatus.SUCCESS,
    });
    const cb = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    await strategy.scrape(opts(), cb);

    const event = cb.mock.calls.at(-1)?.[0];
    expect(event?.outcome).toBe(PageOutcome.Empty);
    expect(event?.emptyPage).toBeUndefined();
  });
});
