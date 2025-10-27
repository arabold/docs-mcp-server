import * as cheerio from "cheerio"; // Import cheerio
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../utils/logger";
import type { ScraperOptions } from "../types";
import { HtmlMetadataExtractorMiddleware } from "./HtmlMetadataExtractorMiddleware";
import type { MiddlewareContext } from "./types";

// Suppress logger output during tests
vi.mock("../../../utils/logger");

// Helper to create a minimal valid ScraperOptions object
const createMockScraperOptions = (url = "http://example.com"): ScraperOptions => ({
  url,
  library: "test-lib",
  version: "1.0.0",
  maxDepth: 0,
  maxPages: 1,
  maxConcurrency: 1,
  scope: "subpages",
  followRedirects: true,
  excludeSelectors: [],
  ignoreErrors: false,
});

const createMockContext = (
  htmlContent?: string,
  source = "http://example.com",
  options?: Partial<ScraperOptions>,
): MiddlewareContext => {
  const context: MiddlewareContext = {
    content: htmlContent || "",
    contentType: "text/html",
    source,
    links: [],
    errors: [],
    options: { ...createMockScraperOptions(source), ...options },
  };
  if (htmlContent) {
    context.dom = cheerio.load(htmlContent);
  }
  return context;
};

describe("HtmlMetadataExtractorMiddleware", () => {
  it("should extract title from title tag", async () => {
    const middleware = new HtmlMetadataExtractorMiddleware();
    const html =
      "<html><head><title>Head Title</title></head><body><h1>Test</h1><p>Empty h1</p></body></html>";
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.title).toBe("Head Title");
    expect(context.errors).toHaveLength(0);

    // No need to close Cheerio object
  });

  it("should default to 'Untitled' if title is missing", async () => {
    const middleware = new HtmlMetadataExtractorMiddleware();
    const html = "<html><body><p>No title elements</p></body></html>";
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.title).toBe("Untitled");
    expect(context.errors).toHaveLength(0);

    // No need to close Cheerio object
  });

  it("should default to 'Untitled' if both h1 and title are empty", async () => {
    const middleware = new HtmlMetadataExtractorMiddleware();
    const html = "<html><head><title>  </title></head><body><h1> </h1></body></html>";
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.title).toBe("Untitled");
    expect(context.errors).toHaveLength(0);

    // No need to close Cheerio object
  });

  it("should clean up whitespace in the title", async () => {
    const middleware = new HtmlMetadataExtractorMiddleware();
    const html =
      "<html><body><title>  Extra \n Whitespace \t Title  </title></body></html>";
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.title).toBe("Extra Whitespace Title");
    expect(context.errors).toHaveLength(0);

    // No need to close Cheerio object
  });

  it("should skip processing and warn if context.dom is missing for HTML content", async () => {
    const middleware = new HtmlMetadataExtractorMiddleware();
    const context = createMockContext(); // No HTML content provided, so dom is undefined
    const next = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(logger, "warn");

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.title).toBeUndefined(); // Title should not be set
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("context.dom is missing"),
    );
    expect(context.errors).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it("should handle errors during DOM query", async () => {
    const middleware = new HtmlMetadataExtractorMiddleware();
    const html = "<html><body><h1>Title</h1></body></html>";
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);
    const errorMsg = "Query failed";
    const mockError = new Error(errorMsg);

    // Mock the Cheerio object to throw an error when selecting 'title' or 'h1'
    const mockDom = vi.fn(() => {
      throw mockError;
    }) as unknown as cheerio.CheerioAPI; // Cast to satisfy type
    context.dom = mockDom;

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce(); // Should still call next
    expect(context.title).toBeUndefined();
    expect(context.errors).toHaveLength(1);
    // Check if the error message includes the original error's message
    expect(context.errors[0].message).toContain("Failed to extract metadata from HTML");
    expect(context.errors[0].message).toContain(errorMsg);

    // No need for cleanup or restore with this mock approach
  });
});
