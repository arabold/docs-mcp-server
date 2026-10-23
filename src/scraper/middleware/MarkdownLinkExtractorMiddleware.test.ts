import { describe, expect, it, vi } from "vitest";
import type { ScraperOptions } from "../types";
import { MarkdownLinkExtractorMiddleware } from "./MarkdownLinkExtractorMiddleware";
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
  initialLinks: string[] = [],
  options?: Partial<ScraperOptions>,
): MiddlewareContext => {
  return {
    content: markdownContent,
    contentType: "text/markdown",
    source,
    links: initialLinks,
    errors: [],
    options: { ...createMockScraperOptions(source), ...options },
  };
};

describe("MarkdownLinkExtractorMiddleware", () => {
  it("should extract inline and reference-style links but not images or malformed links", async () => {
    const cases: Array<[label: string, markdown: string, links: string[]]> = [
      [
        "inline relative and absolute",
        "Read the [guide](/docs/guide) and [API](https://example.com/api).",
        ["/docs/guide", "https://example.com/api"],
      ],
      ["image", "![Logo](/logo.png)\n\nSee [Guide](/docs/guide).", ["/docs/guide"]],
      [
        "malformed inline",
        "Broken [Guide](/docs/guide and valid [API](https://example.com/api).",
        ["https://example.com/api"],
      ],
      [
        "reference-style with optional titles",
        `Read [Guide][guide-ref] and [API][api].

[guide-ref]: /docs/guide "Guide title"
[api]: <https://example.com/api> 'API title'
`,
        ["/docs/guide", "https://example.com/api"],
      ],
    ];

    for (const [label, markdown, links] of cases) {
      const middleware = new MarkdownLinkExtractorMiddleware();
      const context = createMockContext(markdown);
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware.process(context, next);

      expect.soft(context.links, label).toEqual(links);
      expect.soft(next, label).toHaveBeenCalledOnce();
    }
  });

  it("should dedupe links while preserving first-seen order", async () => {
    const middleware = new MarkdownLinkExtractorMiddleware();
    const context = createMockContext(
      `Existing [Guide](/docs/guide).
Again [Guide](/docs/guide).
Reference [API][api].
[api]: https://example.com/api
Again [API][api].
`,
      "http://example.com",
      ["https://example.com/existing", "/docs/guide"],
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(context.links).toEqual([
      "https://example.com/existing",
      "/docs/guide",
      "https://example.com/api",
    ]);
  });
});
