import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import type { ScraperOptions } from "../types";
import { HtmlLinkExtractorMiddleware } from "./HtmlLinkExtractorMiddleware";
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
  it("should skip processing if context.dom is missing for HTML content", async () => {
    const middleware = new HtmlLinkExtractorMiddleware();
    const context = createMockContext(); // No HTML content, dom is undefined
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.links).toEqual([]); // Links should not be extracted
    expect(context.errors).toHaveLength(0);
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

  it("should resolve mixed links once each and skip empty, javascript: and mailto: links", async () => {
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
        <a href="http://example.com/example-a?view=page1">AbsDupOfRoot</a>
        <a href="">Empty</a>
        <a href="  ">Whitespace</a>
        <a>No Href</a>
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

  it("should resolve relative links against the page URL or its first base tag", async () => {
    const cases: Array<{
      label: string;
      source: string;
      bases: string[];
      href: string;
      expected: string;
    }> = [
      // A file URL resolves against its parent directory.
      {
        label: "file base, nested",
        source: "http://example.com/api/index.html",
        bases: [],
        href: "aiq/agent/index.html",
        expected: "http://example.com/api/aiq/agent/index.html",
      },
      {
        label: "file base, up one",
        source: "http://example.com/api/index.html",
        bases: [],
        href: "../shared/index.html",
        expected: "http://example.com/shared/index.html",
      },
      {
        label: "file base, query",
        source: "http://example.com/api/index.html",
        bases: [],
        href: "?q=1",
        expected: "http://example.com/api/index.html?q=1",
      },
      {
        label: "file base, hash",
        source: "http://example.com/api/index.html",
        bases: [],
        href: "#top",
        expected: "http://example.com/api/index.html#top",
      },
      // A trailing slash makes the directory itself the base.
      {
        label: "directory base, nested",
        source: "http://example.com/api/",
        bases: [],
        href: "aiq/agent/index.html",
        expected: "http://example.com/api/aiq/agent/index.html",
      },
      {
        label: "directory base, up one",
        source: "http://example.com/api/",
        bases: [],
        href: "../shared/index.html",
        expected: "http://example.com/shared/index.html",
      },
      {
        label: "directory base, query",
        source: "http://example.com/api/",
        bases: [],
        href: "?q=1",
        expected: "http://example.com/api/?q=1",
      },
      {
        label: "directory base, hash",
        source: "http://example.com/api/",
        bases: [],
        href: "#top",
        expected: "http://example.com/api/#top",
      },
      {
        label: "relative base tag",
        source: "http://example.com/site/section/page.html",
        bases: ["../assets/"],
        href: "img/logo.png",
        expected: "http://example.com/site/assets/img/logo.png",
      },
      {
        label: "absolute cross-origin base tag",
        source: "http://example.com/app/index.html",
        bases: ["https://cdn.example.com/lib/"],
        href: "script.js",
        expected: "https://cdn.example.com/lib/script.js",
      },
      {
        label: "protocol-relative base tag",
        source: "http://example.com/app/index.html",
        bases: ["//cdn.example.com/lib/"],
        href: "style.css",
        expected: "http://cdn.example.com/lib/style.css",
      },
      {
        label: "several base tags, the first wins",
        source: "http://example.com/base/test.html",
        bases: ["/one/", "/two/"],
        href: "a",
        expected: "http://example.com/one/a",
      },
      {
        label: "invalid base tag falls back to the page URL",
        source: "http://example.com/path/page.html",
        bases: [":bad:://"],
        href: "rel",
        expected: "http://example.com/path/rel",
      },
      {
        label: "directory page with a relative base tag",
        source: "http://example.com/docs/",
        bases: ["subdir/"],
        href: "a",
        expected: "http://example.com/docs/subdir/a",
      },
    ];

    for (const { label, source, bases, href, expected } of cases) {
      const middleware = new HtmlLinkExtractorMiddleware();
      const head = bases.map((base) => `<base href="${base}">`).join("");
      const context = createMockContext(
        `<html><head>${head}</head><body><a href="${href}">Link</a></body></html>`,
        source,
      );

      await middleware.process(context, async () => {});

      expect.soft(context.links, label).toEqual([expected]);
    }
  });
});
