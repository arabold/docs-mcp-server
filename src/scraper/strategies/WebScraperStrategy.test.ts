import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressCallback } from "../../types";
import { type AppConfig, loadConfig } from "../../utils/config";
import { FetchStatus } from "../fetcher/types";
import type { ScrapeResult, ScraperOptions, ScraperProgressEvent } from "../types";
import { ScrapeMode } from "../types"; // Import ScrapeMode
import { WebScraperStrategy } from "./WebScraperStrategy";

// Mock dependencies

// Mock dependencies

// Import the mocked HttpFetcher AFTER vi.mock
import { HttpFetcher } from "../fetcher/HttpFetcher";

// Hold the mock function reference outside the factory scope
const mockFetchFn = vi.spyOn(HttpFetcher.prototype, "fetch");

describe("WebScraperStrategy", () => {
  let strategy: WebScraperStrategy;
  let options: ScraperOptions;
  let appConfig: AppConfig;

  beforeEach(() => {
    vi.resetAllMocks(); // Resets calls and implementations on ALL mocks

    appConfig = loadConfig();

    // Set default mock behavior for the fetch function for the suite
    mockFetchFn.mockResolvedValue({
      content: "<html><body><h1>Default Mock Content</h1></body></html>",
      mimeType: "text/html",
      source: "https://example.com", // Default source
      status: FetchStatus.SUCCESS,
    });

    // Create a fresh instance of the strategy for each test
    // It will receive the mocked HttpFetcher via dependency injection (if applicable)
    // or internal instantiation (which will use the mocked module)
    strategy = new WebScraperStrategy(appConfig);

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
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    const testUrl = "https://example.com";
    options.url = testUrl; // Ensure options match

    // Configure mock response for this specific test
    const expectedTitle = "Test Page Title";
    mockFetchFn.mockResolvedValue({
      content: `<html><head><title>${expectedTitle}</title></head><body><h1>Fetched Content</h1></body></html>`,
      mimeType: "text/html",
      source: testUrl,
      status: FetchStatus.SUCCESS,
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
      (call) => call[0].result,
    );
    expect(documentProcessingCall).toBeDefined();
    // Use non-null assertion operator (!) since we've asserted it's defined
    expect(documentProcessingCall![0].result?.textContent).toBe("# Fetched Content"); // Check processed markdown (from H1)
    expect(documentProcessingCall![0].result?.title).toBe(expectedTitle); // Check extracted title (from <title>)
  }, 10000);

  it("should respect the followRedirects option", async () => {
    options.followRedirects = false;
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

    await strategy.scrape(options, progressCallback);

    // Verify followRedirects option was passed to the fetcher mock
    expect(mockFetchFn).toHaveBeenCalledWith("https://example.com", {
      signal: undefined,
      followRedirects: false, // Explicitly false from options
    });
    // Also check that processing still happened
    expect(progressCallback).toHaveBeenCalled();
    const documentProcessingCall = progressCallback.mock.calls.find(
      (call) => call[0].result,
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
        return {
          content: baseHtml,
          mimeType: "text/html",
          source: url,
          status: FetchStatus.SUCCESS,
        };
      // Return simple content for subpages, title reflects URL
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
        status: FetchStatus.SUCCESS,
      };
    });

    options.scope = "subpages";
    options.maxDepth = 1; // Limit depth for simplicity
    options.maxPages = 5; // Allow enough pages
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

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
    const receivedDocs = progressCallback.mock.calls.map((call) => call[0].result);
    expect(receivedDocs).toHaveLength(4);
    expect(receivedDocs.some((doc) => doc?.title === "Test Site")).toBe(true);
    expect(
      receivedDocs.some((doc) => doc?.title === "https://example.com/subpage1"),
    ).toBe(true);
    expect(
      receivedDocs.some((doc) => doc?.title === "https://example.com/subpage2/"),
    ).toBe(true);
    expect(
      receivedDocs.some((doc) => doc?.title === "https://example.com/relative-path"),
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
          status: FetchStatus.SUCCESS,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
        status: FetchStatus.SUCCESS,
      };
    });

    options.scope = "hostname";
    options.maxDepth = 1;
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

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
    const receivedDocs = progressCallback.mock.calls.map((call) => call[0].result);
    expect(receivedDocs).toHaveLength(2);
    expect(receivedDocs.some((doc) => doc?.title === "Base")).toBe(true);
    expect(receivedDocs.some((doc) => doc?.title === "https://example.com/subpage")).toBe(
      true,
    );
  }, 10000);

  it("should follow links based on scope=domain", async () => {
    mockFetchFn.mockImplementation(async (url: string) => {
      if (url === "https://example.com") {
        return {
          content:
            '<html><head><title>Base</title></head><body><a href="/subpage">Sub</a><a href="https://api.example.com/ep">API</a><a href="https://other.com">Other</a></body></html>',
          mimeType: "text/html",
          source: url,
          status: FetchStatus.SUCCESS,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
        status: FetchStatus.SUCCESS,
      };
    });

    options.scope = "domain";
    options.maxDepth = 1;
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

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
    const receivedDocs = progressCallback.mock.calls.map((call) => call[0].result);
    expect(receivedDocs).toHaveLength(3);
    expect(receivedDocs.some((doc) => doc?.title === "Base")).toBe(true);
    expect(receivedDocs.some((doc) => doc?.title === "https://example.com/subpage")).toBe(
      true,
    );
    expect(receivedDocs.some((doc) => doc?.title === "https://api.example.com/ep")).toBe(
      true,
    );
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
          status: FetchStatus.SUCCESS,
        };
      }
      if (url === "https://example.com/level1") {
        // Depth 1
        return {
          content:
            '<html><head><title>L1</title></head><body><a href="/level2">L2</a></body></html>',
          mimeType: "text/html",
          source: url,
          status: FetchStatus.SUCCESS,
        };
      }
      if (url === "https://example.com/level2") {
        // Depth 2
        return {
          content:
            '<html><head><title>L2</title></head><body><a href="/level3">L3</a></body></html>',
          mimeType: "text/html",
          source: url,
          status: FetchStatus.SUCCESS,
        };
      }
      // Default for unexpected calls
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
        status: FetchStatus.SUCCESS,
      };
    });

    options.maxDepth = 1; // Limit depth
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

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
    const receivedDocs = progressCallback.mock.calls.map((call) => call[0].result);
    expect(receivedDocs).toHaveLength(2); // Base (L0) + L1
    expect(receivedDocs.some((doc) => doc?.title === "L0")).toBe(true);
    expect(receivedDocs.some((doc) => doc?.title === "L1")).toBe(true);
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
          status: FetchStatus.SUCCESS,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
        status: FetchStatus.SUCCESS,
      };
    });

    options.maxPages = 2; // Limit pages
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

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
    const receivedDocs = progressCallback.mock.calls.map((call) => call[0].result);
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
          status: FetchStatus.SUCCESS,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
        status: FetchStatus.SUCCESS,
      };
    });

    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    options.maxPages = 3; // Allow all pages
    options.maxDepth = 1;

    await strategy.scrape(options, progressCallback);

    // Verify callback calls
    const callsWithDocs = progressCallback.mock.calls.filter((call) => call[0].result);
    expect(callsWithDocs).toHaveLength(3); // Base + page1 + page2

    // Check structure of a progress call with a document
    expect(callsWithDocs[0][0]).toMatchObject({
      pagesScraped: expect.any(Number),
      totalPages: expect.any(Number),
      currentUrl: expect.any(String),
      depth: expect.any(Number),
      maxDepth: options.maxDepth,
      result: expect.objectContaining({
        textContent: expect.any(String),
        url: expect.any(String),
        title: expect.any(String),
      } satisfies Partial<ScrapeResult>),
    } satisfies Partial<ScraperProgressEvent>);

    // Check specific URLs reported
    const reportedUrls = callsWithDocs.map((call) => call[0].result?.url);
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
      status: FetchStatus.SUCCESS,
    });

    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    await strategy.scrape(options, progressCallback);

    // Ensure fetch was called with the credentialed URL
    expect(mockFetchFn).toHaveBeenCalledWith(
      urlWithCreds,
      expect.objectContaining({ followRedirects: true }),
    );
    // Ensure a document was produced with the expected markdown and title
    const docCall = progressCallback.mock.calls.find((call) => call[0].result);
    expect(docCall).toBeDefined();
    expect(docCall![0].result?.textContent).toContain(expectedMarkdown);
    expect(docCall![0].result?.title).toBe(expectedTitle);
  }, 10000); // Keep timeout for consistency but test should run quickly with fetch mode

  it("should forward custom headers to HttpFetcher", async () => {
    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
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
      status: FetchStatus.SUCCESS,
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
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      const testUrl = "https://example.com";
      options.url = testUrl;

      mockFetchFn.mockResolvedValue({
        content:
          "<html><head><title>HTML Test</title></head><body><h1>HTML Content</h1></body></html>",
        mimeType: "text/html",
        source: testUrl,
        status: FetchStatus.SUCCESS,
      });

      await strategy.scrape(options, progressCallback);

      // Verify HTML content was processed (converted to markdown)
      const docCall = progressCallback.mock.calls.find((call) => call[0].result);
      expect(docCall).toBeDefined();
      expect(docCall![0].result?.textContent).toContain("# HTML Content");
      expect(docCall![0].result?.title).toBe("HTML Test");
    });

    it("should process markdown content through MarkdownPipeline", async () => {
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      const testUrl = "https://example.com/readme.md";
      options.url = testUrl;

      const markdownContent = "# Markdown Title\n\nThis is already markdown content.";
      mockFetchFn.mockResolvedValue({
        content: markdownContent,
        mimeType: "text/markdown",
        source: testUrl,
        status: FetchStatus.SUCCESS,
      });

      await strategy.scrape(options, progressCallback);

      // Verify markdown content was processed
      const docCall = progressCallback.mock.calls.find((call) => call[0].result);
      expect(docCall).toBeDefined();
      expect(docCall![0].result?.textContent).toContain("# Markdown Title");
      expect(docCall![0].result?.textContent).toContain(
        "This is already markdown content.",
      );
    });

    it("should skip unsupported content types", async () => {
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      const testUrl = "https://example.com/image.png";
      options.url = testUrl;

      mockFetchFn.mockResolvedValue({
        content: Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG header
        mimeType: "image/png",
        source: testUrl,
        status: FetchStatus.SUCCESS,
      });

      await strategy.scrape(options, progressCallback);

      // Verify no document was produced for unsupported content
      const docCall = progressCallback.mock.calls.find((call) => call[0].result);
      expect(docCall).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("should handle fetch failures gracefully", async () => {
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      const testUrl = "https://example.com/error";
      options.url = testUrl;

      mockFetchFn.mockRejectedValue(new Error("Network error"));

      // Should throw the error (not swallow it)
      await expect(strategy.scrape(options, progressCallback)).rejects.toThrow(
        "Network error",
      );

      // Verify no documents were processed
      const docCalls = progressCallback.mock.calls.filter((call) => call[0].result);
      expect(docCalls).toHaveLength(0);
    });

    it("should handle empty content gracefully", async () => {
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      const testUrl = "https://example.com/empty";
      options.url = testUrl;

      mockFetchFn.mockResolvedValue({
        content: "<html><body></body></html>", // Empty content
        mimeType: "text/html",
        source: testUrl,
        status: FetchStatus.SUCCESS,
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

      const customStrategy = new WebScraperStrategy(appConfig, {
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
            status: FetchStatus.SUCCESS,
          };
        }
        return {
          content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
          mimeType: "text/html",
          source: url,
          status: FetchStatus.SUCCESS,
        };
      });

      options.maxDepth = 1;
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

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
      const receivedDocs = progressCallback.mock.calls.map((call) => call[0].result);
      expect(receivedDocs).toHaveLength(3); // Base + 2 allowed pages
    });

    it("should respect includePatterns and excludePatterns from base class", async () => {
      mockFetchFn.mockImplementation(async (url: string) => {
        if (url === "https://example.com/docs/") {
          return {
            content: `
              <html><head><title>Docs</title></head><body>
                <a href="/docs/guide">Guide</a>
                <a href="/docs/api">API</a>
                <a href="/docs/v2/">V2 Docs</a>
                <a href="/docs/v2/guide">V2 Guide</a>
                <a href="/api/endpoint">API Endpoint</a>
              </body></html>`,
            mimeType: "text/html",
            source: url,
            status: FetchStatus.SUCCESS,
          };
        }
        return {
          content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
          mimeType: "text/html",
          source: url,
          status: FetchStatus.SUCCESS,
        };
      });

      options.url = "https://example.com/docs/";
      options.includePatterns = ["docs/*"];
      options.excludePatterns = ["docs/v2/**"];
      options.maxDepth = 2;
      options.maxPages = 10;

      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      await strategy.scrape(options, progressCallback);

      // Verify base page was fetched
      expect(mockFetchFn).toHaveBeenCalledWith(
        "https://example.com/docs/",
        expect.anything(),
      );

      // Verify included pages were fetched
      expect(mockFetchFn).toHaveBeenCalledWith(
        "https://example.com/docs/guide",
        expect.anything(),
      );
      expect(mockFetchFn).toHaveBeenCalledWith(
        "https://example.com/docs/api",
        expect.anything(),
      );

      // Verify excluded pages were NOT fetched (v2 docs)
      expect(mockFetchFn).not.toHaveBeenCalledWith(
        "https://example.com/docs/v2/",
        expect.anything(),
      );
      expect(mockFetchFn).not.toHaveBeenCalledWith(
        "https://example.com/docs/v2/guide",
        expect.anything(),
      );

      // Verify page outside include pattern was NOT fetched
      expect(mockFetchFn).not.toHaveBeenCalledWith(
        "https://example.com/api/endpoint",
        expect.anything(),
      );

      // Verify documents were produced only for included and non-excluded pages
      const receivedDocs = progressCallback.mock.calls.map((call) => call[0].result);
      expect(receivedDocs).toHaveLength(3); // Base + guide + api
    });

    it("should apply excludePatterns even when no includePatterns are specified", async () => {
      mockFetchFn.mockImplementation(async (url: string) => {
        if (url === "https://example.com/") {
          return {
            content: `
              <html><head><title>Home</title></head><body>
                <a href="/docs/intro">Intro</a>
                <a href="/docs/private/secret">Secret</a>
                <a href="/blog/post">Blog</a>
              </body></html>`,
            mimeType: "text/html",
            source: url,
            status: FetchStatus.SUCCESS,
          };
        }
        return {
          content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
          mimeType: "text/html",
          source: url,
          status: FetchStatus.SUCCESS,
        };
      });

      options.url = "https://example.com/";
      options.excludePatterns = ["**/private/**"];
      options.maxDepth = 1;
      options.maxPages = 10;

      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      await strategy.scrape(options, progressCallback);

      // Verify base page was fetched
      expect(mockFetchFn).toHaveBeenCalledWith("https://example.com/", expect.anything());

      // Verify non-excluded pages were fetched
      expect(mockFetchFn).toHaveBeenCalledWith(
        "https://example.com/docs/intro",
        expect.anything(),
      );
      expect(mockFetchFn).toHaveBeenCalledWith(
        "https://example.com/blog/post",
        expect.anything(),
      );

      // Verify excluded page was NOT fetched
      expect(mockFetchFn).not.toHaveBeenCalledWith(
        "https://example.com/docs/private/secret",
        expect.anything(),
      );

      // Verify documents
      const receivedDocs = progressCallback.mock.calls.map((call) => call[0].result);
      expect(receivedDocs).toHaveLength(3); // Base + intro + blog
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
          status: FetchStatus.SUCCESS,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
        status: FetchStatus.SUCCESS,
      };
    });

    options.url = original;
    options.maxDepth = 1;
    options.maxPages = 5;

    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
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
          status: FetchStatus.SUCCESS,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
        status: FetchStatus.SUCCESS,
      };
    });

    options.url = start;
    options.scope = "subpages";
    options.maxDepth = 1;
    options.maxPages = 5;

    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
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
          status: FetchStatus.SUCCESS,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
        status: FetchStatus.SUCCESS,
      };
    });

    options.url = start;
    options.scope = "hostname";
    options.maxDepth = 1;
    options.maxPages = 10;

    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
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
          status: FetchStatus.SUCCESS,
        };
      }
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
        status: FetchStatus.SUCCESS,
      };
    });

    options.url = startDir;
    options.scope = "subpages";
    options.maxDepth = 1;
    options.maxPages = 5;

    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
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
          status: FetchStatus.SUCCESS,
        };
      }
      // Any unexpected fetches return generic content
      return {
        content: `<html><head><title>${url}</title></head><body>${url}</body></html>`,
        mimeType: "text/html",
        source: url,
        status: FetchStatus.SUCCESS,
      };
    });

    options.url = start;
    options.scope = "subpages";
    options.maxDepth = 1;
    options.maxPages = 5;

    const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
    await strategy.scrape(options, progressCallback);

    // Should fetch only the start page; the cross-origin (different hostname) base-derived link is filtered out
    expect(mockFetchFn).toHaveBeenCalledWith(start, expect.anything());
    expect(mockFetchFn).not.toHaveBeenCalledWith(resolved, expect.anything());
  });

  describe("cleanup", () => {
    it("should call close() on all pipelines when cleanup() is called", async () => {
      const strategy = new WebScraperStrategy(appConfig);

      // Spy on the close method of all pipelines
      // @ts-expect-error - pipelines is private, but we need to access it for testing
      strategy.pipelines.forEach((pipeline: any) => {
        vi.spyOn(pipeline, "close");
      });

      await strategy.cleanup();

      // Verify close was called on all pipelines
      // @ts-expect-error - pipelines is private, but we need to access it for testing
      strategy.pipelines.forEach((pipeline: any) => {
        expect(pipeline.close).toHaveBeenCalledOnce();
      });
    });

    it("should handle cleanup errors gracefully", async () => {
      const strategy = new WebScraperStrategy(appConfig);

      // Mock one pipeline to throw an error during cleanup
      // @ts-expect-error - pipelines is private, but we need to access it for testing
      vi.spyOn(strategy.pipelines[0], "close").mockRejectedValue(
        new Error("Pipeline cleanup failed"),
      );

      // cleanup() should still complete and not throw
      await expect(strategy.cleanup()).resolves.not.toThrow();
    });

    it("should be idempotent - multiple cleanup() calls should not error", async () => {
      const strategy = new WebScraperStrategy(appConfig);

      // Multiple calls should not throw
      await expect(strategy.cleanup()).resolves.not.toThrow();
      await expect(strategy.cleanup()).resolves.not.toThrow();
    });
  });

  describe("refresh workflow", () => {
    beforeEach(() => {
      vi.resetAllMocks();
      mockFetchFn.mockResolvedValue({
        content: "<html><body><h1>Default Mock Content</h1></body></html>",
        mimeType: "text/html",
        source: "https://example.com",
        status: FetchStatus.SUCCESS,
      });
      strategy = new WebScraperStrategy(appConfig);
      options = {
        url: "https://example.com",
        library: "test",
        version: "1.0",
        maxPages: 99,
        maxDepth: 3,
        scope: "subpages",
        followRedirects: true,
        scrapeMode: ScrapeMode.Fetch,
      };
    });

    it("should skip processing when page returns 304 Not Modified", async () => {
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      // Configure mock to return 304 for a refresh operation
      mockFetchFn.mockResolvedValue({
        content: "",
        mimeType: "text/html",
        source: "https://example.com/page1",
        status: FetchStatus.NOT_MODIFIED,
      });

      // Create a queue item with pageId and etag (refresh operation)
      options.initialQueue = [
        {
          url: "https://example.com/page1",
          depth: 0,
          pageId: 123,
          etag: "existing-etag",
        },
      ];

      await strategy.scrape(options, progressCallback);

      // Verify fetch was called with etag
      expect(mockFetchFn).toHaveBeenCalledWith(
        "https://example.com/page1",
        expect.objectContaining({
          etag: "existing-etag",
        }),
      );

      // Verify no documents were processed (304 means unchanged)
      const docCalls = progressCallback.mock.calls.filter((call) => call[0].result);
      expect(docCalls).toHaveLength(0);
    });

    it("should report deleted flag when page returns 404 Not Found during refresh", async () => {
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      // Configure mock to return 404
      mockFetchFn.mockResolvedValue({
        content: "",
        mimeType: "text/html",
        source: "https://example.com/deleted-page",
        status: FetchStatus.NOT_FOUND,
      });

      // Create a queue item with pageId and etag (refresh operation)
      options.initialQueue = [
        {
          url: "https://example.com/deleted-page",
          depth: 0,
          pageId: 456,
          etag: "old-etag",
        },
      ];

      await strategy.scrape(options, progressCallback);

      // Verify fetch was called
      expect(mockFetchFn).toHaveBeenCalledWith(
        "https://example.com/deleted-page",
        expect.objectContaining({
          etag: "old-etag",
        }),
      );

      // Verify no processed documents were returned
      const docCalls = progressCallback.mock.calls.filter((call) => call[0].result);
      expect(docCalls).toHaveLength(0);
    });

    it("should refresh page content when page returns 200 OK", async () => {
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      const rootContent =
        "<html><head><title>Root</title></head><body><h1>Root</h1></body></html>";
      const updatedContent =
        "<html><head><title>Updated</title></head><body><h1>New Content</h1></body></html>";

      // Configure mock to return different content for root vs updated page
      mockFetchFn.mockImplementation(async (url: string) => {
        if (url === "https://example.com") {
          return {
            content: rootContent,
            mimeType: "text/html",
            source: url,
            status: FetchStatus.SUCCESS,
          };
        }
        return {
          content: updatedContent,
          mimeType: "text/html",
          source: url,
          status: FetchStatus.SUCCESS,
          etag: "new-etag",
        };
      });

      // Create a queue item with pageId and etag (refresh operation)
      options.initialQueue = [
        {
          url: "https://example.com/updated-page",
          depth: 1,
          pageId: 789,
          etag: "old-etag",
        },
      ];

      await strategy.scrape(options, progressCallback);

      // Verify fetch was called for both root and updated page
      expect(mockFetchFn).toHaveBeenCalledWith("https://example.com", expect.anything());
      expect(mockFetchFn).toHaveBeenCalledWith(
        "https://example.com/updated-page",
        expect.objectContaining({
          etag: "old-etag",
        }),
      );

      // Verify both pages were processed (root at depth 0, updated page at depth 1)
      const docCalls = progressCallback.mock.calls.filter((call) => call[0].result);
      expect(docCalls).toHaveLength(2);

      // Find the updated page call
      const updatedPageCall = docCalls.find(
        (call) => call[0].currentUrl === "https://example.com/updated-page",
      );
      expect(updatedPageCall).toBeDefined();
      expect(updatedPageCall![0].result?.textContent).toContain("# New Content");
      expect(updatedPageCall![0].result?.title).toBe("Updated");
      expect(updatedPageCall![0].result?.etag).toBe("new-etag");
    });

    it("should discover and follow new links during refresh operations", async () => {
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();
      const rootContent =
        "<html><head><title>Root</title></head><body><h1>Root</h1></body></html>";
      const contentWithLinks = `
        <html>
          <head><title>Refreshed Page</title></head>
          <body>
            <h1>Content</h1>
            <a href="https://example.com/new-link">New Link</a>
            <a href="https://example.com/another-new-link">Another New Link</a>
          </body>
        </html>
      `;

      // Configure mock to return different content for root vs page
      mockFetchFn.mockImplementation(async (url: string) => {
        if (url === "https://example.com") {
          return {
            content: rootContent,
            mimeType: "text/html",
            source: url,
            status: FetchStatus.SUCCESS,
          };
        }
        return {
          content: contentWithLinks,
          mimeType: "text/html",
          source: url,
          status: FetchStatus.SUCCESS,
          etag: "new-etag",
        };
      });

      // Create a queue item with pageId and etag (refresh operation)
      options.initialQueue = [
        {
          url: "https://example.com/page-with-links",
          depth: 1,
          pageId: 999,
          etag: "old-etag",
        },
      ];

      await strategy.scrape(options, progressCallback);

      // Verify root, refresh page, and discovered links were all fetched
      // Root (depth 0) + refresh page (depth 1) + 2 new links (depth 2) = 4 total
      expect(mockFetchFn).toHaveBeenCalledTimes(4);
      expect(mockFetchFn).toHaveBeenCalledWith("https://example.com", expect.anything());
      expect(mockFetchFn).toHaveBeenCalledWith(
        "https://example.com/page-with-links",
        expect.anything(),
      );

      // Verify the new links discovered during refresh WERE followed (this is correct behavior)
      expect(mockFetchFn).toHaveBeenCalledWith(
        "https://example.com/new-link",
        expect.anything(),
      );
      expect(mockFetchFn).toHaveBeenCalledWith(
        "https://example.com/another-new-link",
        expect.anything(),
      );
    });

    it("should process multiple pages in a refresh operation with mixed statuses", async () => {
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      // Configure mock to return different statuses for different URLs
      mockFetchFn.mockImplementation(async (url: string) => {
        if (url === "https://example.com/unchanged") {
          return {
            content: "",
            mimeType: "text/html",
            source: url,
            status: FetchStatus.NOT_MODIFIED,
          };
        }
        if (url === "https://example.com/deleted") {
          return {
            content: "",
            mimeType: "text/html",
            source: url,
            status: FetchStatus.NOT_FOUND,
          };
        }
        if (url === "https://example.com/updated") {
          return {
            content:
              "<html><head><title>Updated</title></head><body><h1>New</h1></body></html>",
            mimeType: "text/html",
            source: url,
            status: FetchStatus.SUCCESS,
            etag: "new-etag",
          };
        }
        return {
          content: "<html><body>Default</body></html>",
          mimeType: "text/html",
          source: url,
          status: FetchStatus.SUCCESS,
        };
      });

      // Create a queue with multiple pages (all at depth > 0 to avoid root URL processing)
      options.initialQueue = [
        {
          url: "https://example.com/unchanged",
          depth: 1,
          pageId: 1,
          etag: "etag-1",
        },
        {
          url: "https://example.com/deleted",
          depth: 1,
          pageId: 2,
          etag: "etag-2",
        },
        {
          url: "https://example.com/updated",
          depth: 1,
          pageId: 3,
          etag: "etag-3",
        },
      ];

      await strategy.scrape(options, progressCallback);

      // Verify all three pages plus root were fetched (4 total)
      expect(mockFetchFn).toHaveBeenCalledTimes(4);

      // Verify root was processed + only the updated page produced a processed document (2 total)
      const docCalls = progressCallback.mock.calls.filter((call) => call[0].result);
      expect(docCalls).toHaveLength(2);

      // Find the updated page (not the root)
      const updatedPageCall = docCalls.find(
        (call) => call[0].currentUrl === "https://example.com/updated",
      );
      expect(updatedPageCall).toBeDefined();
      expect(updatedPageCall![0].result?.url).toBe("https://example.com/updated");
      expect(updatedPageCall![0].result?.title).toBe("Updated");
    });

    it("should preserve depth from original scrape during refresh", async () => {
      const progressCallback = vi.fn<ProgressCallback<ScraperProgressEvent>>();

      mockFetchFn.mockImplementation(async (url: string) => {
        if (url === "https://example.com") {
          return {
            content:
              "<html><head><title>Root</title></head><body><h1>Root</h1></body></html>",
            mimeType: "text/html",
            source: url,
            status: FetchStatus.SUCCESS,
          };
        }
        return {
          content:
            "<html><head><title>Depth Test</title></head><body><h1>Content</h1></body></html>",
          mimeType: "text/html",
          source: url,
          status: FetchStatus.SUCCESS,
          etag: "new-etag",
        };
      });

      // Create a queue item with depth from original scrape
      options.initialQueue = [
        {
          url: "https://example.com/deep-page",
          depth: 2, // This page was originally scraped at depth 2
          pageId: 555,
          etag: "old-etag",
        },
      ];

      await strategy.scrape(options, progressCallback);

      // Verify both root and deep page were processed (2 documents)
      const docCalls = progressCallback.mock.calls.filter((call) => call[0].result);
      expect(docCalls).toHaveLength(2);

      // Find the deep page and verify it preserved its depth
      const deepPageCall = docCalls.find(
        (call) => call[0].currentUrl === "https://example.com/deep-page",
      );
      expect(deepPageCall).toBeDefined();
      expect(deepPageCall![0].depth).toBe(2);
      expect(deepPageCall![0].pageId).toBe(555);
    });
  });
});
