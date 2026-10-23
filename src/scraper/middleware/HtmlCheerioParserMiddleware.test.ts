import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import type { ScraperOptions } from "../types";
import { HtmlCheerioParserMiddleware } from "./HtmlCheerioParserMiddleware";
import type { MiddlewareContext } from "./types";

// The real parser, wrapped so a test can make it throw. Every HtmlPipeline
// test runs the real parser on real HTML.
vi.mock("cheerio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cheerio")>();
  return { ...actual, load: vi.fn(actual.load) };
});

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
  htmlContent: string,
  source = "http://example.com",
): MiddlewareContext => {
  return {
    content: htmlContent,
    contentType: "text/html",
    source,
    links: [],
    errors: [],
    options: createMockScraperOptions(source),
  };
};

describe("HtmlCheerioParserMiddleware", () => {
  it("should stop the chain and record the error when parsing fails", async () => {
    const cases: Array<[label: string, thrown: unknown, message: string]> = [
      ["Error", new Error("Cheerio load error"), "Cheerio load error"],
      ["non-Error", "String error", "Cheerio HTML parsing failed: String error"],
    ];

    for (const [label, thrown, message] of cases) {
      const middleware = new HtmlCheerioParserMiddleware();
      const context = createMockContext("<html><body>Test</body></html>");
      const next = vi.fn().mockResolvedValue(undefined);
      vi.mocked(cheerio.load).mockImplementationOnce(() => {
        throw thrown;
      });

      await middleware.process(context, next);

      expect.soft(next, label).not.toHaveBeenCalled();
      expect.soft(context.dom, label).toBeUndefined();
      expect.soft(context.errors, label).toHaveLength(1);
      expect.soft(context.errors[0]?.message, label).toContain(message);
    }
  });
});
