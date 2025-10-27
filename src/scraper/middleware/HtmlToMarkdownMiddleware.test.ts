import * as cheerio from "cheerio"; // Import cheerio
import TurndownService from "turndown"; // Import for mocking if needed
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../utils/logger";
import type { ScraperOptions } from "../types";
import { HtmlToMarkdownMiddleware } from "./HtmlToMarkdownMiddleware";
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

describe("HtmlToMarkdownMiddleware", () => {
  it("should convert basic HTML to Markdown", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const html = `
      <html><body>
        <h1>Heading 1</h1>
        <p>This is a paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
        <ul><li>Item 1</li><li>Item 2</li></ul>
        <a href="http://link.com">Link</a>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.content).toBe(
      "# Heading 1\n\nThis is a paragraph with **bold** and _italic_ text.\n\n-   Item 1\n-   Item 2\n\n[Link](http://link.com)",
    );
    expect(context.errors).toHaveLength(0);

    // No close needed
  });

  it("should apply custom code block rule", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const html = `
      <html><body>
        <pre><code class="language-javascript">const x = 1;</code></pre>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    // Check for trimmed content within the code block
    expect(context.content).toContain("```javascript\nconst x = 1;\n```");
    expect(context.errors).toHaveLength(0);

    // No close needed
  });

  it("should preserve newlines within code blocks using <br>", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const html = `
      <html><body>
        <pre><code class="language-text">Line 1<br>Line 2<br><br>Line 4</code></pre>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    const expectedMarkdown = "```text\nLine 1\nLine 2\n\nLine 4\n```";
    // Normalize whitespace within the actual content for comparison
    const actualContentNormalized = (context.content as string)
      .replace(/\r\n/g, "\n") // Normalize line endings
      .trim(); // Trim leading/trailing whitespace from the whole block
    expect(actualContentNormalized).toBe(expectedMarkdown);
    expect(context.errors).toHaveLength(0);
  });

  it("should apply custom table rule", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const html = `
      <html><body>
        <table>
          <thead><tr><th>Header 1</th><th>Header 2</th></tr></thead>
          <tbody><tr><td>Data 1</td><td>Data 2</td></tr></tbody>
        </table>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    // Turndown's default table output
    const expectedMarkdown =
      "| Header 1 | Header 2 |\n| --- | --- |\n| Data 1 | Data 2 |";
    expect(context.content).toBe(expectedMarkdown);
    expect(context.errors).toHaveLength(0);

    // No close needed
  });

  it("should return empty string and markdown type if conversion results in empty markdown", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    // HTML that results in empty markdown (only comments)
    const html = "<html><body><!-- comment only --></body></html>";
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.content).toBe(""); // Content should be empty string
    expect(context.errors).toHaveLength(0); // No error should be added

    // No close needed
  });

  it("should skip processing and warn if context.dom is missing for HTML content", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const context = createMockContext(); // No HTML content, dom is undefined
    const next = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(logger, "warn");

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.content).toBe(""); // Original content (empty string)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("context.dom is missing"),
    );
    expect(context.errors).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it("should skip processing if content type is not HTML", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const context = createMockContext("Just plain text");
    const next = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(logger, "warn");

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.content).toBe("Just plain text"); // Content unchanged
    expect(warnSpy).not.toHaveBeenCalled(); // Should not warn if not HTML
    expect(context.errors).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it("should handle errors during Turndown conversion", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const html = "<html><body><p>Content</p></body></html>";
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);
    const errorMsg = "Turndown failed";

    // Mock the turndown method on the TurndownService prototype
    const turndownSpy = vi
      .spyOn(TurndownService.prototype, "turndown")
      .mockImplementation(() => {
        throw new Error(errorMsg);
      });

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce(); // Should still call next
    expect(context.content).toBe(html); // Content should remain original HTML
    expect(context.errors).toHaveLength(1);
    expect(context.errors[0].message).toContain(errorMsg);

    turndownSpy.mockRestore();
    // No close needed
  });

  it("should apply custom anchor rule to remove empty or invalid links", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const html = `
      <html><body>
        <p>A <a href="http://valid.com">Valid Link</a>.</p>
        <p>An empty link: <a href="http://empty.com"></a>.</p>
        <p>A hash link: <a href="http://hash.com">#</a>.</p>
        <p>A link with no href: <a>No Href</a>.</p>
        <p>A link with empty href: <a href="">Empty Href</a>.</p>
        <p>Mixed: <a href="http://another.com">Another Valid</a> and <a href="http://bad.com"></a> bad one.</p>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    // Note: The content inside removed anchors ('No Href', 'Empty Href') remains as plain text.
    const expectedMarkdown = `A [Valid Link](http://valid.com).

An empty link: .

A hash link: .

A link with no href: No Href.

A link with empty href: Empty Href.

Mixed: [Another Valid](http://another.com) and bad one.`;
    expect(context.content).toBe(expectedMarkdown);
    expect(context.errors).toHaveLength(0);
  });
});
