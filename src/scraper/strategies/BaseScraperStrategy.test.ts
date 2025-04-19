import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScraperOptions } from "../types";
import { BaseScraperStrategy, type QueueItem } from "./BaseScraperStrategy";

// Mock logger
vi.mock("../../utils/logger");

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
    const progressCallback = vi.fn();

    strategy.processItem.mockResolvedValue({
      document: { content: "test", metadata: {} },
      links: [],
    });

    await strategy.scrape(options, progressCallback);

    expect(strategy.processItem).toHaveBeenCalledTimes(1);
    expect(progressCallback).toHaveBeenCalledWith({
      pagesScraped: 1,
      maxPages: 1,
      currentUrl: "https://example.com/",
      depth: 0,
      maxDepth: 1,
      document: { content: "test", metadata: {} },
    });
  });

  it("should respect maxPages", async () => {
    const options: ScraperOptions = {
      url: "https://example.com/",
      library: "test",
      version: "1.0.0",
      maxPages: 2,
      maxDepth: 1,
    };

    const progressCallback = vi.fn();

    strategy.processItem.mockResolvedValue({
      document: { content: "test", metadata: {} },
      links: ["https://example.com/page2", "https://example.com/page3"],
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
    const progressCallback = vi.fn();
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
    const progressCallback = vi.fn();
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
    const progressCallback = vi.fn();

    // Return the same URLs multiple times to simulate duplicate links
    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      if (item.url === "https://example.com/") {
        return {
          document: { content: "main page", metadata: {} },
          links: [
            "https://example.com/page1",
            "https://example.com/page1", // Duplicate
            "https://example.com/page2",
            "https://example.com/page2/", // Duplicate with trailing slash
          ],
        };
      }
      return {
        document: { content: "sub page", metadata: {} },
        links: [],
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
    const progressCallback = vi.fn();

    // First page returns variations of the same URL
    let firstPageCalled = false;
    strategy.processItem.mockImplementation(async (item: QueueItem) => {
      if (item.url === "https://example.com/") {
        firstPageCalled = true;
        return {
          document: { content: "main page", metadata: {} },
          links: [
            "https://example.com/path/",
            "https://example.com/path", // Without trailing slash
            "https://example.com/path?q=1",
            "https://example.com/path?q=1#anchor", // With anchor
            "https://example.com/path", // Different case
          ],
        };
      }
      return {
        document: { content: "sub page", metadata: {} },
        links: [],
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
    const progressCallback = vi.fn();

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
        document: { content: `Content for ${url}`, metadata: {} },
        links,
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
});
