import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressCallback } from "../../types";
import { FetchStatus } from "../fetcher/types";
import type { QueueItem, ScraperOptions, ScraperProgressEvent } from "../types";
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

describe("BaseScraperStrategy", () => {
  let strategy: TestScraperStrategy;

  beforeEach(() => {
    strategy = new TestScraperStrategy();
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
      currentUrl: "https://example.com/",
      depth: 0,
      maxDepth: 1,
      pageId: undefined,
      result: {
        url: "https://example.com/",
        title: "",
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

  it("should ignore errors when ignoreErrors is true", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 1,
      maxDepth: 1,
      ignoreErrors: true,
    };
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    const error = new Error("Test error");

    strategy.processItem.mockRejectedValue(error);

    await strategy.scrape(options, progressCallback);

    expect(strategy.processItem).toHaveBeenCalledTimes(1);
    expect(progressCallback).not.toHaveBeenCalled();
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
      strategy = new TestScraperStrategy();
      strategy.processItem.mockClear();
    });

    it("should only process URLs matching includePatterns (glob)", async () => {
      const options: ScraperOptions = {
        url: "https://example.com/docs/start",
        library: "test",
        version: "1.0.0",
        maxPages: 5,
        maxDepth: 1,
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
      strategy = new TestScraperStrategy();
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
      strategy = new TestScraperStrategy();
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
      strategy = new TestScraperStrategy();
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
