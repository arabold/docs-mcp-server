import { JSDOM } from "jsdom";
import TurndownService from "turndown"; // Import for mocking if needed
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../../utils/logger";
import type { ScraperOptions } from "../../types";
import type { ContentProcessingContext } from "../types";
import { HtmlToMarkdownMiddleware } from "./HtmlToMarkdownMiddleware";

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
    // Start with original HTML content if provided, middleware should overwrite
    content: htmlContent || (contentType === "text/html" ? "" : "non-html"),
    contentType,
    source,
    metadata: {},
    links: [],
    errors: [],
    options: { ...createMockScraperOptions(source), ...options },
  };
  if (htmlContent && contentType.startsWith("text/html")) {
    context.dom = new JSDOM(htmlContent, { url: source }).window;
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
    const context = createMockContext("text/html", html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.content).toBe(
      "# Heading 1\n\nThis is a paragraph with **bold** and _italic_ text.\n\n-   Item 1\n-   Item 2\n\n[Link](http://link.com)",
    );
    expect(context.contentType).toBe("text/markdown");
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
  });

  it("should apply custom code block rule", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const html = `
      <html><body>
        <pre><code class="language-javascript">const x = 1;</code></pre>
      </body></html>`;
    const context = createMockContext("text/html", html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    // Check for trimmed content within the code block
    expect(context.content).toContain("```javascript\nconst x = 1;\n```");
    expect(context.contentType).toBe("text/markdown");
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
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
    const context = createMockContext("text/html", html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    // Turndown's default table output
    const expectedMarkdown =
      "| Header 1 | Header 2 |\n| --- | --- |\n| Data 1 | Data 2 |";
    expect(context.content).toBe(expectedMarkdown);
    expect(context.contentType).toBe("text/markdown");
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
  });

  it("should return empty string and markdown type if conversion results in empty markdown", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    // HTML that results in empty markdown (only comments)
    const html = "<html><body><!-- comment only --></body></html>";
    const context = createMockContext("text/html", html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.content).toBe(""); // Content should be empty string
    expect(context.contentType).toBe("text/markdown"); // ContentType SHOULD change
    expect(context.errors).toHaveLength(0); // No error should be added

    context.dom?.close();
  });

  it("should skip processing and warn if context.dom is missing for HTML content", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const context = createMockContext("text/html"); // No HTML content, dom is undefined
    const next = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(logger, "warn");

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.content).toBe(""); // Original content (empty string)
    expect(context.contentType).toBe("text/html"); // Original content type
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("context.dom is missing"),
    );
    expect(context.errors).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it("should skip processing if content type is not HTML", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const context = createMockContext("text/plain", "Just plain text");
    const next = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(logger, "warn");

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.content).toBe("Just plain text"); // Content unchanged
    expect(context.contentType).toBe("text/plain"); // Content type unchanged
    expect(warnSpy).not.toHaveBeenCalled(); // Should not warn if not HTML
    expect(context.errors).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it("should handle errors during Turndown conversion", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const html = "<html><body><p>Content</p></body></html>";
    const context = createMockContext("text/html", html);
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
    expect(context.contentType).toBe("text/html"); // Content type should remain original
    expect(context.errors).toHaveLength(1);
    expect(context.errors[0].message).toContain(errorMsg);

    turndownSpy.mockRestore();
    context.dom?.close();
  });
});
