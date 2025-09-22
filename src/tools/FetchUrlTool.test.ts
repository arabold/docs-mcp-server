import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileFetcher, HttpFetcher } from "../scraper/fetcher";
import { ScrapeMode } from "../scraper/types";
import { ScraperError } from "../utils/errors";
import { ToolError } from "./errors";
import { FetchUrlTool, type FetchUrlToolOptions } from "./FetchUrlTool";

// Mock dependencies
vi.mock("../utils/logger");

describe("FetchUrlTool", () => {
  let mockHttpFetcher: Partial<HttpFetcher>;
  let mockFileFetcher: Partial<FileFetcher>;
  let fetchUrlTool: FetchUrlTool;

  beforeEach(() => {
    vi.resetAllMocks();

    // Setup mock fetchers with minimal implementation
    mockHttpFetcher = {
      canFetch: vi.fn(),
      fetch: vi.fn(),
    };

    mockFileFetcher = {
      canFetch: vi.fn(),
      fetch: vi.fn(),
    };

    // Create instance of the tool with mock dependencies
    fetchUrlTool = new FetchUrlTool(
      mockHttpFetcher as HttpFetcher,
      mockFileFetcher as FileFetcher,
    );
  });

  it("should convert HTML to markdown", async () => {
    const url = "https://example.com/docs";
    const options: FetchUrlToolOptions = {
      url,
      scrapeMode: ScrapeMode.Fetch, // Use fetch mode to avoid Playwright browser operations
    };
    const htmlContent = "<h1>Hello World</h1><p>This is a test</p>";

    // Set up mocks for the test case
    mockHttpFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockFileFetcher.canFetch = vi.fn().mockReturnValue(false);
    mockHttpFetcher.fetch = vi.fn().mockResolvedValue({
      content: htmlContent,
      mimeType: "text/html",
      source: url,
    });

    const result = await fetchUrlTool.execute(options);

    // Test the behavior: HTML input should produce markdown output
    expect(result).toContain("# Hello World");
    expect(result).toContain("This is a test");
    // Verify the tool succeeds (no errors thrown)
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  }, 10000);

  it("should handle file URLs", async () => {
    const url = "file:///path/to/document.html";
    const options: FetchUrlToolOptions = {
      url,
      scrapeMode: ScrapeMode.Fetch, // Use fetch mode to avoid Playwright browser operations
    };
    const htmlContent =
      "<h2>Local File Content</h2><ul><li>Item 1</li><li>Item 2</li></ul>";

    mockHttpFetcher.canFetch = vi.fn().mockReturnValue(false);
    mockFileFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockFileFetcher.fetch = vi.fn().mockResolvedValue({
      content: htmlContent,
      mimeType: "text/html",
      source: url,
    });

    const result = await fetchUrlTool.execute(options);

    // Test the behavior: file URL should be processed and return markdown
    expect(result).toContain("## Local File Content");
    expect(result).toContain("-   Item 1");
    expect(result).toContain("-   Item 2");
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  }, 10000);

  it("should process markdown content directly", async () => {
    const url = "https://example.com/readme.md";
    const options: FetchUrlToolOptions = { url };
    const markdownContent = "# Already Markdown\n\nNo conversion needed.";

    mockHttpFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockHttpFetcher.fetch = vi.fn().mockResolvedValue({
      content: markdownContent,
      mimeType: "text/markdown",
      source: url,
    });

    const result = await fetchUrlTool.execute(options);

    // Test behavior: markdown should pass through unchanged
    expect(result).toBe(markdownContent);
  });

  it("should respect followRedirects option", async () => {
    const url = "https://example.com/docs";
    const options: FetchUrlToolOptions = {
      url,
      followRedirects: false,
      scrapeMode: ScrapeMode.Fetch, // Use fetch mode to avoid Playwright browser operations
    };

    mockHttpFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockHttpFetcher.fetch = vi.fn().mockResolvedValue({
      content: "<h1>No Redirects</h1>",
      mimeType: "text/html",
      source: url,
    });

    const result = await fetchUrlTool.execute(options);

    // Test behavior: should successfully process content regardless of redirect settings
    expect(result).toContain("# No Redirects");
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  });

  it("should throw ToolError for invalid URLs", async () => {
    const invalidUrl = "invalid://example.com";
    const options: FetchUrlToolOptions = { url: invalidUrl };

    mockHttpFetcher.canFetch = vi.fn().mockReturnValue(false);
    mockFileFetcher.canFetch = vi.fn().mockReturnValue(false);

    // Test behavior: invalid URLs should throw appropriate error
    await expect(fetchUrlTool.execute(options)).rejects.toThrow(ToolError);
    await expect(fetchUrlTool.execute(options)).rejects.toThrow("Invalid URL");
  });

  it("should handle fetch errors", async () => {
    const url = "https://example.com/error";
    const options: FetchUrlToolOptions = { url };

    mockHttpFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockHttpFetcher.fetch = vi.fn().mockRejectedValue(new ScraperError("Network error"));

    // Test behavior: fetch failures should result in ToolError
    await expect(fetchUrlTool.execute(options)).rejects.toThrow(ToolError);
    await expect(fetchUrlTool.execute(options)).rejects.toThrow(
      "Failed to fetch or process URL",
    );
  });

  it("should return raw content for unsupported content types", async () => {
    const url = "https://example.com/image.png";
    const options: FetchUrlToolOptions = { url };
    const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header

    mockHttpFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockHttpFetcher.fetch = vi.fn().mockResolvedValue({
      content: imageBuffer,
      mimeType: "image/png",
      source: url,
    });

    const result = await fetchUrlTool.execute(options);

    // Test behavior: unsupported content should be returned as-is (converted to string)
    expect(result).toBe(imageBuffer.toString("utf-8"));
    expect(typeof result).toBe("string");
  });

  describe("fetcher selection", () => {
    it("should select HttpFetcher for HTTP URLs", async () => {
      const url = "https://example.com/docs";
      const options: FetchUrlToolOptions = { url, scrapeMode: ScrapeMode.Fetch };

      mockHttpFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockFileFetcher.canFetch = vi.fn().mockReturnValue(false);
      mockHttpFetcher.fetch = vi.fn().mockResolvedValue({
        content: "<h1>Test</h1>",
        mimeType: "text/html",
        source: url,
      });

      await fetchUrlTool.execute(options);

      // Verify fetcher selection: HTTP URLs should use HttpFetcher
      expect(mockHttpFetcher.canFetch).toHaveBeenCalledWith(url);
      expect(mockFileFetcher.canFetch).toHaveBeenCalledWith(url);
      expect(mockHttpFetcher.fetch).toHaveBeenCalledWith(url, {
        followRedirects: true,
        maxRetries: 3,
        headers: undefined,
      });
      expect(mockFileFetcher.fetch).not.toHaveBeenCalled();
    });

    it("should select FileFetcher for file URLs", async () => {
      const url = "file:///path/to/file.html";
      const options: FetchUrlToolOptions = { url, scrapeMode: ScrapeMode.Fetch };

      mockHttpFetcher.canFetch = vi.fn().mockReturnValue(false);
      mockFileFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockFileFetcher.fetch = vi.fn().mockResolvedValue({
        content: "<h1>Local File</h1>",
        mimeType: "text/html",
        source: url,
      });

      await fetchUrlTool.execute(options);

      // Verify fetcher selection: file URLs should use FileFetcher
      expect(mockHttpFetcher.canFetch).toHaveBeenCalledWith(url);
      expect(mockFileFetcher.canFetch).toHaveBeenCalledWith(url);
      expect(mockFileFetcher.fetch).toHaveBeenCalledWith(url, {
        followRedirects: true,
        maxRetries: 3,
        headers: undefined,
      });
      expect(mockHttpFetcher.fetch).not.toHaveBeenCalled();
    });

    it("should prefer HttpFetcher when both fetchers can handle the URL", async () => {
      const url = "https://example.com/docs";
      const options: FetchUrlToolOptions = { url, scrapeMode: ScrapeMode.Fetch };

      // Both fetchers claim they can handle the URL
      mockHttpFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockFileFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockHttpFetcher.fetch = vi.fn().mockResolvedValue({
        content: "<h1>HTTP Content</h1>",
        mimeType: "text/html",
        source: url,
      });

      await fetchUrlTool.execute(options);

      // Verify fetcher priority: HttpFetcher should be selected first (array order)
      expect(mockHttpFetcher.fetch).toHaveBeenCalledWith(url, {
        followRedirects: true,
        maxRetries: 3,
        headers: undefined,
      });
      expect(mockFileFetcher.fetch).not.toHaveBeenCalled();
    });

    it("should pass custom headers to the selected fetcher", async () => {
      const url = "https://example.com/docs";
      const customHeaders = { Authorization: "Bearer token123", "User-Agent": "MyAgent" };
      const options: FetchUrlToolOptions = {
        url,
        scrapeMode: ScrapeMode.Fetch,
        headers: customHeaders,
      };

      mockHttpFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockFileFetcher.canFetch = vi.fn().mockReturnValue(false);
      mockHttpFetcher.fetch = vi.fn().mockResolvedValue({
        content: "<h1>Authenticated Content</h1>",
        mimeType: "text/html",
        source: url,
      });

      await fetchUrlTool.execute(options);

      // Verify headers are passed to fetcher
      expect(mockHttpFetcher.fetch).toHaveBeenCalledWith(url, {
        followRedirects: true,
        maxRetries: 3,
        headers: customHeaders,
      });
    });
  });

  describe("cleanup", () => {
    it("should call close() on all pipelines in finally block on success", async () => {
      const url = "https://example.com";
      const options: FetchUrlToolOptions = { url, scrapeMode: ScrapeMode.Fetch };

      // Set up successful mock responses
      mockHttpFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockFileFetcher.canFetch = vi.fn().mockReturnValue(false);
      mockHttpFetcher.fetch = vi.fn().mockResolvedValue({
        content: "<h1>Test</h1>",
        mimeType: "text/html",
        source: url,
      });

      // Spy on pipeline close methods
      // @ts-expect-error Accessing private property for testing
      const closeSpy1 = vi.spyOn(fetchUrlTool.pipelines[0], "close");
      // @ts-expect-error Accessing private property for testing
      const closeSpy2 = vi.spyOn(fetchUrlTool.pipelines[1], "close");

      await fetchUrlTool.execute(options);

      // Verify close was called on all pipelines
      expect(closeSpy1).toHaveBeenCalledOnce();
      expect(closeSpy2).toHaveBeenCalledOnce();
    });

    it("should call close() on all pipelines even when processing throws error", async () => {
      const url = "https://example.com";
      const options: FetchUrlToolOptions = { url, scrapeMode: ScrapeMode.Fetch };

      // Set up mock to throw error during processing
      mockHttpFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockFileFetcher.canFetch = vi.fn().mockReturnValue(false);
      mockHttpFetcher.fetch = vi
        .fn()
        .mockRejectedValue(new ScraperError("Fetch failed", true));

      // Spy on pipeline close methods
      // @ts-expect-error Accessing private property for testing
      const closeSpy1 = vi.spyOn(fetchUrlTool.pipelines[0], "close");
      // @ts-expect-error Accessing private property for testing
      const closeSpy2 = vi.spyOn(fetchUrlTool.pipelines[1], "close");

      // Expect error to be thrown
      await expect(fetchUrlTool.execute(options)).rejects.toThrow(ToolError);

      // Verify close was still called on all pipelines despite the error
      expect(closeSpy1).toHaveBeenCalledOnce();
      expect(closeSpy2).toHaveBeenCalledOnce();
    });

    it("should handle pipeline cleanup errors gracefully", async () => {
      const url = "https://example.com";
      const options: FetchUrlToolOptions = { url, scrapeMode: ScrapeMode.Fetch };

      // Set up successful mock responses
      mockHttpFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockFileFetcher.canFetch = vi.fn().mockReturnValue(false);
      mockHttpFetcher.fetch = vi.fn().mockResolvedValue({
        content: "<h1>Test</h1>",
        mimeType: "text/html",
        source: url,
      });

      // Mock one pipeline to throw error during cleanup
      // @ts-expect-error Accessing private property for testing
      vi.spyOn(fetchUrlTool.pipelines[0], "close").mockRejectedValue(
        new Error("Pipeline cleanup failed"),
      );

      // Should still complete successfully (cleanup errors are handled by Promise.allSettled)
      const result = await fetchUrlTool.execute(options);
      expect(result).toBeTruthy();
    });
  });
});
