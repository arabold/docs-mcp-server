import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileFetcher, HttpFetcher } from "../scraper/fetcher";
import { JsonPipeline } from "../scraper/pipelines/JsonPipeline";
import { ScraperError } from "../utils/errors";
import { logger } from "../utils/logger";
import { FetchUrlTool, type FetchUrlToolOptions } from "./FetchUrlTool";
import { ToolError } from "./errors";

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
    const options: FetchUrlToolOptions = { url };
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

    // Verify correct fetcher was selected
    expect(mockHttpFetcher.canFetch).toHaveBeenCalledWith(url);
    expect(mockFileFetcher.canFetch).toHaveBeenCalledWith(url);
    expect(mockHttpFetcher.fetch).toHaveBeenCalledWith(url, {
      followRedirects: true,
      maxRetries: 3,
    });

    // Verify the result contains expected markdown content
    expect(result).toContain("# Hello World");
    expect(result).toContain("This is a test");
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Successfully processed"),
    );
  }, 10000);

  it("should handle file URLs", async () => {
    const url = "file:///path/to/document.html";
    const options: FetchUrlToolOptions = { url };
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

    // Verify correct fetcher was selected
    expect(mockHttpFetcher.canFetch).toHaveBeenCalledWith(url);
    expect(mockFileFetcher.canFetch).toHaveBeenCalledWith(url);
    expect(mockFileFetcher.fetch).toHaveBeenCalledWith(url, expect.any(Object));

    // Verify the result contains expected markdown content
    expect(result).toContain("## Local File Content");
    expect(result).toContain("-   Item 1");
    expect(result).toContain("-   Item 2");
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

    expect(mockHttpFetcher.fetch).toHaveBeenCalledWith(url, expect.any(Object));
    expect(result).toBe(markdownContent);
  });

  it("should respect followRedirects option", async () => {
    const url = "https://example.com/docs";
    const options: FetchUrlToolOptions = { url, followRedirects: false };

    mockHttpFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockHttpFetcher.fetch = vi.fn().mockResolvedValue({
      content: "<h1>No Redirects</h1>",
      mimeType: "text/html",
      source: url,
    });

    await fetchUrlTool.execute(options);

    expect(mockHttpFetcher.fetch).toHaveBeenCalledWith(url, {
      followRedirects: false,
      maxRetries: 3,
    });
  });

  it("should throw ToolError for invalid URLs", async () => {
    const invalidUrl = "invalid://example.com";
    const options: FetchUrlToolOptions = { url: invalidUrl };

    mockHttpFetcher.canFetch = vi.fn().mockReturnValue(false);
    mockFileFetcher.canFetch = vi.fn().mockReturnValue(false);

    await expect(fetchUrlTool.execute(options)).rejects.toThrow(ToolError);
    expect(mockHttpFetcher.canFetch).toHaveBeenCalledWith(invalidUrl);
    expect(mockFileFetcher.canFetch).toHaveBeenCalledWith(invalidUrl);
    expect(mockHttpFetcher.fetch).not.toHaveBeenCalled();
    expect(mockFileFetcher.fetch).not.toHaveBeenCalled();
  });

  it("should handle fetch errors", async () => {
    const url = "https://example.com/error";
    const options: FetchUrlToolOptions = { url };

    mockHttpFetcher.canFetch = vi.fn().mockReturnValue(true);
    mockHttpFetcher.fetch = vi.fn().mockRejectedValue(new ScraperError("Network error"));

    await expect(fetchUrlTool.execute(options)).rejects.toThrow(ToolError);
    expect(mockHttpFetcher.fetch).toHaveBeenCalled();
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

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Unsupported content type"),
    );
    expect(result).toBe(imageBuffer.toString("utf-8"));
  });

  it("should process .json files using the JsonPipeline", async () => {
    mockHttpFetcher.canFetch = vi.fn().mockReturnValue(true); // Ensure fetcher is selected
    mockHttpFetcher.fetch = vi.fn().mockResolvedValue({
      content: JSON.stringify({ x: [10, 20], y: { z: "ok" } }),
      mimeType: "application/json",
      source: "https://example.com/data.json",
    });
    const tool = new FetchUrlTool(
      mockHttpFetcher as HttpFetcher,
      mockFileFetcher as FileFetcher,
    );
    const result = await tool.execute({ url: "https://example.com/data.json" });
    const parsed = JSON.parse(result);
    expect(parsed.x).toEqual([10, 20]);
    expect(parsed.y).toEqual({ z: "ok" });
  });
});
