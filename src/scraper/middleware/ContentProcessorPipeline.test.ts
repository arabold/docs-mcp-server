import { describe, expect, it, vi } from "vitest";
import type { ScraperOptions } from "../types";
import { ContentProcessingPipeline } from "./ContentProcessorPipeline";
import {
  HtmlDomParserMiddleware,
  HtmlLinkExtractorMiddleware,
  HtmlMetadataExtractorMiddleware,
  HtmlSanitizerMiddleware,
  HtmlToMarkdownMiddleware,
  MarkdownLinkExtractorMiddleware,
  MarkdownMetadataExtractorMiddleware,
} from "./components";
import type { ContentProcessingContext } from "./types";

// Suppress logger output during tests
vi.mock("../../utils/logger");

// Helper to create a minimal valid ScraperOptions object
const createMockScraperOptions = (
  url = "http://example.com",
  excludeSelectors?: string[],
): ScraperOptions => ({
  url,
  library: "test-lib",
  version: "1.0.0",
  maxDepth: 0,
  maxPages: 1,
  maxConcurrency: 1,
  scope: "subpages",
  followRedirects: true,
  excludeSelectors: excludeSelectors || [],
  ignoreErrors: false,
});

// Helper to create a basic context for pipeline tests
const createPipelineTestContext = (
  content: string | Buffer,
  contentType: string,
  source = "http://example.com",
  options?: Partial<ScraperOptions>,
): ContentProcessingContext => {
  const fullOptions = { ...createMockScraperOptions(source), ...options };
  const context: ContentProcessingContext = {
    content,
    contentType,
    source,
    metadata: {},
    links: [],
    errors: [],
    options: fullOptions,
    // dom is added by the parser middleware
  };
  return context;
};

// Define the standard HTML pipeline for tests
const htmlPipeline = new ContentProcessingPipeline([
  new HtmlDomParserMiddleware(),
  new HtmlMetadataExtractorMiddleware(),
  new HtmlLinkExtractorMiddleware(),
  new HtmlSanitizerMiddleware(), // Uses default selectors if none provided in context.options
  new HtmlToMarkdownMiddleware(),
]);

describe("ContentProcessingPipeline - HTML", () => {
  it("should process valid HTML content end-to-end", async () => {
    const html =
      "<html><head><title>Test Title</title></head><body><h1>Hello</h1><p>World</p><a href='/page'>Link</a><script>alert(1)</script></body></html>";
    const context = createPipelineTestContext(
      html,
      "text/html",
      "https://example.com/base",
    );

    await htmlPipeline.run(context);

    expect(context.errors).toHaveLength(0);
    expect(context.metadata.title).toBe("Test Title");
    expect(context.content).toBe("# Hello\n\nWorld\n\n[Link](/page)"); // Script removed, content converted
    expect(context.contentType).toBe("text/markdown");
    expect(context.links).toEqual(["https://example.com/page"]); // Link extracted and resolved

    // DOM should be undefined after pipeline completion (if parser cleans up)
    // Update this assertion based on final cleanup strategy
    // expect(context.dom).toBeUndefined(); // DOM cleanup responsibility TBD
  });

  it("should process HTML with attributes in the title tag", async () => {
    const html =
      '<html><head><title lang="en">Title With Attributes</title></head><body><h1>Hello</h1></body></html>';
    const context = createPipelineTestContext(html, "text/html");

    await htmlPipeline.run(context);

    expect(context.errors).toHaveLength(0);
    expect(context.metadata.title).toBe("Title With Attributes");
    expect(context.content).toBe("# Hello");
  });

  it("should extract and resolve various link types", async () => {
    const html =
      '<html><body><a href="https://ext.com/page1">Ext</a><a href="/page2">Root</a><a href="sub/page3">Rel</a></body></html>';
    const context = createPipelineTestContext(
      html,
      "text/html",
      "https://example.com/base/",
    );

    await htmlPipeline.run(context);

    expect(context.errors).toHaveLength(0);
    expect(context.links).toEqual([
      "https://ext.com/page1",
      "https://example.com/page2",
      "https://example.com/base/sub/page3",
    ]);
  });

  it("should remove script and style tags", async () => {
    const html =
      "<html><head><title>Test</title><style>body { color: red; }</style></head><body><script>alert('Hello');</script><h1>Hello</h1></body></html>";
    const context = createPipelineTestContext(html, "text/html");

    await htmlPipeline.run(context);

    expect(context.errors).toHaveLength(0);
    expect(context.content).toBe("# Hello"); // Script and style content gone
  });

  it("should remove unwanted tags (nav) but extract links first", async () => {
    const html =
      '<html><body><nav><ul><li><a href="/home">Home</a></li><li><a href="/about">About</a></li></ul></nav><p>Other content</p></body></html>';
    const context = createPipelineTestContext(html, "text/html", "https://example.com");

    await htmlPipeline.run(context);

    expect(context.errors).toHaveLength(0);
    expect(context.links).toEqual([
      "https://example.com/home",
      "https://example.com/about",
    ]);
    expect(context.content).toBe("Other content"); // Nav content removed
  });

  it("should handle code block language detection", async () => {
    const html =
      '<html><body><div class="highlight-source-python"><pre><code>print("Hello")</code></pre></div><pre class="language-java"><code>System.out.println("Hi")</code></pre><pre data-language="typescript">var x=1;</pre></body></html>';
    const context = createPipelineTestContext(html, "text/html");

    await htmlPipeline.run(context);

    expect(context.errors).toHaveLength(0);
    expect(context.content).toContain('```python\nprint("Hello")\n```');
    expect(context.content).toContain('```java\nSystem.out.println("Hi")\n```');
    expect(context.content).toContain("```typescript\nvar x=1;\n```");
  });

  it("should remove elements matching custom excludeSelectors", async () => {
    const html =
      '<html><body><div class="remove-this">Remove</div><p>Keep</p></body></html>';
    const context = createPipelineTestContext(html, "text/html", undefined, {
      excludeSelectors: [".remove-this"],
    });

    await htmlPipeline.run(context);

    expect(context.errors).toHaveLength(0);
    expect(context.content).toBe("Keep");
  });

  // --- More HTML tests can be added here ---
});

