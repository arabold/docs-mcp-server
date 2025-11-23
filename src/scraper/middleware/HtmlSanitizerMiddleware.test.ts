import * as cheerio from "cheerio"; // Import cheerio
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../utils/logger";
import type { ScraperOptions } from "../types";
import { HtmlSanitizerMiddleware } from "./HtmlSanitizerMiddleware";
import type { MiddlewareContext } from "./types";

// Suppress logger output during tests

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

const createMockContext = (
  htmlContent?: string,
  source = "http://example.com",
  options?: Partial<ScraperOptions>,
): MiddlewareContext => {
  const fullOptions = { ...createMockScraperOptions(source), ...options };
  const context: MiddlewareContext = {
    content: htmlContent || "",
    contentType: "text/html",
    source,
    links: [],
    errors: [],
    options: fullOptions,
  };
  if (htmlContent) {
    context.dom = cheerio.load(htmlContent);
  }
  return context;
};

describe("HtmlSanitizerMiddleware", () => {
  it("should remove default unwanted elements (nav, footer)", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const html = `
      <html><body>
        <nav>Navigation</nav>
        <main>Main content</main>
        <footer>Footer info</footer>
      </body></html>`;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    // Use Cheerio syntax for assertions
    expect(context.dom).toBeDefined();
    if (!context.dom) throw new Error("DOM not defined"); // Type guard
    expect(context.dom("nav").length).toBe(0); // Check element doesn't exist
    expect(context.dom("footer").length).toBe(0);
    expect(context.dom("main").text()).toBe("Main content");
    expect(context.errors).toHaveLength(0);

    // No close needed
  });

  it("should remove custom unwanted elements via excludeSelectors", async () => {
    const customSelectors = [".remove-me", "#specific-id"];
    const middleware = new HtmlSanitizerMiddleware();
    const html = `
      <html><body>
        <div class="keep-me">Keep</div>
        <div class="remove-me">Remove Class</div>
        <p id="specific-id">Remove ID</p>
        <p id="keep-id">Keep ID</p>
      </body></html>`;
    // Pass excludeSelectors via options in context creation
    const context = createMockContext(html, undefined, {
      excludeSelectors: customSelectors,
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    // Use Cheerio syntax for assertions
    expect(context.dom).toBeDefined();
    if (!context.dom) throw new Error("DOM not defined"); // Type guard
    expect(context.dom(".remove-me").length).toBe(0);
    expect(context.dom("#specific-id").length).toBe(0);
    expect(context.dom(".keep-me").length).toBe(1);
    expect(context.dom("#keep-id").length).toBe(1);
    expect(context.errors).toHaveLength(0);

    // No close needed
  });

  it("should combine default and custom selectors for removal", async () => {
    const customSelectors = [".remove-custom"];
    // Pass excludeSelectors via options in context creation AND middleware constructor
    // Note: The middleware constructor options are primarily for default behavior,
    // context options should ideally override or supplement. Let's test context options.
    const middleware = new HtmlSanitizerMiddleware(); // No constructor options here
    const html = `
      <html><body>
        <nav>Default Remove</nav>
        <div class="remove-custom">Custom Remove</div>
        <p>Keep</p>
      </body></html>`;
    const context = createMockContext(html, undefined, {
      excludeSelectors: customSelectors,
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    // Use Cheerio syntax for assertions
    expect(context.dom).toBeDefined();
    if (!context.dom) throw new Error("DOM not defined"); // Type guard
    expect(context.dom("nav").length).toBe(0);
    expect(context.dom(".remove-custom").length).toBe(0);
    expect(context.dom("p").text()).toBe("Keep");
    expect(context.errors).toHaveLength(0);

    // No close needed
  });

  it("should skip processing and warn if context.dom is missing for HTML content", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const context = createMockContext(); // No HTML content, dom is undefined
    const next = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(logger, "warn");

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("context.dom is missing"),
    );
    expect(context.errors).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it("should skip processing if content type is not HTML", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const context = createMockContext("<script>alert(1)</script>");
    const next = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(logger, "warn");

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.content).toBe("<script>alert(1)</script>"); // Content unchanged
    expect(warnSpy).not.toHaveBeenCalled(); // Should not warn if not HTML
    expect(context.errors).toHaveLength(0);

    warnSpy.mockRestore();
  });
});
