import { describe, expect, it, vi } from "vitest";
import type { ScraperOptions } from "../types";
import { MarkdownMetadataExtractorMiddleware } from "./MarkdownMetadataExtractorMiddleware";
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
  markdownContent: string,
  source = "http://example.com",
  options?: Partial<ScraperOptions>,
): MiddlewareContext => {
  return {
    content: markdownContent,
    contentType: "text/markdown",
    source,
    links: [],
    errors: [],
    options: { ...createMockScraperOptions(source), ...options },
  };
};

describe("MarkdownMetadataExtractorMiddleware", () => {
  it("should take the title from frontmatter, then the first H1, then 'Untitled'", async () => {
    const cases: Array<[label: string, markdown: string, title: string]> = [
      ["first H1", "# My Title\n\nSome content here.", "My Title"],
      ["no H1", "Some content without any headings.", "Untitled"],
      [
        "H1 with surrounding spaces",
        "#   My Spaced Title  \n\nContent follows.",
        "My Spaced Title",
      ],
      ["several H1s", "# First Title\nSome text\n# Second Title", "First Title"],
      ["empty content", "", "Untitled"],
      [
        "H1 after other text",
        "Some intro text.\n\n# The Actual Title\n\nMore text.",
        "The Actual Title",
      ],
      [
        "frontmatter title",
        "---\ntitle: Frontmatter Title\n---\n# H1 Title",
        "Frontmatter Title",
      ],
      [
        "frontmatter title over H1",
        "---\ntitle: Correct Title\n---\n# Wrong Title",
        "Correct Title",
      ],
      [
        "frontmatter without a title",
        "---\nauthor: Someone\n---\n# Backup Title",
        "Backup Title",
      ],
      ["numeric frontmatter title", "---\ntitle: 12345\n---\n# Backup Title", "12345"],
      [
        "whitespace frontmatter title",
        '---\ntitle: "   "\n---\n# Backup Title',
        "Backup Title",
      ],
      // Malformed YAML falls back to the H1 without an error.
      [
        "malformed frontmatter",
        "---\ntitle: : bad yaml\n---\n# Backup Title",
        "Backup Title",
      ],
    ];

    for (const [label, markdown, title] of cases) {
      const middleware = new MarkdownMetadataExtractorMiddleware();
      const context = createMockContext(markdown);
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware.process(context, next);

      expect.soft(context.title, label).toBe(title);
      expect.soft(context.errors, label).toHaveLength(0);
      expect.soft(next, label).toHaveBeenCalledOnce();
    }
  });
});
