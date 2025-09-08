import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../../types";
import type { ScraperOptions } from "../types";
import { ScrapeMode } from "../types"; // Import ScrapeMode
import { WebScraperStrategy } from "./WebScraperStrategy";

// Mock dependencies
vi.mock("../../utils/logger");

// Mock HttpFetcher module with a factory
vi.mock("../fetcher/HttpFetcher", async (importActual) => {
  return {
    ...(await importActual()),
  };
});

// Import the mocked HttpFetcher AFTER vi.mock
import { HttpFetcher } from "../fetcher/HttpFetcher";

// Hold the mock function reference outside the factory scope
const mockFetchFn = vi.spyOn(HttpFetcher.prototype, "fetch");

describe("WebScraperStrategy", () => {
  let strategy: WebScraperStrategy;
  let options: ScraperOptions;

  beforeEach(() => {
    vi.resetAllMocks(); // Resets calls and implementations on ALL mocks

    // Set default mock behavior for the fetch function for the suite
    mockFetchFn.mockResolvedValue({
      content: "<html><body><h1>Default Mock Content</h1></body></html>",
      mimeType: "text/html",
      source: "https://example.com", // Default source
    });

    // Create a fresh instance of the strategy for each test
    // It will receive the mocked HttpFetcher via dependency injection (if applicable)
    // or internal instantiation (which will use the mocked module)
    strategy = new WebScraperStrategy();

    // Setup default options for tests
    options = {
      url: "https://example.com",
      library: "test",
      version: "1.0",
      maxPages: 99,
      maxDepth: 3,
      scope: "subpages",
      // Ensure followRedirects has a default for tests if needed by fetch mock checks
      followRedirects: true,
      scrapeMode: ScrapeMode.Fetch, // Use enum member
    };

    // No need to mock prototype anymore
    // No need to mock pipeline directly
  });

  // No need for afterEach vi.restoreAllMocks() as resetAllMocks() is in beforeEach

  it("should only accept http/https URLs", () => {
    expect(strategy.canHandle("https://example.com")).toBe(true);
    expect(strategy.canHandle("http://example.com")).toBe(true);
    expect(strategy.canHandle("file:///path/to/file.txt")).toBe(false);
    expect(strategy.canHandle("invalid://example.com")).toBe(false);
    expect(strategy.canHandle("any_string")).toBe(false);
  }, 10000);

  it("should use HttpFetcher to fetch content and process result", async () => {
    const progressCallback = vi.fn();
    const testUrl = "https://example.com";
    options.url = testUrl; // Ensure options match

    // Configure mock response for this specific test
    const expectedTitle = "Test Page Title";
    mockFetchFn.mockResolvedValue({
      content: `<html><head><title>${expectedTitle}</title></head><body><h1>Fetched Content</h1></body></html>`,
      mimeType: "text/html",
      source: testUrl,
    });

    await strategy.scrape(options, progressCallback);

    // Verify HttpFetcher mock was called
    expect(mockFetchFn).toHaveBeenCalledWith(testUrl, {
      signal: undefined, // scrape doesn't pass signal in this basic call
      followRedirects: options.followRedirects, // Check default from options
    });

    // Verify that the pipeline processed and called the callback with a document
    expect(progressCallback).toHaveBeenCalled();
    const documentProcessingCall = progressCallback.mock.calls.find(
      (call) => call[0].document,
    );
    expect(documentProcessingCall).toBeDefined();
    // Use non-null assertion operator (!) since we've asserted it's defined
    expect(documentProcessingCall![0].document.content).toBe("# Fetched Content"); // Check processed markdown (from H1)
    expect(documentProcessingCall![0].document.metadata.title).toBe(expectedTitle); // Check extracted title (from <title>)
  }, 10000);

  it("should respect the followRedirects option", async () => {
    options.followRedirects = false;
    const progressCallback = vi.fn();

    await strategy.scrape(options, progressCallback);

    // Verify followRedirects option was passed to the fetcher mock
    expect(mockFetchFn).toHaveBeenCalledWith("https://example.com", {
      signal: undefined,
      followRedirects: false, // Explicitly false from options
    });
    // Also check that processing still happened
    expect(progressCallback).toHaveBeenCalled();
    const documentProcessingCall = progressCallback.mock.calls.find(
      (call) => call[0].document,
    );
    expect(documentProcessingCall).toBeDefined();
  }, 10000);

  // --- Scope Tests ---
  // These tests now rely on the actual pipeline running,
  // verifying behavior by checking mockFetchFn calls and progressCallback results.

  it("should follow links based on scope=subpages", async () => {
    const baseHtml = `
      <html><head><title>Test Site</title></head><body>
        <h1>Test Page</h1>
        <a href="https://example.com/subpage1">Subpage 1</a>
        <a href="https://example.com/subpage2/">Subpage 2</a>
        <a href="https://otherdomain.com/page">External Link</a>
        <a href="https://api.example.com/endpoint">Different Subdomain</a>
        <a href="/relative-path">Relative Path</a>
      </body></html>`;

    mockFetchFn.mockImplementation(async (url: string) => {
      if (url === "https://example.com")
        return { content: baseHtml, mimeType: "text/html", source: url };
      // Return simple content for subpages, title reflects URL
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
      };
    });

    options.scope = "subpages";
    options.maxDepth = 1; // Limit depth for simplicity
    options.maxPages = 5; // Allow enough pages
    const progressCallback = vi.fn();

    await strategy.scrape(options, progressCallback);

    // Verify fetcher calls
    expect(mockFetchFn).toHaveBeenCalledWith("https://example.com", expect.anything());
    expect(mockFetchFn).toHaveBeenCalledWith(
      "https://example.com/subpage1",
      expect.anything(),
    );
    expect(mockFetchFn).toHaveBeenCalledWith(
      "https://example.com/subpage2/",
      expect.anything(),
    );
    expect(mockFetchFn).toHaveBeenCalledWith(
      "https://example.com/relative-path",
      expect.anything(),
    );
    expect(mockFetchFn).not.toHaveBeenCalledWith(
      "https://otherdomain.com/page",
      expect.anything(),
    );
    expect(mockFetchFn).not.toHaveBeenCalledWith(
      "https://api.example.com/endpoint",
      expect.anything(),
    );

    // Verify documents via callback
    const receivedDocs = progressCallback.mock.calls
      .map((call) => call[0].document)
      .filter((doc): doc is Document => doc !== undefined); // Type guard

    expect(receivedDocs).toHaveLength(4);
    expect(receivedDocs.some((doc) => doc.metadata.title === "Test Site")).toBe(true);
    expect(
      receivedDocs.some((doc) => doc.metadata.title === "https://example.com/subpage1"),
    ).toBe(true);
    expect(
      receivedDocs.some((doc) => doc.metadata.title === "https://example.com/subpage2/"),
    ).toBe(true);
    expect(
      receivedDocs.some(
        (doc) => doc.metadata.title === "https://example.com/relative-path",
      ),
    ).toBe(true);
  }, 10000);

  it("should follow links based on scope=hostname", async () => {
    mockFetchFn.mockImplementation(async (url: string) => {
      if (url === "https://example.com") {
        return {
          content:
            '<html><head><title>Base</title></head><body><a href="/subpage">Sub</a><a href="https://api.example.com/ep">API</a><a href="https://other.com">Other</a></body></html>',
          mimeType: "text/html",
          source: url,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
      };
    });

    options.scope = "hostname";
    options.maxDepth = 1;
    const progressCallback = vi.fn();

    await strategy.scrape(options, progressCallback);

    // Verify fetcher calls
    expect(mockFetchFn).toHaveBeenCalledWith("https://example.com", expect.anything());
    expect(mockFetchFn).toHaveBeenCalledWith(
      "https://example.com/subpage",
      expect.anything(),
    );
    expect(mockFetchFn).not.toHaveBeenCalledWith(
      "https://api.example.com/ep",
      expect.anything(),
    );
    expect(mockFetchFn).not.toHaveBeenCalledWith("https://other.com", expect.anything());

    // Verify documents via callback
    const receivedDocs = progressCallback.mock.calls
      .map((call) => call[0].document)
      .filter((doc): doc is Document => doc !== undefined);
    expect(receivedDocs).toHaveLength(2);
    expect(receivedDocs.some((doc) => doc.metadata.title === "Base")).toBe(true);
    expect(
      receivedDocs.some((doc) => doc.metadata.title === "https://example.com/subpage"),
    ).toBe(true);
  }, 10000);

  it("should follow links based on scope=domain", async () => {
    mockFetchFn.mockImplementation(async (url: string) => {
      if (url === "https://example.com") {
        return {
          content:
            '<html><head><title>Base</title></head><body><a href="/subpage">Sub</a><a href="https://api.example.com/ep">API</a><a href="https://other.com">Other</a></body></html>',
          mimeType: "text/html",
          source: url,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
      };
    });

    options.scope = "domain";
    options.maxDepth = 1;
    const progressCallback = vi.fn();

    await strategy.scrape(options, progressCallback);

    // Verify fetcher calls
    expect(mockFetchFn).toHaveBeenCalledWith("https://example.com", expect.anything());
    expect(mockFetchFn).toHaveBeenCalledWith(
      "https://example.com/subpage",
      expect.anything(),
    );
    expect(mockFetchFn).toHaveBeenCalledWith(
      "https://api.example.com/ep",
      expect.anything(),
    ); // Same domain
    expect(mockFetchFn).not.toHaveBeenCalledWith("https://other.com", expect.anything());

    // Verify documents via callback
    const receivedDocs = progressCallback.mock.calls
      .map((call) => call[0].document)
      .filter((doc): doc is Document => doc !== undefined);
    expect(receivedDocs).toHaveLength(3);
    expect(receivedDocs.some((doc) => doc.metadata.title === "Base")).toBe(true);
    expect(
      receivedDocs.some((doc) => doc.metadata.title === "https://example.com/subpage"),
    ).toBe(true);
    expect(
      receivedDocs.some((doc) => doc.metadata.title === "https://api.example.com/ep"),
    ).toBe(true);
  }, 10000);

  // --- Limit Tests ---

  it("should respect maxDepth option", async () => {
    // Configure mock fetcher for depth testing
    mockFetchFn.mockImplementation(async (url: string) => {
      if (url === "https://example.com") {
        // Depth 0
        return {
          content:
            '<html><head><title>L0</title></head><body><a href="/level1">L1</a></body></html>',
          mimeType: "text/html",
          source: url,
        };
      }
      if (url === "https://example.com/level1") {
        // Depth 1
        return {
          content:
            '<html><head><title>L1</title></head><body><a href="/level2">L2</a></body></html>',
          mimeType: "text/html",
          source: url,
        };
      }
      if (url === "https://example.com/level2") {
        // Depth 2
        return {
          content:
            '<html><head><title>L2</title></head><body><a href="/level3">L3</a></body></html>',
          mimeType: "text/html",
          source: url,
        };
      }
      // Default for unexpected calls
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
      };
    });

    options.maxDepth = 1; // Limit depth
    const progressCallback = vi.fn();

    await strategy.scrape(options, progressCallback);

    // Verify fetcher calls
    expect(mockFetchFn).toHaveBeenCalledWith("https://example.com", expect.anything());
    expect(mockFetchFn).toHaveBeenCalledWith(
      "https://example.com/level1",
      expect.anything(),
    );
    expect(mockFetchFn).not.toHaveBeenCalledWith(
      "https://example.com/level2",
      expect.anything(),
    ); // Exceeds depth

    // Verify documents via callback
    const receivedDocs = progressCallback.mock.calls
      .map((call) => call[0].document)
      .filter((doc): doc is Document => doc !== undefined);
    expect(receivedDocs).toHaveLength(2); // Base (L0) + L1
    expect(receivedDocs.some((doc) => doc.metadata.title === "L0")).toBe(true);
    expect(receivedDocs.some((doc) => doc.metadata.title === "L1")).toBe(true);
  }, 10000);

  it("should respect maxPages option", async () => {
    // Configure mock fetcher
    mockFetchFn.mockImplementation(async (url: string) => {
      if (url === "https://example.com") {
        return {
          content:
            '<html><head><title>Base</title></head><body><a href="/page1">1</a><a href="/page2">2</a><a href="/page3">3</a></body></html>',
          mimeType: "text/html",
          source: url,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
      };
    });

    options.maxPages = 2; // Limit pages
    const progressCallback = vi.fn();

    await strategy.scrape(options, progressCallback);

    // Verify fetcher calls (should be exactly maxPages)
    expect(mockFetchFn).toHaveBeenCalledTimes(2);
    expect(mockFetchFn).toHaveBeenCalledWith("https://example.com", expect.anything());

    // Check which subpage was called (only one should be)
    const page1Called = mockFetchFn.mock.calls.some(
      (call) => call[0] === "https://example.com/page1",
    );
    const page2Called = mockFetchFn.mock.calls.some(
      (call) => call[0] === "https://example.com/page2",
    );
    const page3Called = mockFetchFn.mock.calls.some(
      (call) => call[0] === "https://example.com/page3",
    );
    const subpagesFetchedCount = [page1Called, page2Called, page3Called].filter(
      Boolean,
    ).length;
    expect(subpagesFetchedCount).toBe(1); // Exactly one subpage fetched

    // Verify documents via callback
    const receivedDocs = progressCallback.mock.calls
      .map((call) => call[0].document)
      .filter((doc): doc is Document => doc !== undefined);
    expect(receivedDocs).toHaveLength(2); // Base + 1 subpage
  }, 10000);

  // --- Progress Test ---

  it("should report progress via callback", async () => {
    // Configure mock fetcher
    mockFetchFn.mockImplementation(async (url: string) => {
      if (url === "https://example.com") {
        return {
          content:
            '<html><head><title>Base</title></head><body><a href="/page1">1</a><a href="/page2">2</a></body></html>',
          mimeType: "text/html",
          source: url,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
      };
    });

    const progressCallback = vi.fn();
    options.maxPages = 3; // Allow all pages
    options.maxDepth = 1;

    await strategy.scrape(options, progressCallback);

    // Verify callback calls
    const callsWithDocs = progressCallback.mock.calls.filter((call) => call[0].document);
    expect(callsWithDocs).toHaveLength(3); // Base + page1 + page2

    // Check structure of a progress call with a document
    expect(callsWithDocs[0][0]).toMatchObject({
      pagesScraped: expect.any(Number),
      totalPages: expect.any(Number),
      currentUrl: expect.any(String),
      depth: expect.any(Number),
      maxDepth: options.maxDepth,
      document: expect.objectContaining({
        content: expect.any(String),
        metadata: expect.objectContaining({
          url: expect.any(String),
          title: expect.any(String), // Title comes from pipeline now
          library: options.library,
          version: options.version,
        }),
      }),
    });

    // Check specific URLs reported
    const reportedUrls = callsWithDocs.map((call) => call[0].document.metadata.url);
    expect(reportedUrls).toEqual(
      expect.arrayContaining([
        "https://example.com",
        "https://example.com/page1",
        "https://example.com/page2",
      ]),
    );
  }, 10000);

  it("should support scraping for URLs with embedded credentials (user:password@host)", async () => {
    // Test that the strategy can handle URLs with embedded credentials
    // Note: Actual credential extraction and browser auth is tested in HtmlPlaywrightMiddleware.test.ts
    // This test focuses on the strategy's ability to process such URLs through the pipeline
    const urlWithCreds = "https://user:password@example.com/";
    options.url = urlWithCreds;
    options.scrapeMode = ScrapeMode.Fetch; // Use fetch mode to avoid Playwright browser operations
    const expectedMarkdown = "# Processed Content";
    const expectedTitle = "Test Page";

    // Mock fetch to simulate content processing
    // We'll mock the fetch to simulate processed output
    mockFetchFn.mockResolvedValue({
      content: `<html><head><title>${expectedTitle}</title></head><body><h1>Processed Content</h1></body></html>`,
      mimeType: "text/html",
      source: urlWithCreds,
    });

    const progressCallback = vi.fn();
    await strategy.scrape(options, progressCallback);

    // Ensure fetch was called with the credentialed URL
    expect(mockFetchFn).toHaveBeenCalledWith(
      urlWithCreds,
      expect.objectContaining({ followRedirects: true }),
    );
    // Ensure a document was produced with the expected markdown and title
    const docCall = progressCallback.mock.calls.find((call) => call[0].document);
    expect(docCall).toBeDefined();
    expect(docCall![0].document.content).toContain(expectedMarkdown);
    expect(docCall![0].document.metadata.title).toBe(expectedTitle);
  }, 10000); // Keep timeout for consistency but test should run quickly with fetch mode

  it("should forward custom headers to HttpFetcher", async () => {
    const progressCallback = vi.fn();
    const testUrl = "https://example.com";
    options.url = testUrl;
    options.headers = {
      Authorization: "Bearer test-token",
      "X-Test-Header": "test-value",
    };
    mockFetchFn.mockResolvedValue({
      content: "<html><body>Header Test</body></html>",
      mimeType: "text/html",
      source: testUrl,
    });
    await strategy.scrape(options, progressCallback);
    expect(mockFetchFn).toHaveBeenCalledWith(
      testUrl,
      expect.objectContaining({
        headers: {
          Authorization: "Bearer test-token",
          "X-Test-Header": "test-value",
        },
      }),
    );
  });

  describe("pipeline selection", () => {
    it("should process HTML content through HtmlPipeline", async () => {
      const progressCallback = vi.fn();
      const testUrl = "https://example.com";
      options.url = testUrl;

      mockFetchFn.mockResolvedValue({
        content:
          "<html><head><title>HTML Test</title></head><body><h1>HTML Content</h1></body></html>",
        mimeType: "text/html",
        source: testUrl,
      });

      await strategy.scrape(options, progressCallback);

      // Verify HTML content was processed (converted to markdown)
      const docCall = progressCallback.mock.calls.find((call) => call[0].document);
      expect(docCall).toBeDefined();
      expect(docCall![0].document.content).toContain("# HTML Content");
      expect(docCall![0].document.metadata.title).toBe("HTML Test");
    });

    it("should process markdown content through MarkdownPipeline", async () => {
      const progressCallback = vi.fn();
      const testUrl = "https://example.com/readme.md";
      options.url = testUrl;

      const markdownContent = "# Markdown Title\n\nThis is already markdown content.";
      mockFetchFn.mockResolvedValue({
        content: markdownContent,
        mimeType: "text/markdown",
        source: testUrl,
      });

      await strategy.scrape(options, progressCallback);

      // Verify markdown content was processed
      const docCall = progressCallback.mock.calls.find((call) => call[0].document);
      expect(docCall).toBeDefined();
      expect(docCall![0].document.content).toContain("# Markdown Title");
      expect(docCall![0].document.content).toContain("This is already markdown content.");
    });

    it("should skip unsupported content types", async () => {
      const progressCallback = vi.fn();
      const testUrl = "https://example.com/image.png";
      options.url = testUrl;

      mockFetchFn.mockResolvedValue({
        content: Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG header
        mimeType: "image/png",
        source: testUrl,
      });

      await strategy.scrape(options, progressCallback);

      // Verify no document was produced for unsupported content
      const docCall = progressCallback.mock.calls.find((call) => call[0].document);
      expect(docCall).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("should handle fetch failures gracefully", async () => {
      const progressCallback = vi.fn();
      const testUrl = "https://example.com/error";
      options.url = testUrl;

      mockFetchFn.mockRejectedValue(new Error("Network error"));

      // Should throw the error (not swallow it)
      await expect(strategy.scrape(options, progressCallback)).rejects.toThrow(
        "Network error",
      );

      // Verify no documents were processed
      const docCalls = progressCallback.mock.calls.filter((call) => call[0].document);
      expect(docCalls).toHaveLength(0);
    });

    it("should handle empty content gracefully", async () => {
      const progressCallback = vi.fn();
      const testUrl = "https://example.com/empty";
      options.url = testUrl;

      mockFetchFn.mockResolvedValue({
        content: "<html><body></body></html>", // Empty content
        mimeType: "text/html",
        source: testUrl,
      });

      await strategy.scrape(options, progressCallback);

      // Should complete without error but may not produce useful content
      // The behavior here depends on the pipeline implementation
      expect(mockFetchFn).toHaveBeenCalledWith(testUrl, expect.anything());
    });
  });

  describe("custom link filtering", () => {
    it("should use custom shouldFollowLink function when provided", async () => {
      const customFilter = vi.fn().mockImplementation((_baseUrl: URL, targetUrl: URL) => {
        // Only follow links containing 'allowed'
        return targetUrl.pathname.includes("allowed");
      });

      const customStrategy = new WebScraperStrategy({
        shouldFollowLink: customFilter,
      });

      mockFetchFn.mockImplementation(async (url: string) => {
        if (url === "https://example.com") {
          return {
            content: `
              <html><head><title>Base</title></head><body>
                <a href="/allowed-page">Allowed Page</a>
                <a href="/blocked-page">Blocked Page</a>
                <a href="/also-allowed">Also Allowed</a>
              </body></html>`,
            mimeType: "text/html",
            source: url,
          };
        }
        return {
          content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
          mimeType: "text/html",
          source: url,
        };
      });

      options.maxDepth = 1;
      const progressCallback = vi.fn();

      await customStrategy.scrape(options, progressCallback);

      // Verify custom filter was called
      expect(customFilter).toHaveBeenCalled();

      // Verify only allowed pages were fetched
      expect(mockFetchFn).toHaveBeenCalledWith("https://example.com", expect.anything());
      expect(mockFetchFn).toHaveBeenCalledWith(
        "https://example.com/allowed-page",
        expect.anything(),
      );
      expect(mockFetchFn).toHaveBeenCalledWith(
        "https://example.com/also-allowed",
        expect.anything(),
      );
      expect(mockFetchFn).not.toHaveBeenCalledWith(
        "https://example.com/blocked-page",
        expect.anything(),
      );

      // Verify documents were produced for allowed pages
      const receivedDocs = progressCallback.mock.calls
        .map((call) => call[0].document)
        .filter((doc): doc is Document => doc !== undefined);
      expect(receivedDocs).toHaveLength(3); // Base + 2 allowed pages
    });
  });

  // Canonical redirect test: relative links resolve against canonical final URL (directory form)
  it("should resolve relative links against canonical final URL with trailing slash + query", async () => {
    const original = "https://learn.microsoft.com/en-us/azure/bot-service";
    const canonical = `${original}/?view=azure-bot-service-4.0`; // What the server redirects to
    const relHref = "bot-overview?view=azure-bot-service-4.0";
    const expectedCanonicalFollow =
      "https://learn.microsoft.com/en-us/azure/bot-service/bot-overview?view=azure-bot-service-4.0";

    // Mock fetch: initial fetch returns HTML with relative link and final canonical source (post-redirect)
    mockFetchFn.mockImplementation(async (url: string) => {
      if (url === original) {
        return {
          content: `<html><body><a href="${relHref}">Link</a></body></html>`,
          mimeType: "text/html",
          source: canonical, // Final URL after redirect
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
      };
    });

    options.url = original;
    options.maxDepth = 1;
    options.maxPages = 5;

    const progressCallback = vi.fn();
    await strategy.scrape(options, progressCallback);

    expect(mockFetchFn).toHaveBeenCalledWith(original, expect.anything());
    expect(mockFetchFn).toHaveBeenCalledWith(expectedCanonicalFollow, expect.anything());
  });

  // Integration: relative resolution from index.html with subpages scope
  it("should follow nested descendant from index.html (subpages scope) but not upward sibling", async () => {
    const start = "https://example.com/api/index.html";
    const nestedRel = "aiq/agent/index.html";
    const upwardRel = "../shared/index.html";
    const expectedNested = "https://example.com/api/aiq/agent/index.html";
    const expectedUpward = "https://example.com/shared/index.html";

    mockFetchFn.mockImplementation(async (url: string) => {
      if (url === start) {
        return {
          content: `<html><body>
            <a href="${nestedRel}">Nested</a>
            <a href="${upwardRel}">UpOne</a>
          </body></html>`,
          mimeType: "text/html",
          source: url,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
      };
    });

    options.url = start;
    options.scope = "subpages";
    options.maxDepth = 1;
    options.maxPages = 5;

    const progressCallback = vi.fn();
    await strategy.scrape(options, progressCallback);

    expect(mockFetchFn).toHaveBeenCalledWith(start, expect.anything());
    expect(mockFetchFn).toHaveBeenCalledWith(expectedNested, expect.anything());
    expect(mockFetchFn).not.toHaveBeenCalledWith(expectedUpward, expect.anything());
  });

  // Integration: upward relative allowed with hostname scope
  it("should follow upward relative link when scope=hostname", async () => {
    const start = "https://example.com/api/index.html";
    const nestedRel = "aiq/agent/index.html";
    const upwardRel = "../shared/index.html";
    const expectedNested = "https://example.com/api/aiq/agent/index.html";
    const expectedUpward = "https://example.com/shared/index.html";

    mockFetchFn.mockImplementation(async (url: string) => {
      if (url === start) {
        return {
          content: `<html><body>
            <a href="${nestedRel}">Nested</a>
            <a href="${upwardRel}">UpOne</a>
          </body></html>`,
          mimeType: "text/html",
          source: url,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
      };
    });

    options.url = start;
    options.scope = "hostname";
    options.maxDepth = 1;
    options.maxPages = 10;

    const progressCallback = vi.fn();
    await strategy.scrape(options, progressCallback);

    expect(mockFetchFn).toHaveBeenCalledWith(start, expect.anything());
    expect(mockFetchFn).toHaveBeenCalledWith(expectedNested, expect.anything());
    expect(mockFetchFn).toHaveBeenCalledWith(expectedUpward, expect.anything());
  });

  // Integration: directory base parity
  it("should treat directory base and index.html base equivalently for nested descendant", async () => {
    const startDir = "https://example.com/api/";
    const nestedRel = "aiq/agent/index.html";
    const expectedNested = "https://example.com/api/aiq/agent/index.html";

    mockFetchFn.mockImplementation(async (url: string) => {
      if (url === startDir) {
        return {
          content: `<html><body><a href="${nestedRel}">Nested</a></body></html>`,
          mimeType: "text/html",
          source: url,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
      };
    });

    options.url = startDir;
    options.scope = "subpages";
    options.maxDepth = 1;
    options.maxPages = 5;

    const progressCallback = vi.fn();
    await strategy.scrape(options, progressCallback);

    expect(mockFetchFn).toHaveBeenCalledWith(startDir, expect.anything());
    expect(mockFetchFn).toHaveBeenCalledWith(expectedNested, expect.anything());
  });

  it("should not enqueue cross-origin links introduced via <base href> when scope=subpages", async () => {
    const start = "https://example.com/app/index.html";
    const cdnBase = "https://cdn.example.com/lib/";
    const relLink = "script.js";
    const resolved = `${cdnBase}${relLink}`;

    mockFetchFn.mockImplementation(async (url: string) => {
      if (url === start) {
        return {
          content: `<html><head><base href="${cdnBase}"></head><body><a href="${relLink}">Script</a></body></html>`,
          mimeType: "text/html",
          source: url,
        };
      }
      // Any unexpected fetches return generic content
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
      };
    });

    options.url = start;
    options.scope = "subpages";
    options.maxDepth = 1;
    options.maxPages = 5;

    const progressCallback = vi.fn();
    await strategy.scrape(options, progressCallback);

    // Should fetch only the start page; the cross-origin (different hostname) base-derived link is filtered out
    expect(mockFetchFn).toHaveBeenCalledWith(start, expect.anything());
    expect(mockFetchFn).not.toHaveBeenCalledWith(resolved, expect.anything());
  });

  describe("cleanup", () => {
    it("should call close() on all pipelines when cleanup() is called", async () => {
      const strategy = new WebScraperStrategy();

      // Spy on the close method of all pipelines
      strategy.pipelines.forEach((pipeline) => {
        vi.spyOn(pipeline, "close");
      });

      await strategy.cleanup();

      // Verify close was called on all pipelines
      strategy.pipelines.forEach((pipeline) => {
        expect(pipeline.close).toHaveBeenCalledOnce();
      });
    });

    it("should handle cleanup errors gracefully", async () => {
      const strategy = new WebScraperStrategy();

      // Mock one pipeline to throw an error during cleanup
      vi.spyOn(strategy.pipelines[0], "close").mockRejectedValue(
        new Error("Pipeline cleanup failed"),
      );

      // cleanup() should still complete and not throw
      await expect(strategy.cleanup()).resolves.not.toThrow();
    });

    it("should be idempotent - multiple cleanup() calls should not error", async () => {
      const strategy = new WebScraperStrategy();

      // Multiple calls should not throw
      await expect(strategy.cleanup()).resolves.not.toThrow();
      await expect(strategy.cleanup()).resolves.not.toThrow();
    });
  });
});