// Define the standard Markdown pipeline for tests
const markdownPipeline = new ContentProcessingPipeline([
  new MarkdownMetadataExtractorMiddleware(),
  new MarkdownLinkExtractorMiddleware(), // Currently basic/placeholder
]);

describe("ContentProcessingPipeline - Markdown", () => {
  it("should process valid Markdown content (extract title)", async () => {
    const markdown = "# Hello\n\nWorld";
    const context = createPipelineTestContext(markdown, "text/markdown");

    await markdownPipeline.run(context);

    expect(context.errors).toHaveLength(0);
    expect(context.metadata.title).toBe("Hello");
    expect(context.content).toBe(markdown); // Content should remain unchanged
    expect(context.contentType).toBe("text/markdown"); // Type should remain unchanged
    expect(context.links).toEqual([]); // MarkdownLinkExtractor is basic
  });

  it("should process plain text as Markdown (default title)", async () => {
    const text = "Hello, world!";
    const context = createPipelineTestContext(text, "text/plain");

    await markdownPipeline.run(context);

    expect(context.errors).toHaveLength(0);
    expect(context.metadata.title).toBe("Untitled"); // Default title
    expect(context.content).toBe(text);
    expect(context.contentType).toBe("text/plain");
  });

  it("should return 'Untitled' title if no H1 found in Markdown", async () => {
    const markdown = "## Subheading\n\nSome content without a title";
    const context = createPipelineTestContext(markdown, "text/markdown");

    await markdownPipeline.run(context);

    expect(context.errors).toHaveLength(0);
    expect(context.metadata.title).toBe("Untitled");
    expect(context.content).toBe(markdown);
  });

  it("should handle empty Markdown content without error", async () => {
    // The pipeline itself shouldn't error on empty content,
    // individual middleware might log warnings or produce empty results.
    const markdown = "";
    const context = createPipelineTestContext(markdown, "text/markdown");

    await markdownPipeline.run(context);

    expect(context.errors).toHaveLength(0);
    expect(context.metadata.title).toBe("Untitled"); // Default title
    expect(context.content).toBe("");
    expect(context.contentType).toBe("text/markdown");
  });

  // Note: The pipeline doesn't inherently throw errors for wrong content types.
  // Middleware might skip processing or add errors to context.errors.
  // We test the HTML pipeline handles HTML, and Markdown pipeline handles MD/Plain.
});
