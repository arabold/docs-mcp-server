import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { describe, expect, it, vi } from "vitest";
import type { ScraperOptions } from "../types";
import { HtmlToMarkdownMiddleware } from "./HtmlToMarkdownMiddleware";
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

/** Converts the HTML with a fresh middleware and returns the context. */
async function convert(html: string): Promise<MiddlewareContext> {
  const middleware = new HtmlToMarkdownMiddleware();
  const context = createMockContext(html);
  const next = vi.fn().mockResolvedValue(undefined);

  await middleware.process(context, next);

  expect(next).toHaveBeenCalledOnce();
  return context;
}

describe("HtmlToMarkdownMiddleware", () => {
  it("should convert basic HTML and tables to Markdown", async () => {
    const context = await convert(`
      <html><body>
        <h1>Heading 1</h1>
        <p>This is a paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
        <ul><li>Item 1</li><li>Item 2</li></ul>
        <a href="http://link.com">Link</a>
        <table>
          <thead><tr><th>Header 1</th><th>Header 2</th></tr></thead>
          <tbody><tr><td>Data 1</td><td>Data 2</td></tr></tbody>
        </table>
      </body></html>`);

    expect(context.content).toBe(
      "# Heading 1\n\nThis is a paragraph with **bold** and _italic_ text.\n\n-   Item 1\n-   Item 2\n\n[Link](http://link.com)\n\n| Header 1 | Header 2 |\n| --- | --- |\n| Data 1 | Data 2 |",
    );
    expect(context.contentType).toBe("text/markdown");
    expect(context.errors).toHaveLength(0);
  });

  it("should keep the language and every line of a code block", async () => {
    const cases: Array<{ label: string; html: string; expected: string }> = [
      {
        label: "language class",
        html: '<pre><code class="language-javascript">const x = 1;</code></pre>',
        expected: "```javascript\nconst x = 1;\n```",
      },
      {
        label: "<br> line breaks",
        html: '<pre><code class="language-text">Line 1<br>Line 2<br><br>Line 4</code></pre>',
        expected: "```text\nLine 1\nLine 2\n\nLine 4\n```",
      },
      {
        // Real-world output from Shiki (tailwindcss.com, Astro/MDX sites, etc.).
        // No `\n` or `<br>` between lines — only `<span class="line">` containers
        // CSS-styled as `display: block`.
        label: "Shiki span.line",
        html: '<pre class="shiki"><code><span class="line"><span>npm</span><span> create vite@latest my-project</span></span><span class="line"><span>cd</span><span> my-project</span></span></code></pre>',
        expected: "npm create vite@latest my-project\ncd my-project",
      },
      {
        label: "highlight.js-style div.line",
        html: '<pre><code><div class="line">line one</div><div class="line">line two</div><div class="line">line three</div></code></pre>',
        expected: "line one\nline two\nline three",
      },
      {
        label: "existing newlines and <br>",
        html: "<pre><code>line one<br>line two\nline three</code></pre>",
        expected: "line one\nline two\nline three",
      },
    ];

    for (const { label, html, expected } of cases) {
      const context = await convert(`<html><body>${html}</body></html>`);

      expect.soft(context.content, label).toContain(expected);
      expect.soft(context.errors, label).toHaveLength(0);
    }
  });

  it("should split oversized tables before GFM conversion while retaining content", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const rows = Array.from(
      { length: 505 },
      (_, index) =>
        `<tr><td>Row ${index + 1}</td><td><strong>Value ${index + 1}</strong></td></tr>`,
    ).join("");
    const html = `
      <html><body>
        <table>
          <thead><tr><th>Name</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.errors).toHaveLength(0);
    expect(context.content).toContain("| Row 1 | **Value 1** |");
    expect(context.content).toContain("| Row 505 | **Value 505** |");
    expect(context.content.match(/\| Name \| Value \|/g)).toHaveLength(6);
  });

  it("should repeat the caption on every part of a split oversized table", async () => {
    const rows = Array.from(
      { length: 505 },
      (_, index) => `<tr><td>Row ${index + 1}</td><td>Value ${index + 1}</td></tr>`,
    ).join("");

    const context = await convert(`
      <html><body>
        <table>
          <caption>Release matrix</caption>
          <colgroup><col span="2"></colgroup>
          <thead><tr><th>Name</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body></html>`);

    expect(context.errors).toHaveLength(0);
    expect(context.content.match(/Release matrix/g)).toHaveLength(6);
    expect(context.content).toContain("| Row 505 | Value 505 |");
  });

  it("should preserve oversized tables as HTML when row splitting is not possible", async () => {
    const headerCells = Array.from(
      { length: 1001 },
      (_, index) => `<th>Header ${index + 1}</th>`,
    ).join("");
    const dataCells = Array.from(
      { length: 1001 },
      (_, index) => `<td>Value ${index + 1}</td>`,
    ).join("");

    const context = await convert(`
      <html><body>
        <table>
          <thead><tr>${headerCells}</tr></thead>
          <tbody><tr>${dataCells}</tr></tbody>
        </table>
      </body></html>`);

    expect(context.errors).toHaveLength(0);
    expect(context.content).toContain("<table>");
    expect(context.content).toContain("<th>Header 1</th>");
    expect(context.content).toContain("<td>Value 1001</td>");
    expect(context.content).not.toContain("data-docs-mcp-preserved-table-id");
    expect(context.content).not.toContain("| Header 1 |");
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

  it("should skip processing if context.dom is missing for HTML content", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const context = createMockContext(); // No HTML content, dom is undefined
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.content).toBe(""); // Original content (empty string)
    expect(context.errors).toHaveLength(0);
  });

  it("should fall back to text when nothing in the document converts", async () => {
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

    try {
      await middleware.process(context, next);
    } finally {
      turndownSpy.mockRestore();
    }

    expect(next).toHaveBeenCalledOnce(); // Should still call next
    // Keeping the markup would index HTML as if it were prose, but the words
    // are still worth having.
    expect(context.content).toBe("Content");
    expect(context.errors).toHaveLength(1);
    expect(context.errors[0].message).toContain(errorMsg);
  });

  it("should keep the convertible parts when one subtree fails to convert", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    const html = `
      <html><body>
        <h1>Title</h1>
        <p>Good paragraph.</p>
        <div class="broken">Broken text</div>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    const realTurndown = TurndownService.prototype.turndown;
    const turndownSpy = vi
      .spyOn(TurndownService.prototype, "turndown")
      .mockImplementation(function (
        this: TurndownService,
        input: Parameters<typeof realTurndown>[0],
      ) {
        if (typeof input === "string" && input.includes("broken")) {
          throw new Error("Turndown failed");
        }
        return realTurndown.call(this, input);
      });

    try {
      await middleware.process(context, next);
    } finally {
      turndownSpy.mockRestore();
    }

    expect(context.errors).toHaveLength(1);
    expect(context.contentType).toBe("text/markdown");
    // Headings survive, which is what the semantic splitter chunks on.
    expect(context.content).toContain("# Title");
    expect(context.content).toContain("Good paragraph.");
    // The failing subtree contributes its text rather than nothing.
    expect(context.content).toContain("Broken text");
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

  it("should render a link label as one line that keeps its inline formatting", async () => {
    const cases: Array<{ label: string; html: string; expected: string }> = [
      {
        label: "block-level whitespace",
        html: `<a href="https://react.dev/reference/react/useDeferredValue">
          <div>
            <span>Previous</span>
            <span>useDeferredValue</span>
          </div>
        </a>`,
        expected:
          "[Previous useDeferredValue](https://react.dev/reference/react/useDeferredValue)",
      },
      {
        label: "nested formatting",
        html: '<a href="https://example.com/docs"><div><strong>Bold</strong> and <em>italic</em></div></a>',
        expected: "[**Bold** and _italic_](https://example.com/docs)",
      },
      {
        label: "inline code",
        html: '<a href="https://example.com/api"><div><code>useEffect</code><span> API</span></div></a>',
        expected: "[`useEffect` API](https://example.com/api)",
      },
      {
        label: "image link",
        html: '<a href="https://example.com/image"><div><img src="hero.png" alt="Hero"></div></a>',
        expected: "[![Hero](hero.png)](https://example.com/image)",
      },
    ];

    for (const { label, html, expected } of cases) {
      const context = await convert(`<html><body>${html}</body></html>`);

      expect.soft(context.content, label).toBe(expected);
      expect.soft(context.errors, label).toHaveLength(0);
    }
  });

  it("should convert code blocks containing element names the DOM cannot recreate", async () => {
    const middleware = new HtmlToMarkdownMiddleware();
    // Generators that fail to escape `<` in their output leave tags like
    // `<lt;200 cores/socket>` behind. Browsers park those in the tree as
    // unknown elements, but their names are invalid for `createElement`.
    const html = `
      <html><body>
        <pre>One <lt;200 cores/socket>gt;200 cores</pre>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.errors).toHaveLength(0);
    expect(context.contentType).toBe("text/markdown");
    expect(context.content).toContain("200 cores");
  });

  it("never leaves markup in the context when the salvage itself fails", async () => {
    // The salvage runs the same converter over the same document, so whatever
    // defeated the whole-document pass can defeat it too. An escaping throw
    // skipped the assignment that replaces the content, leaving the raw HTML
    // for the splitter to chunk and the embedder to bill for — and, on a
    // refresh, leaving a zero-chunk result that replaced the stored page.
    //
    // The salvage is made to throw directly rather than via the input that
    // first exposed this (a document nested ~2000 deep, which overflows the
    // stack in turndown). That input costs tens of seconds to run and is
    // pathological; the guard has to hold for any throw, which is what this
    // asserts. The depth bound that made that input affordable is covered
    // separately below.
    const html =
      "<html><body><h1>Title</h1><p>Real prose worth keeping.</p></body></html>";
    const context = createMockContext(html);
    const middleware = new HtmlToMarkdownMiddleware();

    // Force the whole-document conversion to fail, then the salvage after it.
    // Reached through an alias rather than `@ts-expect-error` per line: the
    // rules are registered in the constructor, so only `turndown` is called
    // from here and the stub does not have to satisfy the full interface.
    const internals = middleware as unknown as {
      turndownService: { turndown: () => string };
      salvageMarkdown: () => string;
    };
    internals.turndownService = {
      turndown: () => {
        throw new Error("conversion exploded");
      },
    };
    internals.salvageMarkdown = () => {
      throw new Error("salvage exploded");
    };

    await middleware.process(context, async () => {});

    expect(context.content.trimStart().startsWith("<")).toBe(false);
    expect(context.content).toBe("");
    expect(context.errors.length).toBeGreaterThan(0);
  });

  it("stops descending past the salvage depth bound", async () => {
    // Each level serializes its whole subtree to hand Turndown a string, so an
    // unbounded descent costs O(depth x size) — minutes on a document built
    // from thousands of nested wrappers. Past the bound the words are taken
    // and the walk stops.
    const nested = (depth: number) =>
      `<html><body>${'<div class="wrap">'.repeat(depth)}<h1>Heading</h1> <p>Body prose.</p>${"</div>".repeat(depth)}</body></html>`;
    // Every subtree that holds a wrapper fails to convert, so the salvage
    // descends one wrapper at a time until it reaches the heading.
    const realTurndown = TurndownService.prototype.turndown;
    vi.spyOn(TurndownService.prototype, "turndown").mockImplementation(function (
      this: TurndownService,
      input: Parameters<typeof realTurndown>[0],
    ) {
      if (typeof input === "string" && input.includes('class="wrap"')) {
        throw new Error("Turndown failed");
      }
      return realTurndown.call(this, input);
    });

    try {
      const withinBound = await convert(nested(2));
      const pastBound = await convert(nested(101));

      // Within the bound the structure survives; past it, only the text does.
      expect(withinBound.content).toContain("# Heading");
      expect(pastBound.content).not.toContain("#");
      expect(pastBound.content).toContain("Heading");
      expect(pastBound.content).toContain("Body prose.");
    } finally {
      vi.restoreAllMocks();
    }
  });
});
