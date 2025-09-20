// Copyright (c) 2025
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawContent } from "../fetcher/types";
import { MarkdownLinkExtractorMiddleware } from "../middleware/MarkdownLinkExtractorMiddleware";
import { MarkdownMetadataExtractorMiddleware } from "../middleware/MarkdownMetadataExtractorMiddleware";
import { ScrapeMode, type ScraperOptions } from "../types";
import { MarkdownPipeline } from "./MarkdownPipeline";

describe("MarkdownPipeline", () => {
  beforeEach(() => {
    // Set up spies without mock implementations to use real middleware
    vi.spyOn(MarkdownMetadataExtractorMiddleware.prototype, "process");
    vi.spyOn(MarkdownLinkExtractorMiddleware.prototype, "process");
  });

  it("canProcess returns true for text/markdown", () => {
    const pipeline = new MarkdownPipeline();
    expect(pipeline.canProcess({ mimeType: "text/markdown" } as RawContent)).toBe(true);
    expect(pipeline.canProcess({ mimeType: "text/x-markdown" } as RawContent)).toBe(true);
  });

  // MarkdownPipeline now processes all text/* types as markdown, including text/html.
  it("canProcess returns false for non-text types", () => {
    const pipeline = new MarkdownPipeline();
    expect(pipeline.canProcess({ mimeType: "application/json" } as RawContent)).toBe(
      false,
    );
    // @ts-expect-error
    expect(pipeline.canProcess({ mimeType: undefined } as RawContent)).toBe(false);
  });

  it("process decodes Buffer content with UTF-8 charset", async () => {
    const pipeline = new MarkdownPipeline();
    const raw: RawContent = {
      content: Buffer.from("# Header\n\nThis is a test.", "utf-8"),
      mimeType: "text/markdown",
      charset: "utf-8",
      source: "http://test",
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    expect(result.textContent).toBe("# Header\n\nThis is a test.");
  });

  it("process decodes Buffer content with ISO-8859-1 charset", async () => {
    // Create a spy to capture the content before it's processed
    let capturedContent = "";
    const originalProcess = MarkdownMetadataExtractorMiddleware.prototype.process;
    vi.spyOn(
      MarkdownMetadataExtractorMiddleware.prototype,
      "process",
    ).mockImplementationOnce(async function (
      this: MarkdownMetadataExtractorMiddleware,
      ctx,
      next,
    ) {
      capturedContent = ctx.content;
      // Call the original implementation after capturing
      return originalProcess.call(this, ctx, next);
    });

    const pipeline = new MarkdownPipeline();
    // Create a buffer with ISO-8859-1 encoding (Latin-1)
    // This contains characters that would be encoded differently in UTF-8
    const markdownWithSpecialChars = "# Café";
    const raw: RawContent = {
      content: Buffer.from(markdownWithSpecialChars, "latin1"),
      mimeType: "text/markdown",
      charset: "iso-8859-1", // Explicitly set charset to ISO-8859-1
      source: "http://test",
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    expect(result.textContent).toBe("# Café");

    // Verify the content was properly decoded
    expect(capturedContent).toBe("# Café");
  });

  it("process defaults to UTF-8 when charset is not specified", async () => {
    const pipeline = new MarkdownPipeline();
    const raw: RawContent = {
      content: Buffer.from("# Default UTF-8\n\nContent", "utf-8"),
      mimeType: "text/markdown",
      // No charset specified
      source: "http://test",
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    expect(result.textContent).toBe("# Default UTF-8\n\nContent");
  });

  it("process uses string content directly", async () => {
    const pipeline = new MarkdownPipeline();
    const raw: RawContent = {
      content: "# Title\n\nContent with [link](https://example.com)",
      mimeType: "text/markdown",
      charset: "utf-8",
      source: "http://test",
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    expect(result.textContent).toBe(
      "# Title\n\nContent with [link](https://example.com)",
    );
    // Note: Link extraction is not implemented yet
  });

  it("process calls middleware in order and aggregates results", async () => {
    const pipeline = new MarkdownPipeline();
    const markdown = `---
title: Test Document
author: Test Author
---

# Heading

This is a paragraph with a [link](https://test.example.com).
`;
    const raw: RawContent = {
      content: markdown,
      mimeType: "text/markdown",
      charset: "utf-8",
      source: "http://test",
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);

    // Verify all middleware was called
    expect(MarkdownMetadataExtractorMiddleware.prototype.process).toHaveBeenCalledTimes(
      1,
    );
    expect(MarkdownLinkExtractorMiddleware.prototype.process).toHaveBeenCalledTimes(1);

    // Verify the result contains the original content
    // Note: Frontmatter extraction and link extraction are not implemented yet
    expect(result.textContent).toBe(markdown);
  });

  it("process collects errors from middleware", async () => {
    // Override with error-generating implementation just for this test
    vi.spyOn(
      MarkdownMetadataExtractorMiddleware.prototype,
      "process",
    ).mockImplementationOnce(async (ctx, next) => {
      ctx.errors.push(new Error("fail"));
      await next();
    });

    const pipeline = new MarkdownPipeline();
    const raw: RawContent = {
      content: "# Title",
      mimeType: "text/markdown",
      charset: "utf-8",
      source: "http://test",
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    expect(result.errors.some((e) => e.message === "fail")).toBe(true);
  });

  it("process decodes Buffer content with UTF-16LE BOM", async () => {
    const pipeline = new MarkdownPipeline();
    // UTF-16LE BOM: 0xFF 0xFE, then '# Café' as UTF-16LE
    const str = "# Café";
    const buf = Buffer.alloc(2 + str.length * 2);
    buf[0] = 0xff;
    buf[1] = 0xfe;
    for (let i = 0; i < str.length; i++) {
      buf[2 + i * 2] = str.charCodeAt(i);
      buf[2 + i * 2 + 1] = 0;
    }
    const raw: RawContent = {
      content: buf,
      mimeType: "text/markdown",
      charset: "utf-16le",
      source: "http://test",
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    expect(result.textContent).toContain("# Café");
  });

  it("process decodes Buffer content with UTF-8 BOM", async () => {
    const pipeline = new MarkdownPipeline();
    // UTF-8 BOM: 0xEF 0xBB 0xBF, then '# Café'
    const utf8 = Buffer.from("# Café", "utf-8");
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8]);
    const raw: RawContent = {
      content: buf,
      mimeType: "text/markdown",
      charset: "utf-8",
      source: "http://test",
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    expect(result.textContent).toContain("# Café");
  });

  it("process decodes Buffer content with Japanese UTF-8 text", async () => {
    const pipeline = new MarkdownPipeline();
    const japanese = "# こんにちは世界"; // "Hello, world" in Japanese
    const raw: RawContent = {
      content: Buffer.from(japanese, "utf-8"),
      mimeType: "text/markdown",
      charset: "utf-8",
      source: "http://test",
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    expect(result.textContent).toContain("こんにちは世界");
  });

  it("process decodes Buffer content with Russian UTF-8 text", async () => {
    const pipeline = new MarkdownPipeline();
    const russian = "# Привет, мир"; // "Hello, world" in Russian
    const raw: RawContent = {
      content: Buffer.from(russian, "utf-8"),
      mimeType: "text/markdown",
      charset: "utf-8",
      source: "http://test",
    };
    const result = await pipeline.process(raw, {} as ScraperOptions);
    expect(result.textContent).toContain("Привет, мир");
  });

  it("should correctly process markdown through the full middleware stack (E2E with spies)", async () => {
    // Reset call counts for all spies
    vi.clearAllMocks();

    const pipeline = new MarkdownPipeline();

    // Sample markdown with elements for each middleware to process
    const markdown = `---
title: End-to-End Test
description: Testing the full markdown pipeline
---

# Main Heading

This is a paragraph with multiple [links](https://example.com/1) and another [link](https://example.com/2).

## Subheading

More content here.
`;

    const raw: RawContent = {
      content: markdown,
      mimeType: "text/markdown",
      charset: "utf-8",
      source: "http://test.example.com",
    };

    const result = await pipeline.process(raw, {
      url: "http://example.com",
      library: "example",
      version: "",
      scrapeMode: ScrapeMode.Fetch,
    });

    // Verify all middleware was called
    expect(MarkdownMetadataExtractorMiddleware.prototype.process).toHaveBeenCalledTimes(
      1,
    );
    expect(MarkdownLinkExtractorMiddleware.prototype.process).toHaveBeenCalledTimes(1);

    // Verify the result contains the original content
    // Note: Frontmatter extraction and link extraction are not implemented yet
    expect(result.textContent).toBe(markdown);

    // Verify no errors occurred
    expect(result.errors).toHaveLength(0);
  });

  describe("GreedySplitter integration - hierarchical chunking behavior", () => {
    it("should preserve hierarchical structure through GreedySplitter integration", async () => {
      const pipeline = new MarkdownPipeline();
      const markdown = `# Main Chapter

This is content under the main chapter.

## Section A

Content in section A.

### Subsection A.1

Content in subsection A.1.

## Section B

Final content in section B.`;

      const raw: RawContent = {
        content: markdown,
        mimeType: "text/markdown",
        charset: "utf-8",
        source: "http://test.example.com",
      };

      const result = await pipeline.process(raw, {
        url: "http://example.com",
        library: "example",
        version: "",
        scrapeMode: ScrapeMode.Fetch,
      });

      // Verify we got chunks with proper hierarchy
      expect(result.chunks.length).toBeGreaterThan(0);

      // GreedySplitter may merge small content into fewer chunks
      // But the hierarchy structure should still be semantically meaningful
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);

      // Check that all chunks have valid hierarchy metadata
      result.chunks.forEach((chunk) => {
        expect(chunk.section).toBeDefined();
        expect(typeof chunk.section.level).toBe("number");
        expect(Array.isArray(chunk.section.path)).toBe(true);
        expect(chunk.section.level).toBeGreaterThanOrEqual(1); // Should not degrade to 0
      });

      // Verify that headings and text are properly identified
      const hasHeadings = result.chunks.some((chunk) => chunk.types.includes("heading"));
      const hasText = result.chunks.some((chunk) => chunk.types.includes("text"));
      expect(hasHeadings || hasText).toBe(true); // Should have semantic content
    });

    it("should handle leading whitespace without creating artificial level 0 chunks", async () => {
      const pipeline = new MarkdownPipeline();
      const markdownWithLeadingWhitespace = `

  
  # First Heading

Content under first heading.

## Second Level

Content under second level.`;

      const raw: RawContent = {
        content: markdownWithLeadingWhitespace,
        mimeType: "text/markdown",
        charset: "utf-8",
        source: "http://test.example.com",
      };

      const result = await pipeline.process(raw, {
        url: "http://example.com",
        library: "example",
        version: "",
        scrapeMode: ScrapeMode.Fetch,
      });

      // Should not create separate whitespace-only chunks at level 0
      const whitespaceOnlyChunks = result.chunks.filter(
        (chunk) =>
          chunk.section.level === 0 &&
          chunk.section.path.length === 0 &&
          chunk.content.trim() === "",
      );
      expect(whitespaceOnlyChunks).toHaveLength(0);

      // First heading should be at level 1, not degraded by whitespace
      const firstHeading = result.chunks.find(
        (chunk) =>
          chunk.types.includes("heading") && chunk.content.includes("First Heading"),
      );
      expect(firstHeading).toBeDefined();
      expect(firstHeading!.section.level).toBe(1);

      // Minimum level should be 1 (not degraded to 0 by GreedySplitter)
      const minLevel = Math.min(...result.chunks.map((c) => c.section.level));
      expect(minLevel).toBe(1);
    });

    it("should maintain semantic boundaries during chunk size optimization", async () => {
      // Use much smaller chunk sizes to force GreedySplitter to split
      const pipeline = new MarkdownPipeline(50, 100);

      // Create content that will definitely exceed chunk size limits
      const longContent = Array.from(
        { length: 20 },
        (_, i) =>
          `This is a very long sentence ${i + 1} with lots of additional content to make it exceed the chunk size limits and force splitting.`,
      ).join(" ");

      const markdown = `# Large Section

${longContent}

## Subsection

${longContent}

# Another Chapter

${longContent}`;

      const raw: RawContent = {
        content: markdown,
        mimeType: "text/markdown",
        charset: "utf-8",
        source: "http://test.example.com",
      };

      const result = await pipeline.process(raw, {
        url: "http://example.com",
        library: "example",
        version: "",
        scrapeMode: ScrapeMode.Fetch,
      });

      // Should have multiple chunks due to size constraints
      expect(result.chunks.length).toBeGreaterThan(1);

      // All chunks should be within size limits
      result.chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(100);
      });

      // Should maintain hierarchy levels (not degrade to 0)
      const minLevel = Math.min(...result.chunks.map((c) => c.section.level));
      expect(minLevel).toBeGreaterThanOrEqual(1);
    });

    it("should produce chunks with correct types and hierarchy metadata", async () => {
      const pipeline = new MarkdownPipeline();
      const markdown = `# Documentation

This is introductory text.

\`\`\`javascript
console.log("Hello, world!");
\`\`\`

| Column 1 | Column 2 |
|----------|----------|
| Value 1  | Value 2  |

## Implementation

More details here.`;

      const raw: RawContent = {
        content: markdown,
        mimeType: "text/markdown",
        charset: "utf-8",
        source: "http://test.example.com",
      };

      const result = await pipeline.process(raw, {
        url: "http://example.com",
        library: "example",
        version: "",
        scrapeMode: ScrapeMode.Fetch,
      });

      // Verify we have content with semantic types (GreedySplitter may merge them)
      expect(result.chunks.length).toBeGreaterThan(0);

      // Check that we have the expected content types somewhere in the chunks
      const allTypes = new Set(result.chunks.flatMap((chunk) => chunk.types));
      expect(allTypes.has("heading") || allTypes.has("text")).toBe(true);

      // Verify all chunks have proper section metadata
      result.chunks.forEach((chunk) => {
        expect(chunk.section).toBeDefined();
        expect(typeof chunk.section.level).toBe("number");
        expect(Array.isArray(chunk.section.path)).toBe(true);
        expect(chunk.section.level).toBeGreaterThanOrEqual(1);
      });

      // Verify content is preserved (at least the key parts)
      const allContent = result.chunks.map((chunk) => chunk.content).join("");
      expect(allContent).toContain("Documentation");
      expect(allContent).toContain("Implementation");
      expect(allContent).toContain("Hello, world!");
    });

    it("should preserve semantic content structure through pipeline", async () => {
      const pipeline = new MarkdownPipeline();
      const originalMarkdown = `# Title
Paragraph with text.
## Subtitle
More content here.
\`\`\`python
print("code block")
\`\`\`
Final paragraph.`;

      const raw: RawContent = {
        content: originalMarkdown,
        mimeType: "text/markdown",
        charset: "utf-8",
        source: "http://test.example.com",
      };

      const result = await pipeline.process(raw, {
        url: "http://example.com",
        library: "example",
        version: "",
        scrapeMode: ScrapeMode.Fetch,
      });

      // Verify semantic content is preserved (may not be perfect reconstruction due to whitespace normalization)
      const allContent = result.chunks.map((chunk) => chunk.content).join("");
      expect(allContent).toContain("# Title");
      expect(allContent).toContain("## Subtitle");
      expect(allContent).toContain("Paragraph with text");
      expect(allContent).toContain("More content here");
      expect(allContent).toContain('print("code block")');
      expect(allContent).toContain("Final paragraph");

      // Verify we have semantic chunks
      expect(result.chunks.length).toBeGreaterThan(0);

      // Verify hierarchical structure is preserved
      const minLevel = Math.min(...result.chunks.map((chunk) => chunk.section.level));
      expect(minLevel).toBeGreaterThanOrEqual(1); // Should not degrade to 0
    });
  });
});
