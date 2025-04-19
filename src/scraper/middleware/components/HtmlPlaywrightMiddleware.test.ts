import { type MockedObject, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { ScraperOptions } from "../../types";
import type { ContentProcessingContext } from "../types"; // Adjusted path
import { HtmlPlaywrightMiddleware } from "./HtmlPlaywrightMiddleware";

// Suppress logger output during tests
vi.mock("../../../utils/logger");

// Mock playwright and jsdom using factory functions
vi.mock("playwright", async (importOriginal) =>
  importOriginal<typeof import("playwright")>(),
);

// Mock playwright and jsdom using factory functions
vi.mock("jsdom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jsdom")>();
  return { ...actual };
});

import { type Browser, type Page, chromium } from "playwright";

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

// Helper to create a basic context for pipeline tests
const createPipelineTestContext = (
  content: string | Buffer,
  contentType: string,
  source = "http://example.com",
  options?: Partial<ScraperOptions>,
): ContentProcessingContext => {
  const fullOptions = { ...createMockScraperOptions(source), ...options };
  const context: ContentProcessingContext = {
    content,
    contentType,
    source,
    metadata: {},
    links: [],
    errors: [],
    options: fullOptions,
    // dom is added by the parser middleware or playwright middleware
  };
  return context;
};

// --- Tests for HtmlPlaywrightMiddleware ---
// Note: These tests require Playwright and a browser (Chromium) to be installed.
describe("HtmlPlaywrightMiddleware", () => {
  // Use a shared instance for tests to avoid launching browser repeatedly
  const playwrightMiddleware = new HtmlPlaywrightMiddleware();

  afterEach(() => {
    // Reset the browser instance after each test
    // This ensures a clean state for each test
    // @ts-ignore
    playwrightMiddleware.browser?.close();
    // @ts-ignore
    playwrightMiddleware.browser = null;
  });

  // Ensure browser is closed after all tests in this suite
  afterAll(async () => {
    await playwrightMiddleware.closeBrowser();
  });

  it("should render simple HTML and update context.content and context.dom", async () => {
    const initialHtml =
      "<html><head><title>Initial</title></head><body><p>Hello</p><script>document.querySelector('p').textContent = 'Hello Playwright!';</script></body></html>";
    const context = createPipelineTestContext(
      initialHtml,
      "text/html",
      // Using a unique domain helps isolate Playwright's network interception
      "https://f8b6e5ad-46ca-5934-bf4d-0409f8375e9a.com/test",
    ); // Set a source URL for the context

    // Create a pipeline with only the Playwright middleware for this test
    // We need to pass the context through the middleware directly, not a pipeline
    const next = vi.fn(); // Mock the next function
    await playwrightMiddleware.process(context, next);

    expect(context.errors).toHaveLength(0);
    // Check if content was updated by Playwright rendering the script's effect
    expect(context.content).toContain("<p>Hello Playwright!</p>");
    // Check if JSDOM parsing succeeded and populated the dom property
    expect(context.dom).toBeDefined();
    expect(context.dom?.window).toBeDefined();
    expect(context.dom?.window.document.querySelector("p")?.textContent).toBe(
      "Hello Playwright!",
    );
    // Title should still be extractable by JSDOM from the rendered content
    expect(context.dom?.window.document.title).toBe("Initial");
    // Ensure next was called if processing was successful
    expect(next).toHaveBeenCalled();
  });

  it("should handle invalid HTML without throwing unhandled errors and call next", async () => {
    const invalidHtml = "<html><body><p>Mismatched tag</div></html>";
    const context = createPipelineTestContext(
      invalidHtml,
      "text/html",
      // Using a unique domain helps isolate Playwright's network interception
      "https://f8b6e5ad-46ca-5934-bf4d-0409f8375e9a.com/test-invalid",
    );
    const next = vi.fn(); // Mock the next function
    await playwrightMiddleware.process(context, next);

    // Playwright/Browser might tolerate some errors, JSDOM might too.
    // We expect the middleware to complete, potentially with errors in the context.
    // We primarily check that *our* middleware code doesn't crash and calls next.
    expect(context.errors.length).toBeGreaterThanOrEqual(0); // Allow for parsing errors from JSDOM or warnings
    // Check if some content processing still happened
    expect(context.dom).toBeDefined(); // JSDOM likely still parsed something
    // Ensure next was called even if there were parsing errors
    expect(next).toHaveBeenCalled();
  });

  it("should skip processing for non-HTML content and call next", async () => {
    const markdown = "# Hello";
    const context = createPipelineTestContext(markdown, "text/markdown");
    const initialContent = context.content;
    const next = vi.fn();
    await playwrightMiddleware.process(context, next);

    expect(context.content).toBe(initialContent); // Content should not change
    expect(context.dom).toBeUndefined(); // DOM should not be set
    expect(context.errors).toHaveLength(0);
    expect(next).toHaveBeenCalled(); // Next should always be called
  });

  it("should add error to context if Playwright page.goto fails and call next", async () => {
    const html = "<html><body>Good</body></html>";
    const context = createPipelineTestContext(
      html,
      "text/html",
      "https://f8b6e5ad-46ca-5934-bf4d-0409f8375e9a.com/goto-fail",
    );
    const next = vi.fn();

    // Spy on page.goto and make it throw
    const pageSpy = {
      route: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockRejectedValue(new Error("Simulated navigation failure")),
      content: vi.fn(), // Doesn't matter as goto fails
      close: vi.fn().mockResolvedValue(undefined),
    } as MockedObject<Page>;
    const browserSpy = {
      newPage: vi.fn().mockResolvedValue(pageSpy),
      isConnected: vi.fn().mockReturnValue(true),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as MockedObject<Browser>;

    // Intercept launch to control the page object
    const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

    await playwrightMiddleware.process(context, next);

    expect(context.errors.length).toBeGreaterThan(0);
    expect(context.errors[0].message).toContain("Simulated navigation failure");
    expect(context.dom).toBeUndefined(); // DOM should not be set
    expect(next).toHaveBeenCalled(); // Next should still be called

    launchSpy.mockRestore(); // Restore the launch spy
  });

  it("should add error to context if JSDOM parsing fails after Playwright and not call next", async () => {
    const html = "<html><body><p>Rendered</p></body></html>";
    const renderedHtml = "<html><body>Rendered by Playwright</body></html>";
    const context = createPipelineTestContext(
      html,
      "text/html",
      "https://f8b6e5ad-46ca-5934-bf4d-0409f8375e9a.com/jsdom-fail",
    );
    const next = vi.fn();

    // Spy on page.content to return successfully, but spy on JSDOM to fail
    const pageSpy = {
      route: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(null),
      content: vi.fn().mockResolvedValue(renderedHtml),
      close: vi.fn().mockResolvedValue(undefined),
    } as MockedObject<Page>;
    const browserSpy = {
      newPage: vi.fn().mockImplementation(() => {
        return pageSpy;
      }),
      // newPage: vi.fn().mockResolvedValue(pageSpy),
      isConnected: vi.fn().mockReturnValue(true),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as MockedObject<Browser>;

    // const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy); // Use unknown cast
    const launchSpy = vi.spyOn(chromium, "launch").mockImplementation(() => {
      return Promise.resolve(browserSpy as unknown as Browser);
    });

    // Spy on JSDOM constructor to throw
    const jsdomSpy = vi.spyOn(await import("jsdom"), "JSDOM").mockImplementation(() => {
      throw new Error("Simulated JSDOM parsing error");
    });

    await playwrightMiddleware.process(context, next);

    expect(context.errors.length).toBeGreaterThan(0);
    expect(context.errors[0].message).toContain("Simulated JSDOM parsing error");
    expect(context.dom).toBeUndefined(); // DOM should not be set
    expect(next).not.toHaveBeenCalled(); // Next should NOT be called

    // Restore spies
    launchSpy.mockRestore();
    jsdomSpy.mockRestore();
  });
});
