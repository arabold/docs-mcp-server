import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../../utils/logger";
import type { ScraperOptions } from "../../types";
import type { ContentProcessingContext } from "../types";
import { HtmlLinkExtractorMiddleware } from "./HtmlLinkExtractorMiddleware";

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
  source = "http://example.com/path/page.html", // Default source with path
  options?: Partial<ScraperOptions>,
): ContentProcessingContext => {
  const context: ContentProcessingContext = {
    content: htmlContent || (contentType === "text/html" ? "" : "non-html"),
    contentType,
    source,
    metadata: {},
    links: [], // Initialize links array
    errors: [],
    options: { ...createMockScraperOptions(source), ...options },
  };
  if (htmlContent && contentType.startsWith("text/html")) {
    // Pass the source URL to JSDOM for correct relative URL resolution
    context.dom = new JSDOM(htmlContent, { url: source }).window;
  }
  return context;
};

describe("HtmlLinkExtractorMiddleware", () => {
  it("should extract absolute, relative, and root-relative links", async () => {
    const middleware = new HtmlLinkExtractorMiddleware();
    const html = `
      <html><body>
        <a href="http://external.com/page">Absolute</a>
        <a href="relative/link.html">Relative</a>
        <a href="/root/link">Root Relative</a>
        <a href="../sibling/link">Sibling Relative</a>
      </body></html>`;
    const sourceUrl = "http://example.com/sub/dir/page.html";
    const context = createMockContext("text/html", html, sourceUrl);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.links).toEqual(
      expect.arrayContaining([
        "http://external.com/page",
        "http://example.com/sub/dir/relative/link.html",
        "http://example.com/root/link",
        "http://example.com/sub/sibling/link",
      ]),
    );
    expect(context.links).toHaveLength(4);
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
  });

  it("should filter out invalid and empty links", async () => {
    const middleware = new HtmlLinkExtractorMiddleware();
    const html = `
      <html><body>
        <a href="http://valid.com">Valid</a>
        <a href="javascript:void(0)">Invalid JS</a>
        <a href="">Empty</a>
        <a href="  ">Whitespace</a>
        <a>No Href</a>
      </body></html>`;
    const context = createMockContext("text/html", html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.links).toEqual(["http://valid.com/"]); // URL resolves against base
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
  });

  it("should handle duplicate links, storing only unique ones", async () => {
    const middleware = new HtmlLinkExtractorMiddleware();
    const html = `
      <html><body>
        <a href="http://example.com/page1">Page 1</a>
        <a href="/page1">Page 1 Root Rel</a>
        <a href="page2.html">Page 2 Rel</a>
        <a href="page2.html">Page 2 Rel Dup</a>
      </body></html>`;
    const sourceUrl = "http://example.com/index.html";
    const context = createMockContext("text/html", html, sourceUrl);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.links).toEqual(
      expect.arrayContaining([
        "http://example.com/page1",
        "http://example.com/page2.html",
      ]),
    );
    // Using Set internally ensures uniqueness
    expect(context.links).toHaveLength(2);
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
  });

  it("should skip processing and warn if context.dom is missing for HTML content", async () => {
    const middleware = new HtmlLinkExtractorMiddleware();
    const context = createMockContext("text/html"); // No HTML content, dom is undefined
    const next = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(logger, "warn");

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.links).toEqual([]); // Links should not be extracted
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("context.dom is missing"),
    );
    expect(context.errors).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it("should skip processing if content type is not HTML", async () => {
    const middleware = new HtmlLinkExtractorMiddleware();
    const context = createMockContext("text/plain", "<a>http://example.com</a>");
    const next = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(logger, "warn");

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.links).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled(); // Should not warn if not HTML
    expect(context.errors).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it("should handle errors during DOM query", async () => {
    const middleware = new HtmlLinkExtractorMiddleware();
    const html = "<html><body><a href='/'>Link</a></body></html>";
    const context = createMockContext("text/html", html);
    const next = vi.fn().mockResolvedValue(undefined);
    const errorMsg = "Query failed";

    // Mock querySelectorAll to throw an error
    const originalQuerySelectorAll = context.dom?.document.querySelectorAll;
    if (context.dom) {
      context.dom.document.querySelectorAll = vi.fn().mockImplementation(() => {
        throw new Error(errorMsg);
      });
    }

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce(); // Should still call next
    expect(context.links).toEqual([]);
    expect(context.errors).toHaveLength(1);
    expect(context.errors[0].message).toContain(errorMsg);

    // Restore if mocked
    if (context.dom && originalQuerySelectorAll) {
      context.dom.document.querySelectorAll = originalQuerySelectorAll;
    }
    context.dom?.close();
  });
});
