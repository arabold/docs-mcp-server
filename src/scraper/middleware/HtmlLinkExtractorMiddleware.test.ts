import * as cheerio from "cheerio"; // Import cheerio
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../utils/logger";
import type { ScraperOptions } from "../types";
import { HtmlLinkExtractorMiddleware } from "./HtmlLinkExtractorMiddleware";
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
  source = "http://example.com/path/page.html",
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
    const context = createMockContext(html, sourceUrl);
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
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.links).toEqual(["http://valid.com/"]); // URL resolves against base
    expect(context.errors).toHaveLength(0);
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
    const context = createMockContext(html, sourceUrl);
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
  });

  it("should skip processing and warn if context.dom is missing for HTML content", async () => {
    const middleware = new HtmlLinkExtractorMiddleware();
    const context = createMockContext(); // No HTML content, dom is undefined
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
    const context = createMockContext("<a>http://example.com</a>");
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
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);
    const errorMsg = "Query failed";
    const mockError = new Error(errorMsg);

    // Mock the Cheerio object to throw an error when selecting 'a[href]'
    const mockDom = vi.fn(() => {
      throw mockError;
    }) as unknown as cheerio.CheerioAPI; // Cast to satisfy type, though it's a mock function
    context.dom = mockDom;

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce(); // Should still call next
    expect(context.links).toEqual([]);
    expect(context.errors).toHaveLength(1);
    // Check if the error message includes the original error's message
    expect(context.errors[0].message).toContain("Failed to extract links from HTML");
    expect(context.errors[0].message).toContain(errorMsg);
  });

  it("should resolve mixed relative links with queries, hashes, and handle duplicates/protocols", async () => {
    const middleware = new HtmlLinkExtractorMiddleware();
    const sourceUrl = "http://example.com/docs/sub/page.html";
    const html = `
      <html><body>
        <a href="http://external.com/page">Abs</a>
        <a href="example-a?view=page1">Rel+Q</a>
        <a href="/example-a?view=page1">Root+Q</a>
        <a href="../example-a?view=page1">Parent+Q</a>
        <a href="?view=page1">QueryOnly</a>
        <a href="#section1">HashOnly</a>
        <a href="example-a?view=abc#frag">Rel+Q+Hash</a>
        <a href="example-a?view=a">DupA</a>
        <a href="example-a?view=b">DupB</a>
        <a href="example-a?view=a">DupARepeat</a>
        <a href="javascript:void(0)">JS</a>
        <a href="mailto:user@example.com?subject=Hi">Mail</a>
        <a href="test%2Dabc?view=test%2Dabc">Encoded</a>
        <a href="../example-a?view=zzz#h">Parent+Q+Hash</a>
        <a href="HTTP://external.com/UP">UpperProto</a>
        <a href="example-a.html?view=page1">HtmlExt</a>
      </body></html>`;
    const context = createMockContext(html, sourceUrl);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    const expected = [
      "http://external.com/page",
      "http://example.com/docs/sub/example-a?view=page1",
      "http://example.com/example-a?view=page1",
      "http://example.com/docs/example-a?view=page1",
      "http://example.com/docs/sub/page.html?view=page1",
      "http://example.com/docs/sub/page.html#section1",
      "http://example.com/docs/sub/example-a?view=abc#frag",
      "http://example.com/docs/sub/example-a?view=a",
      "http://example.com/docs/sub/example-a?view=b",
      "http://example.com/docs/sub/test%2Dabc?view=test%2Dabc",
      "http://example.com/docs/example-a?view=zzz#h",
      "http://external.com/UP",
      "http://example.com/docs/sub/example-a.html?view=page1",
    ];
    expect(context.links).toEqual(expected);
    expect(context.links.some((l) => l.startsWith("javascript:"))).toBe(false);
    expect(context.links.some((l) => l.startsWith("mailto:"))).toBe(false);
    expect(context.errors).toHaveLength(0);
  });

  describe("relative resolution from file base (index.html)", () => {
    it("should resolve links relative to the file's parent directory", async () => {
      const middleware = new HtmlLinkExtractorMiddleware();
      const sourceUrl = "http://example.com/api/index.html";
      const html = `
        <html><body>
          <a href="aiq/agent/index.html">Nested</a>
          <a href="../shared/index.html">UpOne</a>
          <a href="?q=1">QuerySame</a>
          <a href="#top">HashSame</a>
        </body></html>`;
      const context = createMockContext(html, sourceUrl);
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware.process(context, next);

      expect(next).toHaveBeenCalledOnce();
      expect(context.links).toEqual([
        "http://example.com/api/aiq/agent/index.html",
        "http://example.com/shared/index.html",
        "http://example.com/api/index.html?q=1",
        "http://example.com/api/index.html#top",
      ]);
    });
  });

  describe("relative resolution from directory base (trailing slash)", () => {
    it("should resolve links relative to the directory itself", async () => {
      const middleware = new HtmlLinkExtractorMiddleware();
      const sourceUrl = "http://example.com/api/"; // directory form
      const html = `
        <html><body>
          <a href="aiq/agent/index.html">Nested</a>
          <a href="../shared/index.html">UpOne</a>
          <a href="?q=1">QueryDir</a>
          <a href="#top">HashDir</a>
        </body></html>`;
      const context = createMockContext(html, sourceUrl);
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware.process(context, next);

      expect(next).toHaveBeenCalledOnce();
      expect(context.links).toEqual([
        "http://example.com/api/aiq/agent/index.html",
        "http://example.com/shared/index.html",
        "http://example.com/api/?q=1",
        "http://example.com/api/#top",
      ]);
    });
  });

  describe("base tag handling", () => {
    it("resolves relative links using relative base path", async () => {
      const middleware = new HtmlLinkExtractorMiddleware();
      const sourceUrl = "http://example.com/site/section/page.html";
      const html = `
        <html>
          <head><base href="../assets/"></head>
          <body>
            <a href="img/logo.png">Logo</a>
          </body>
        </html>`;
      const context = createMockContext(html, sourceUrl);
      const next = vi.fn().mockResolvedValue(undefined);
      await middleware.process(context, next);
      expect(context.links).toEqual(["http://example.com/site/assets/img/logo.png"]);
    });

    it("resolves links with absolute cross-origin base", async () => {
      const middleware = new HtmlLinkExtractorMiddleware();
      const sourceUrl = "http://example.com/app/index.html";
      const html = `
        <html>
          <head><base href="https://cdn.example.com/lib/"></head>
          <body><a href="script.js">Script</a></body>
        </html>`;
      const context = createMockContext(html, sourceUrl);
      const next = vi.fn().mockResolvedValue(undefined);
      await middleware.process(context, next);
      expect(context.links).toEqual(["https://cdn.example.com/lib/script.js"]);
    });

    it("supports protocol-relative base", async () => {
      const middleware = new HtmlLinkExtractorMiddleware();
      const sourceUrl = "http://example.com/app/index.html";
      const html = `
        <html>
          <head><base href="//cdn.example.com/lib/"></head>
          <body><a href="style.css">Style</a></body>
        </html>`;
      const context = createMockContext(html, sourceUrl);
      const next = vi.fn().mockResolvedValue(undefined);
      await middleware.process(context, next);
      expect(context.links).toEqual(["http://cdn.example.com/lib/style.css"]);
    });

    it("uses only the first base tag when multiple present", async () => {
      const middleware = new HtmlLinkExtractorMiddleware();
      const sourceUrl = "http://example.com/base/test.html";
      const html = `
        <html>
          <head>
            <base href="/one/">
            <base href="/two/">
          </head>
          <body><a href="a">A</a></body>
        </html>`;
      const context = createMockContext(html, sourceUrl);
      const next = vi.fn().mockResolvedValue(undefined);
      await middleware.process(context, next);
      expect(context.links).toEqual(["http://example.com/one/a"]);
    });

    it("falls back to page URL on invalid base", async () => {
      const middleware = new HtmlLinkExtractorMiddleware();
      const sourceUrl = "http://example.com/path/page.html";
      const html = `
        <html>
          <head><base href=":bad:://"></head>
          <body><a href="rel">Rel</a></body>
        </html>`;
      const context = createMockContext(html, sourceUrl);
      const next = vi.fn().mockResolvedValue(undefined);
      await middleware.process(context, next);
      expect(context.links).toEqual(["http://example.com/path/rel"]);
    });

    it("handles directory page with relative base", async () => {
      const middleware = new HtmlLinkExtractorMiddleware();
      const sourceUrl = "http://example.com/docs/"; // directory form
      const html = `
        <html>
          <head><base href="subdir/"></head>
          <body><a href="a">A</a></body>
        </html>`;
      const context = createMockContext(html, sourceUrl);
      const next = vi.fn().mockResolvedValue(undefined);
      await middleware.process(context, next);
      expect(context.links).toEqual(["http://example.com/docs/subdir/a"]);
    });
  });
});
