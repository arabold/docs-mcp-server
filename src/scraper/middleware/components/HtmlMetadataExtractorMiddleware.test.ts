import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../../utils/logger";
import type { ScraperOptions } from "../../types";
import type { ContentProcessingContext } from "../types";
import { HtmlMetadataExtractorMiddleware } from "./HtmlMetadataExtractorMiddleware";

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

// Helper to create a basic context, optionally with a pre-populated DOM
const createMockContext = (
  contentType: string,
  htmlContent?: string, // Optional HTML to create a DOM from
  source = "http://example.com",
  options?: Partial<ScraperOptions>,
): ContentProcessingContext => {
  const context: ContentProcessingContext = {
    content: htmlContent || (contentType === "text/html" ? "" : "non-html"),
    contentType,
    source,
    metadata: {},
    links: [],
    errors: [],
    options: { ...createMockScraperOptions(source), ...options },
  };
  if (htmlContent && contentType.startsWith("text/html")) {
    context.dom = new JSDOM(htmlContent).window;
  }
  return context;
};

describe("HtmlMetadataExtractorMiddleware", () => {
  it("should extract title from title tag", async () => {
    const middleware = new HtmlMetadataExtractorMiddleware();
    const html =
      "<html><head><title>Head Title</title></head><body><h1>Test</h1><p>Empty h1</p></body></html>";
    const context = createMockContext("text/html", html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.metadata.title).toBe("Head Title");
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
  });

  it("should default to 'Untitled' if title is missing", async () => {
    const middleware = new HtmlMetadataExtractorMiddleware();
    const html = "<html><body><p>No title elements</p></body></html>";
    const context = createMockContext("text/html", html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.metadata.title).toBe("Untitled");
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
  });

  it("should default to 'Untitled' if both h1 and title are empty", async () => {
    const middleware = new HtmlMetadataExtractorMiddleware();
    const html = "<html><head><title>  </title></head><body><h1> </h1></body></html>";
    const context = createMockContext("text/html", html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.metadata.title).toBe("Untitled");
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
  });

  it("should clean up whitespace in the title", async () => {
    const middleware = new HtmlMetadataExtractorMiddleware();
    const html =
      "<html><body><title>  Extra \n Whitespace \t Title  </title></body></html>";
    const context = createMockContext("text/html", html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.metadata.title).toBe("Extra Whitespace Title");
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
  });

  it("should skip processing and warn if context.dom is missing for HTML content", async () => {
    const middleware = new HtmlMetadataExtractorMiddleware();
    const context = createMockContext("text/html"); // No HTML content provided, so dom is undefined
    const next = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(logger, "warn");

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.metadata.title).toBeUndefined(); // Title should not be set
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("context.dom is missing"),
    );
    expect(context.errors).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it("should skip processing if content type is not HTML", async () => {
    const middleware = new HtmlMetadataExtractorMiddleware();
    const context = createMockContext("text/plain");
    const next = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(logger, "warn");

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.metadata.title).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled(); // Should not warn if not HTML
    expect(context.errors).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it("should handle errors during DOM query", async () => {
    const middleware = new HtmlMetadataExtractorMiddleware();
    const html = "<html><body><h1>Title</h1></body></html>";
    const context = createMockContext("text/html", html);
    const next = vi.fn().mockResolvedValue(undefined);
    const errorMsg = "Query failed";

    // Mock querySelector to throw an error
    const originalQuerySelector = context.dom?.document.querySelector;
    if (context.dom) {
      context.dom.document.querySelector = vi.fn().mockImplementation(() => {
        throw new Error(errorMsg);
      });
    }

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce(); // Should still call next
    expect(context.metadata.title).toBeUndefined();
    expect(context.errors).toHaveLength(1);
    expect(context.errors[0].message).toContain(errorMsg);

    // Restore if mocked
    if (context.dom && originalQuerySelector) {
      context.dom.document.querySelector = originalQuerySelector;
    }
    context.dom?.close();
  });
});
