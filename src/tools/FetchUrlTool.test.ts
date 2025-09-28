import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoDetectFetcher } from "../scraper/fetcher";
import { ScrapeMode } from "../scraper/types";
import { ScraperError } from "../utils/errors";
import { ToolError, ValidationError } from "./errors";
import { FetchUrlTool, type FetchUrlToolOptions } from "./FetchUrlTool";

// Mock dependencies
vi.mock("../utils/logger");

describe("FetchUrlTool", () => {
  let mockAutoDetectFetcher: Partial<AutoDetectFetcher>;
  let fetchUrlTool: FetchUrlTool;

  beforeEach(() => {
    vi.resetAllMocks();

    // Setup mock AutoDetectFetcher with minimal implementation
    mockAutoDetectFetcher = {
      canFetch: vi.fn(),
      fetch: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    // Create instance of the tool with mock dependencies
    fetchUrlTool = new FetchUrlTool(mockAutoDetectFetcher as AutoDetectFetcher);
  });

  it("should convert HTML to markdown", async () => {
    const url = "https://example.com/docs";
    const options: FetchUrlToolOptions = {
      url,
      scrapeMode: ScrapeMode.Fetch, // Use fetch mode to avoid Playwright browser operations
    };
    const htmlContent = "<h1>Hello World</h1><p>This is a test</p>";

    // Set up mocks for the test case
    mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockAutoDetectFetcher.fetch = vi.fn().mockResolvedValue({
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

    mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockAutoDetectFetcher.fetch = vi.fn().mockResolvedValue({
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

    mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockAutoDetectFetcher.fetch = vi.fn().mockResolvedValue({
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

    mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockAutoDetectFetcher.fetch = vi.fn().mockResolvedValue({
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

  it("should throw ValidationError for invalid URLs", async () => {
    const invalidUrl = "invalid://example.com";
    const options: FetchUrlToolOptions = { url: invalidUrl };

    mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(false);

    // Test behavior: invalid URLs should throw appropriate error
    await expect(fetchUrlTool.execute(options)).rejects.toThrow(ValidationError);
    await expect(fetchUrlTool.execute(options)).rejects.toThrow("Invalid URL");
  });

  it("should handle fetch errors", async () => {
    const url = "https://example.com/error";
    const options: FetchUrlToolOptions = { url };

    mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockAutoDetectFetcher.fetch = vi
      .fn()
      .mockRejectedValue(new ScraperError("Network error"));

    // Test behavior: fetch failures should result in ToolError
    await expect(fetchUrlTool.execute(options)).rejects.toThrow(ToolError);
    await expect(fetchUrlTool.execute(options)).rejects.toThrow(
      "Unable to fetch or process the URL",
    );
  });

  it("should provide user-friendly error messages for malformed URLs that pass initial validation", async () => {
    const url = "https://invalid-domain-that-does-not-exist.com";
    const options: FetchUrlToolOptions = { url };

    mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockAutoDetectFetcher.fetch = vi
      .fn()
      .mockRejectedValue(
        new Error("getaddrinfo ENOTFOUND invalid-domain-that-does-not-exist.com"),
      );

    // Test behavior: URL resolution failures should result in user-friendly ToolError
    await expect(fetchUrlTool.execute(options)).rejects.toThrow(ToolError);
    await expect(fetchUrlTool.execute(options)).rejects.toThrow(
      "Unable to fetch or process the URL",
    );
    await expect(fetchUrlTool.execute(options)).rejects.toThrow(
      "Please verify the URL is correct and accessible",
    );
  });

  it("should return raw content for unsupported content types", async () => {
    const url = "https://example.com/image.png";
    const options: FetchUrlToolOptions = { url };
    const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header

    mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockAutoDetectFetcher.fetch = vi.fn().mockResolvedValue({
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
    it("should use AutoDetectFetcher for HTTP URLs", async () => {
      const url = "https://example.com/docs";
      const options: FetchUrlToolOptions = { url, scrapeMode: ScrapeMode.Fetch };

      mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockAutoDetectFetcher.fetch = vi.fn().mockResolvedValue({
        content: "<h1>Test</h1>",
        mimeType: "text/html",
        source: url,
      });

      await fetchUrlTool.execute(options);

      // Verify fetcher selection: HTTP URLs should use AutoDetectFetcher
      expect(mockAutoDetectFetcher.canFetch).toHaveBeenCalledWith(url);
      expect(mockAutoDetectFetcher.fetch).toHaveBeenCalledWith(url, {
        followRedirects: true,
        maxRetries: 3,
        headers: undefined,
      });
    });

    it("should use AutoDetectFetcher for file URLs", async () => {
      const url = "file:///path/to/file.html";
      const options: FetchUrlToolOptions = { url, scrapeMode: ScrapeMode.Fetch };

      mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockAutoDetectFetcher.fetch = vi.fn().mockResolvedValue({
        content: "<h1>Local File</h1>",
        mimeType: "text/html",
        source: url,
      });

      await fetchUrlTool.execute(options);

      // Verify fetcher selection: file URLs should use AutoDetectFetcher
      expect(mockAutoDetectFetcher.canFetch).toHaveBeenCalledWith(url);
      expect(mockAutoDetectFetcher.fetch).toHaveBeenCalledWith(url, {
        followRedirects: true,
        maxRetries: 3,
        headers: undefined,
      });
    });

    it("should handle all URL types with AutoDetectFetcher", async () => {
      const url = "https://example.com/docs";
      const options: FetchUrlToolOptions = { url, scrapeMode: ScrapeMode.Fetch };

      mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockAutoDetectFetcher.fetch = vi.fn().mockResolvedValue({
        content: "<h1>HTTP Content</h1>",
        mimeType: "text/html",
        source: url,
      });

      await fetchUrlTool.execute(options);

      // Verify AutoDetectFetcher is used
      expect(mockAutoDetectFetcher.fetch).toHaveBeenCalledWith(url, {
        followRedirects: true,
        maxRetries: 3,
        headers: undefined,
      });
    });

    it("should pass custom headers to the AutoDetectFetcher", async () => {
      const url = "https://example.com/docs";
      const customHeaders = { Authorization: "Bearer token123", "User-Agent": "MyAgent" };
      const options: FetchUrlToolOptions = {
        url,
        scrapeMode: ScrapeMode.Fetch,
        headers: customHeaders,
      };

      mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockAutoDetectFetcher.fetch = vi.fn().mockResolvedValue({
        content: "<h1>Authenticated Content</h1>",
        mimeType: "text/html",
        source: url,
      });

      await fetchUrlTool.execute(options);

      // Verify headers are passed to fetcher
      expect(mockAutoDetectFetcher.fetch).toHaveBeenCalledWith(url, {
        followRedirects: true,
        maxRetries: 3,
        headers: customHeaders,
      });
    });
  });

  describe("cleanup", () => {
    it("should call close() on fetcher and pipelines in finally block on success", async () => {
      const url = "https://example.com";
      const options: FetchUrlToolOptions = { url, scrapeMode: ScrapeMode.Fetch };

      // Set up successful mock responses
      mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockAutoDetectFetcher.fetch = vi.fn().mockResolvedValue({
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

      // Verify close was called on all pipelines and fetcher
      expect(closeSpy1).toHaveBeenCalledOnce();
      expect(closeSpy2).toHaveBeenCalledOnce();
      expect(mockAutoDetectFetcher.close).toHaveBeenCalledOnce();
    });

    it("should call close() on fetcher and pipelines even when processing throws error", async () => {
      const url = "https://example.com";
      const options: FetchUrlToolOptions = { url, scrapeMode: ScrapeMode.Fetch };

      // Set up mock to throw error during processing
      mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockAutoDetectFetcher.fetch = vi
        .fn()
        .mockRejectedValue(new ScraperError("Fetch failed", true));

      // Spy on pipeline close methods
      // @ts-expect-error Accessing private property for testing
      const closeSpy1 = vi.spyOn(fetchUrlTool.pipelines[0], "close");
      // @ts-expect-error Accessing private property for testing
      const closeSpy2 = vi.spyOn(fetchUrlTool.pipelines[1], "close");

      // Expect error to be thrown
      await expect(fetchUrlTool.execute(options)).rejects.toThrow(ToolError);

      // Verify close was still called on all pipelines and fetcher despite the error
      expect(closeSpy1).toHaveBeenCalledOnce();
      expect(closeSpy2).toHaveBeenCalledOnce();
      expect(mockAutoDetectFetcher.close).toHaveBeenCalledOnce();
    });

    it("should handle pipeline cleanup errors gracefully", async () => {
      const url = "https://example.com";
      const options: FetchUrlToolOptions = { url, scrapeMode: ScrapeMode.Fetch };

      // Set up successful mock responses
      mockAutoDetectFetcher.canFetch = vi.fn().mockReturnValue(true);
      mockAutoDetectFetcher.fetch = vi.fn().mockResolvedValue({
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
