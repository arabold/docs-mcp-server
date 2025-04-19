import type { DOMWindow } from "jsdom";
import { JSDOM } from "jsdom"; // Import JSDOM for mocking if needed
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../../utils/logger"; // Import logger for potential spy
import type { ScraperOptions } from "../../types";
import type { ContentProcessingContext } from "../types";
import { HtmlDomParserMiddleware } from "./HtmlDomParserMiddleware";

// Suppress logger output during tests
vi.mock("../../../utils/logger");

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

// Helper to create a basic context
const createMockContext = (
  content: string | Buffer,
  contentType: string,
  source = "http://example.com",
  options?: Partial<ScraperOptions>,
): ContentProcessingContext => ({
  content,
  contentType,
  source,
  metadata: {},
  links: [],
  errors: [],
  options: { ...createMockScraperOptions(source), ...options },
  // dom will be added by the middleware
});

describe("HtmlDomParserMiddleware", () => {
  it("should parse HTML string content and set context.dom", async () => {
    const middleware = new HtmlDomParserMiddleware();
    const html = "<html><head><title>Test</title></head><body><p>Hello</p></body></html>";
    const context = createMockContext(html, "text/html");
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.dom).toBeDefined();
    expect(context.dom?.document.title).toBe("Test");
    expect(context.dom?.document.body.textContent).toBe("Hello");
    expect(context.errors).toHaveLength(0);
    // No cleanup expected in this middleware anymore
    expect(context.dom).toBeDefined();

    // Manually close the window after the test if it exists, as the middleware no longer does
    context.dom?.close();
  });

  it("should parse HTML buffer content and set context.dom", async () => {
    const middleware = new HtmlDomParserMiddleware();
    const html = "<html><body>Buffer Test</body></html>";
    const buffer = Buffer.from(html, "utf-8");
    const context = createMockContext(buffer, "text/html");
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.dom).toBeDefined();
    expect(context.dom?.document.body.textContent).toBe("Buffer Test");
    expect(context.errors).toHaveLength(0);
    // No cleanup expected
    expect(context.dom).toBeDefined();

    context.dom?.close();
  });

  it("should skip processing for non-HTML content", async () => {
    const middleware = new HtmlDomParserMiddleware();
    const context = createMockContext("Just text", "text/plain");
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.dom).toBeUndefined();
    expect(context.errors).toHaveLength(0);
  });

  // Test case for JSDOM parsing errors removed as requested.

  it("should call next() even if parsing results in an empty document (JSDOM robustness)", async () => {
    // JSDOM is very robust and might parse even empty strings without throwing
    const middleware = new HtmlDomParserMiddleware();
    const html = ""; // Empty HTML
    const context = createMockContext(html, "text/html");
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware.process(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(context.dom).toBeDefined(); // JSDOM likely creates a minimal DOM
    expect(context.dom?.document.body.innerHTML).toBe("");
    expect(context.errors).toHaveLength(0);

    context.dom?.close();
  });
});
