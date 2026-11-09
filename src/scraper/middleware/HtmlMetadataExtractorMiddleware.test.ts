import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import type { ScraperOptions } from "../types";
import { HtmlMetadataExtractorMiddleware } from "./HtmlMetadataExtractorMiddleware";
import type { MiddlewareContext } from "./types";

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
  it("should take the title tag text with collapsed whitespace, or 'Untitled'", async () => {
    const cases: Array<[label: string, html: string, title: string]> = [
      [
        "title tag",
        "<html><head><title>Head Title</title></head><body><h1>Test</h1><p>Empty h1</p></body></html>",
        "Head Title",
      ],
      ["missing title", "<html><body><p>No title elements</p></body></html>", "Untitled"],
      [
        "empty title and h1",
        "<html><head><title>  </title></head><body><h1> </h1></body></html>",
        "Untitled",
      ],
      [
        "whitespace in the title",
        "<html><body><title>  Extra \n Whitespace \t Title  </title></body></html>",
        "Extra Whitespace Title",
      ],
    ];

    for (const [label, html, title] of cases) {
      const middleware = new HtmlMetadataExtractorMiddleware();
      const context = createMockContext(html);
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware.process(context, next);

      expect.soft(context.title, label).toBe(title);
      expect.soft(context.errors, label).toHaveLength(0);
      expect.soft(next, label).toHaveBeenCalledOnce();
    }
  });

  it("should skip processing if context.dom is missing for HTML content", async () => {
    const middleware = new HtmlMetadataExtractorMiddleware();
    const context = createMockContext(); // No HTML content provided, so dom is undefined
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.title).toBeUndefined(); // Title should not be set
    expect(context.errors).toHaveLength(0);
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
