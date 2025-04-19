import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../../utils/logger";
import type { ScraperOptions } from "../../types";
import type { ContentProcessingContext } from "../types";
import { HtmlSanitizerMiddleware } from "./HtmlSanitizerMiddleware";

// Suppress logger output during tests
vi.mock("../../../utils/logger");

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

// Helper to create a basic context, optionally with a pre-populated DOM
const createMockContext = (
  contentType: string,
  htmlContent?: string, // Optional HTML to create a DOM from
  source = "http://example.com",
  options?: Partial<ScraperOptions>,
): ContentProcessingContext => {
  const fullOptions = { ...createMockScraperOptions(source), ...options };
  const context: ContentProcessingContext = {
    content: htmlContent || (contentType === "text/html" ? "" : "non-html"),
    contentType,
    source,
    metadata: {},
    links: [],
    errors: [],
    options: fullOptions,
  };
  if (htmlContent && contentType.startsWith("text/html")) {
    context.dom = new JSDOM(htmlContent, { url: source }).window;
  }
  return context;
};

describe("HtmlSanitizerMiddleware", () => {
  it("should sanitize HTML content (remove script, onclick)", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const html = `
      <html><body>
        <p>Safe content</p>
        <script>alert('XSS')</script>
        <button onclick="alert('danger')">Click Me</button>
      </body></html>`;
    const context = createMockContext("text/html", html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.dom?.document.body.innerHTML).not.toContain("<script");
    expect(context.dom?.document.body.innerHTML).not.toContain("onclick");
    expect(context.dom?.document.body.querySelector("p")?.textContent).toBe(
      "Safe content",
    );
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
  });

  it("should remove default unwanted elements (nav, footer)", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const html = `
      <html><body>
        <nav>Navigation</nav>
        <main>Main content</main>
        <footer>Footer info</footer>
      </body></html>`;
    const context = createMockContext("text/html", html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.dom?.document.querySelector("nav")).toBeNull();
    expect(context.dom?.document.querySelector("footer")).toBeNull();
    expect(context.dom?.document.querySelector("main")?.textContent).toBe("Main content");
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
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
    const context = createMockContext("text/html", html, undefined, {
      excludeSelectors: customSelectors,
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.dom?.document.querySelector(".remove-me")).toBeNull();
    expect(context.dom?.document.querySelector("#specific-id")).toBeNull();
    expect(context.dom?.document.querySelector(".keep-me")).not.toBeNull();
    expect(context.dom?.document.querySelector("#keep-id")).not.toBeNull();
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
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
    const context = createMockContext("text/html", html, undefined, {
      excludeSelectors: customSelectors,
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.dom?.document.querySelector("nav")).toBeNull();
    expect(context.dom?.document.querySelector(".remove-custom")).toBeNull();
    expect(context.dom?.document.querySelector("p")?.textContent).toBe("Keep");
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
  });

  it("should skip processing and warn if context.dom is missing for HTML content", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const context = createMockContext("text/html"); // No HTML content, dom is undefined
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
    const context = createMockContext("text/plain", "<script>alert(1)</script>");
    const next = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(logger, "warn");

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.content).toBe("<script>alert(1)</script>"); // Content unchanged
    expect(warnSpy).not.toHaveBeenCalled(); // Should not warn if not HTML
    expect(context.errors).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it("should handle errors during sanitization/removal", async () => {
    const middleware = new HtmlSanitizerMiddleware();
    const html = "<html><body><p>Content</p></body></html>";
    const context = createMockContext("text/html", html);
    const next = vi.fn().mockResolvedValue(undefined);
    const errorMsg = "Invalid selector";
    const invalidSelector = "[invalid-selector]"; // Use a specific invalid selector for the mock

    // Mock querySelectorAll to throw only for the specific invalid selector
    const originalQuerySelectorAll = context.dom?.document.body.querySelectorAll;
    if (context.dom) {
      context.dom.document.body.querySelectorAll = vi
        .fn()
        .mockImplementation((selector: string) => {
          if (selector === invalidSelector) {
            throw new Error(errorMsg); // Throw only for the bad selector
          }
          // For other selectors, return an empty NodeList (or mock actual elements if needed)
          return context.dom?.document
            .createDocumentFragment()
            .querySelectorAll(selector);
        });
    }

    // Add the invalid selector to the context options to ensure it's processed
    context.options.excludeSelectors = [invalidSelector];

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce(); // Should still call next
    expect(context.errors).toHaveLength(1);
    // Check that the error message includes the specific invalid selector
    expect(context.errors[0].message).toContain(`Invalid selector "${invalidSelector}"`);
    expect(context.errors[0].message).toContain(errorMsg);

    // Restore the original querySelectorAll if mocked
    if (context.dom && originalQuerySelectorAll) {
      context.dom.document.body.querySelectorAll = originalQuerySelectorAll;
    }
    context.dom?.close();
  });
});
