import { describe, expect, it, vi } from "vitest";
import type { ScraperOptions } from "../types";
import { MarkdownLinkExtractorMiddleware } from "./MarkdownLinkExtractorMiddleware";
import type { MiddlewareContext } from "./types";

// Suppress logger output during tests

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
  it("should initialize context.links to an empty array if it is undefined", async () => {
    const middleware = new MarkdownLinkExtractorMiddleware();
    // Create context with undefined links
    const context = createMockContext(
      "Some markdown content",
      "http://example.com",
      undefined,
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.links).toBeDefined();
    expect(Array.isArray(context.links)).toBe(true);
    expect(context.links).toHaveLength(0);
  });

  it("should not modify context.links if it is already an array", async () => {
    const middleware = new MarkdownLinkExtractorMiddleware();
    const existingLinks = ["https://example.com/link1", "https://example.com/link2"];
    const context = createMockContext(
      "Some markdown content",
      "http://example.com",
      existingLinks,
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.links).toBe(existingLinks); // Should be the same array instance
    expect(context.links).toEqual(existingLinks); // Should have the same content
  });

  it("should extract inline relative and absolute links", async () => {
    const middleware = new MarkdownLinkExtractorMiddleware();
    const context = createMockContext(
      "Read the [guide](/docs/guide) and [API](https://example.com/api).",
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(context.links).toEqual(["/docs/guide", "https://example.com/api"]);
  });

  it("should ignore image links", async () => {
    const middleware = new MarkdownLinkExtractorMiddleware();
    const context = createMockContext("![Logo](/logo.png)\n\nSee [Guide](/docs/guide).");
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(context.links).toEqual(["/docs/guide"]);
  });

  it("should ignore malformed inline links", async () => {
    const middleware = new MarkdownLinkExtractorMiddleware();
    const context = createMockContext(
      "Broken [Guide](/docs/guide and valid [API](https://example.com/api).",
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(context.links).toEqual(["https://example.com/api"]);
  });

  it("should extract reference-style links with optional titles", async () => {
    const middleware = new MarkdownLinkExtractorMiddleware();
    const context = createMockContext(`Read [Guide][guide-ref] and [API][api].

[guide-ref]: /docs/guide "Guide title"
[api]: <https://example.com/api> 'API title'
`);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(context.links).toEqual(["/docs/guide", "https://example.com/api"]);
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

  it("should always call the next middleware", async () => {
    const middleware = new MarkdownLinkExtractorMiddleware();
    // Test with null links to ensure it's handled properly
    const context = createMockContext("Some markdown content") as MiddlewareContext;
    // @ts-expect-error
    context.links = null; // Deliberately set to null to test robustness
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.links).toBeDefined();
    expect(Array.isArray(context.links)).toBe(true);
  });
});
