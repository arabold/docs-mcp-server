import { describe, expect, it } from "vitest";
import { loadConfig } from "../../utils/config";
import { FetchStatus, type RawContent } from "../fetcher/types";
import { ScrapeMode, type ScraperOptions } from "../types";
import { MarkdownPipeline } from "./MarkdownPipeline";

describe("MarkdownPipeline", () => {
  const appConfig = loadConfig();
  const options: ScraperOptions = {
    url: "http://example.com",
    library: "example",
    version: "",
    scrapeMode: ScrapeMode.Fetch,
  };

  function markdown(content: string | Buffer, charset?: string): RawContent {
    return {
      content,
      mimeType: "text/markdown",
      charset,
      source: "http://test",
      status: FetchStatus.SUCCESS,
    };
  }

  it("decodes the body with the header charset, a BOM or UTF-8", async () => {
    const cases: Array<
      [
        label: string,
        content: string | Buffer,
        charset: string | undefined,
        expected: string,
      ]
    > = [
      [
        "UTF-8",
        Buffer.from("# Header\n\nThis is a test.", "utf-8"),
        "utf-8",
        "# Header\n\nThis is a test.",
      ],
      ["ISO-8859-1", Buffer.from("# Café", "latin1"), "iso-8859-1", "# Café"],
      [
        "no charset as UTF-8",
        Buffer.from("# Default UTF-8\n\nContent", "utf-8"),
        undefined,
        "# Default UTF-8\n\nContent",
      ],
      [
        "a string as is",
        "# Title\n\nContent with [link](https://example.com)",
        "utf-8",
        "# Title\n\nContent with [link](https://example.com)",
      ],
      [
        "a UTF-16LE BOM",
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("# Café", "utf16le")]),
        "utf-16le",
        "# Café",
      ],
      [
        "a UTF-8 BOM",
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# Café", "utf-8")]),
        "utf-8",
        "# Café",
      ],
      [
        "Japanese UTF-8",
        Buffer.from("# こんにちは世界", "utf-8"),
        "utf-8",
        "# こんにちは世界",
      ],
      ["Russian UTF-8", Buffer.from("# Привет, мир", "utf-8"), "utf-8", "# Привет, мир"],
    ];
    const pipeline = new MarkdownPipeline(appConfig);

    for (const [label, content, charset, expected] of cases) {
      const result = await pipeline.process(markdown(content, charset), options);

      expect.soft(result.textContent, label).toBe(expected);
    }
  });

  it("returns the frontmatter title, the links and the unchanged Markdown", async () => {
    const pipeline = new MarkdownPipeline(appConfig);
    const content = `---
title: Test Document
author: Test Author
---

# Heading

This is a paragraph with a [link](https://test.example.com).
`;

    const result = await pipeline.process(markdown(content, "utf-8"), options);

    expect(result.title).toBe("Test Document");
    expect(result.links).toContain("https://test.example.com");
    expect(result.textContent).toBe(content);
    expect(result.errors).toEqual([]);
  });

  describe("GreedySplitter integration - hierarchical chunking behavior", () => {
    it("should split Markdown into chunks that keep its content and heading levels", async () => {
      const cases: Array<{ label: string; content: string; expected: string[] }> = [
        {
          label: "nested sections",
          content: `# Main Chapter

This is content under the main chapter.

## Section A

Content in section A.

### Subsection A.1

Content in subsection A.1.

## Section B

Final content in section B.`,
          expected: [
            "Main Chapter",
            "Content in section A.",
            "Content in subsection A.1.",
            "Final content in section B.",
          ],
        },
        {
          label: "code and table blocks",
          content: `# Documentation

This is introductory text.

\`\`\`javascript
console.log("Hello, world!");
\`\`\`

| Column 1 | Column 2 |
|----------|----------|
| Value 1  | Value 2  |

## Implementation

More details here.`,
          expected: ["Documentation", "Implementation", "Hello, world!", "| Value 1"],
        },
        {
          label: "headings without blank lines",
          content: `# Title
Paragraph with text.
## Subtitle
More content here.
\`\`\`python
print("code block")
\`\`\`
Final paragraph.`,
          expected: [
            "# Title",
            "## Subtitle",
            "Paragraph with text",
            "More content here",
            'print("code block")',
            "Final paragraph",
          ],
        },
      ];
      const pipeline = new MarkdownPipeline(appConfig);

      for (const { label, content, expected } of cases) {
        const result = await pipeline.process(
          { ...markdown(content, "utf-8"), source: "http://test.example.com" },
          options,
        );

        const chunks = result.chunks ?? [];
        expect.soft(chunks.length, label).toBeGreaterThan(0);
        // Every chunk keeps a heading level; none degrades to 0.
        expect
          .soft(Math.min(...chunks.map((chunk) => chunk.section.level)), label)
          .toBeGreaterThanOrEqual(1);
        const allContent = chunks.map((chunk) => chunk.content).join("");
        for (const text of expected) {
          expect.soft(allContent, label).toContain(text);
        }
      }
    });

    it("should handle leading whitespace without creating artificial level 0 chunks", async () => {
      const pipeline = new MarkdownPipeline(appConfig);
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
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(raw, {
        url: "http://example.com",
        library: "example",
        version: "",
        scrapeMode: ScrapeMode.Fetch,
      });

      // Should not create separate whitespace-only chunks at level 0
      const whitespaceOnlyChunks = result.chunks?.filter(
        (chunk) =>
          chunk.section.level === 0 &&
          chunk.section.path.length === 0 &&
          chunk.content.trim() === "",
      );
      expect(whitespaceOnlyChunks).toHaveLength(0);

      // First heading should be at level 1, not degraded by whitespace
      const firstHeading = result.chunks?.find(
        (chunk) =>
          chunk.types.includes("heading") && chunk.content.includes("First Heading"),
      );
      expect(firstHeading).toBeDefined();
      expect(firstHeading?.section.level).toBe(1);

      // Minimum level should be 1 (not degraded to 0 by GreedySplitter)
      const minLevel = Math.min(...(result.chunks ?? []).map((c) => c.section.level));
      expect(minLevel).toBe(1);
    });

    it("should maintain semantic boundaries during chunk size optimization", async () => {
      // Use much smaller chunk sizes to force GreedySplitter to split
      const customConfig = JSON.parse(JSON.stringify(appConfig));
      customConfig.splitter.preferredChunkSize = 50;
      customConfig.splitter.maxChunkSize = 100;
      const pipeline = new MarkdownPipeline(customConfig);

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
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(raw, {
        url: "http://example.com",
        library: "example",
        version: "",
        scrapeMode: ScrapeMode.Fetch,
      });

      // Should have multiple chunks due to size constraints
      expect(result.chunks?.length).toBeGreaterThan(1);

      // All chunks should be within size limits
      result.chunks?.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(100);
      });

      // Should maintain hierarchy levels (not degrade to 0)
      const minLevel = Math.min(...(result.chunks ?? []).map((c) => c.section.level));
      expect(minLevel).toBeGreaterThanOrEqual(1);
    });

    it("indexes the real frontmatter text, not the literal string 'undefined'", async () => {
      // Regression for #503: the metadata middleware parses the content before the
      // splitter does, and gray-matter's cache returns a copy without its raw `matter`
      // property on that second parse.
      const pipeline = new MarkdownPipeline(appConfig);
      const raw: RawContent = {
        content: `---\nurl: /guide/ssr.md\n---\n# Server-Side Rendering (SSR)\n\nSome body text.`,
        mimeType: "text/markdown",
        charset: "utf-8",
        source: "https://vite.dev/guide/ssr.md",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(raw, {
        url: "https://vite.dev/guide/ssr.md",
        library: "vite",
        version: "",
        scrapeMode: ScrapeMode.Fetch,
      });

      const allContent = result.chunks?.map((chunk) => chunk.content).join("\n") ?? "";
      expect(allContent).toContain("url: /guide/ssr.md");
      expect(allContent).not.toContain("undefined");
    });
  });
});
