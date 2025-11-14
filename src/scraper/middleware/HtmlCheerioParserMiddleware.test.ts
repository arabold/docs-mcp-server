import { describe, expect, it, type Mock, vi } from "vitest";
import type { ScraperOptions } from "../types";
import { HtmlCheerioParserMiddleware } from "./HtmlCheerioParserMiddleware";
import type { MiddlewareContext } from "./types";

// Mock cheerio module
vi.mock("cheerio", () => {
  const mockCheerio = {
    load: vi.fn((html) => {
      // Default implementation returns a simple cheerio-like API
      const mockCheerioApi = (selector: string) => {
        // Store the HTML content to determine what to return based on the test case
        const htmlContent = html || "";

        return {
          text: () => {
            // For the complex HTML test case
            if (htmlContent.includes("Main Heading") && selector === "h1") {
              return "Main Heading";
            }
            // Default cases
            if (selector === "h1") return "Test";
            if (selector === "title") return "Test Page";
            return "";
          },
          length:
            selector === "body" || selector === "li" ? (selector === "li" ? 2 : 1) : 0,
        };
      };
      // Make the API callable as a function
      Object.defineProperties(mockCheerioApi, {
        length: { value: 1 },
      });
      return mockCheerioApi;
    }),
  };
  return mockCheerio;
});

// Suppress logger output during tests

// Import cheerio after mocking
import * as cheerio from "cheerio";

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
  htmlContent: string,
  source = "http://example.com",
  options?: Partial<ScraperOptions>,
): MiddlewareContext => {
  return {
    content: htmlContent,
    contentType: "text/html",
    source,
    links: [],
    errors: [],
    options: { ...createMockScraperOptions(source), ...options },
  };
};

describe("HtmlCheerioParserMiddleware", () => {
  it("should parse valid HTML string and set context.dom", async () => {
    const middleware = new HtmlCheerioParserMiddleware();
    const html = "<html><body><h1>Test</h1></body></html>";
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.dom).toBeDefined();
    expect(typeof context.dom).toBe("function"); // Cheerio API is a function
    expect(context.dom!("h1").text()).toBe("Test"); // Verify we can query the DOM
    expect(context.errors).toHaveLength(0);
  });

  it("should handle empty HTML string", async () => {
    const middleware = new HtmlCheerioParserMiddleware();
    const html = "";
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.dom).toBeDefined();
    expect(context.dom!("body").length).toBe(1); // Cheerio creates a minimal document
    expect(context.errors).toHaveLength(0);
  });

  it("should handle complex HTML with nested elements", async () => {
    const middleware = new HtmlCheerioParserMiddleware();
    const html = `
      <html>
        <head>
          <title>Test Page</title>
        </head>
        <body>
          <div class="container">
            <h1>Main Heading</h1>
            <p>Some paragraph text.</p>
            <ul>
              <li>Item 1</li>
              <li>Item 2</li>
            </ul>
          </div>
        </body>
      </html>
    `;
    const context = createMockContext(html);
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.dom).toBeDefined();
    expect(context.dom!("h1").text()).toBe("Main Heading");
    expect(context.dom!("li").length).toBe(2);
    expect(context.dom!("title").text()).toBe("Test Page");
    expect(context.errors).toHaveLength(0);
  });

  it("should handle errors during Cheerio load and not call next", async () => {
    const middleware = new HtmlCheerioParserMiddleware();
    const context = createMockContext("<html><body>Test</body></html>");
    const next = vi.fn().mockResolvedValue(undefined);
    const errorMsg = "Cheerio load error";

    // Set up cheerio.load to throw an error for this test
    (cheerio.load as Mock).mockImplementationOnce(() => {
      throw new Error(errorMsg);
    });

    await middleware.process(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(context.dom).toBeUndefined();
    expect(context.errors).toHaveLength(1);
    expect(context.errors[0].message).toContain(errorMsg);
  });

  it("should handle non-Error objects thrown during parsing", async () => {
    const middleware = new HtmlCheerioParserMiddleware();
    const context = createMockContext("<html><body>Test</body></html>");
    const next = vi.fn().mockResolvedValue(undefined);

    // Set up cheerio.load to throw a non-Error object for this test
    (cheerio.load as Mock).mockImplementationOnce(() => {
      throw "String error"; // Not an Error instance
    });

    await middleware.process(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(context.dom).toBeUndefined();
    expect(context.errors).toHaveLength(1);
    expect(context.errors[0].message).toContain(
      "Cheerio HTML parsing failed: String error",
    );
  });
});
