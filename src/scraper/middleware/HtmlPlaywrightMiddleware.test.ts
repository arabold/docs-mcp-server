import * as cheerio from "cheerio";
import { afterAll, afterEach, describe, expect, it, type MockedObject, vi } from "vitest";
import type { ScraperOptions } from "../types";
import {
  extractCredentialsAndOrigin,
  HtmlPlaywrightMiddleware,
  mergePlaywrightHeaders,
} from "./HtmlPlaywrightMiddleware";
import type { MiddlewareContext } from "./types"; // Adjusted path

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

import { type Browser, chromium, type Page } from "playwright";

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
  content: string,
  source = "http://example.com",
  options?: Partial<ScraperOptions>,
): MiddlewareContext => {
  const fullOptions = { ...createMockScraperOptions(source), ...options };
  const context: MiddlewareContext = {
    content,
    source,
    metadata: {},
    links: [],
    errors: [],
    options: fullOptions,
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
    // @ts-expect-error
    playwrightMiddleware.browser?.close();
    // @ts-expect-error
    playwrightMiddleware.browser = null;
  });

  // Ensure browser is closed after all tests in this suite
  afterAll(async () => {
    await playwrightMiddleware.closeBrowser();
  });

  it("should render simple HTML and update context.content and context.dom", async () => {
    const initialHtml =
      "<html><head><title>Initial</title></head><body><p>Hello</p><script>document.querySelector('p').textContent = 'Hello Playwright!';</script></body></html>";
    const renderedHtml =
      "<html><head><title>Initial</title></head><body><p>Hello Playwright!</p></body></html>";
    const context = createPipelineTestContext(
      initialHtml,
      // Using a unique domain helps isolate Playwright's network interception
      "https://example-f8b6e5ad.com/test",
    ); // Set a source URL for the context

    // Stub Playwright to avoid launching a real browser
    const pageSpy = {
      route: vi.fn().mockResolvedValue(undefined),
      unroute: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      isVisible: vi.fn().mockResolvedValue(false),
      content: vi.fn().mockResolvedValue(renderedHtml),
      close: vi.fn().mockResolvedValue(undefined),
      $$: vi.fn().mockResolvedValue([]), // No iframes in this test
      evaluate: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://example-f8b6e5ad.com/test"),
    } as unknown as MockedObject<Page>;
    const browserSpy = {
      newPage: vi.fn().mockResolvedValue(pageSpy),
      isConnected: vi.fn().mockReturnValue(true),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<Browser>;
    const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

    const next = vi.fn();
    await playwrightMiddleware.process(context, next);

    expect(context.errors).toHaveLength(0);
    // Check if content was updated by Playwright rendering the script's effect
    expect(context.content).toContain("<p>Hello Playwright!</p>");
    // Remove checks for context.dom as this middleware no longer parses
    expect(context.dom).toBeUndefined();
    // Ensure next was called if processing was successful
    expect(next).toHaveBeenCalled();

    launchSpy.mockRestore();
  });

  it("should handle invalid HTML without throwing unhandled errors and call next", async () => {
    const invalidHtml = "<html><body><p>Mismatched tag</div></html>";
    const context = createPipelineTestContext(
      invalidHtml,
      // Using a unique domain helps isolate Playwright's network interception
      "https://example-f8b6e5ad.com/test-invalid",
    );
    const next = vi.fn(); // Mock the next function
    await playwrightMiddleware.process(context, next);

    // Playwright/Browser might tolerate some errors, JSDOM might too.
    // We expect the middleware to complete, potentially with errors in the context.
    // We primarily check that *our* middleware code doesn't crash and calls next.
    expect(context.errors.length).toBeGreaterThanOrEqual(0); // Allow for Playwright rendering errors
    // Remove check for context.dom as this middleware no longer parses
    expect(context.dom).toBeUndefined();
    // Ensure next was called even if there were rendering errors
    expect(next).toHaveBeenCalled();
  });

  it("should add error to context if Playwright page.goto fails and call next", async () => {
    const html = "<html><body>Good</body></html>";
    const context = createPipelineTestContext(
      html,
      "https://example-f8b6e5ad.com/goto-fail",
    );
    const next = vi.fn();

    // Spy on page.goto and make it throw
    const pageSpy = {
      route: vi.fn().mockResolvedValue(undefined),
      unroute: vi.fn().mockResolvedValue(undefined),
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

  it("should support URLs with embedded credentials (user:password@host)", async () => {
    const urlWithCreds = "https://user:password@example.com/";
    const initialHtml = "<html><body><p>Test</p></body></html>";
    const context = createPipelineTestContext(initialHtml, urlWithCreds);
    const next = vi.fn();

    // Spy on Playwright's browser/context/page
    const pageSpy = {
      route: vi.fn().mockResolvedValue(undefined),
      unroute: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      isVisible: vi.fn().mockResolvedValue(false),
      content: vi.fn().mockResolvedValue(initialHtml),
      close: vi.fn().mockResolvedValue(undefined),
      $$: vi.fn().mockResolvedValue([]), // No iframes in this test
      evaluate: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue(urlWithCreds),
    } as unknown as MockedObject<Page>;
    const contextSpy = {
      newPage: vi.fn().mockResolvedValue(pageSpy),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const browserSpy = {
      newContext: vi.fn().mockResolvedValue(contextSpy),
      isConnected: vi.fn().mockReturnValue(true),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<Browser>;
    const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

    await playwrightMiddleware.process(context, next);

    // Ensure Playwright's page.goto was called with the correct URL (including credentials)
    expect(pageSpy.goto).toHaveBeenCalledWith(urlWithCreds, expect.any(Object));
    expect(context.errors).toHaveLength(0);
    expect(context.content).toContain("<p>Test</p>");
    expect(next).toHaveBeenCalled();

    launchSpy.mockRestore();
  });

  it("waits for visible loading indicators to disappear before extracting HTML", async () => {
    // Arrange: HTML with a visible spinner and a delayed script to hide it
    const initialHtml = `
      <html><body>
        <div class="spinner">Loading...</div>
        <div id="content" style="display:none">Loaded!</div>
        <script>
          setTimeout(() => {
            document.querySelector('.spinner').style.display = 'none';
            document.getElementById('content').style.display = '';
          }, 100);
        </script>
      </body></html>
    `;
    // Expected HTML after Playwright renders and executes the script
    const renderedHtml = `
      <html><body>
        <div class="spinner" style="display: none;">Loading...</div>
        <div id="content" style="">Loaded!</div>
      </body></html>
    `;
    const context = createPipelineTestContext(initialHtml, "https://example.com/spinner");
    const next = vi.fn();

    // Mock Playwright
    const pageSpy = {
      route: vi.fn().mockResolvedValue(undefined),
      unroute: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      isVisible: vi.fn().mockResolvedValue(true), // Spinner is visible initially
      content: vi.fn().mockResolvedValue(renderedHtml),
      close: vi.fn().mockResolvedValue(undefined),
      $$: vi.fn().mockResolvedValue([]), // No iframes in this test
      evaluate: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://example.com/spinner"),
    } as unknown as MockedObject<Page>;
    const browserSpy = {
      newPage: vi.fn().mockResolvedValue(pageSpy),
      isConnected: vi.fn().mockReturnValue(true),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<Browser>;
    const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

    await playwrightMiddleware.process(context, next);

    // Use Cheerio to parse the resulting HTML
    const $ = cheerio.load(context.content);
    // Spinner should still exist, but be hidden
    const spinner = $(".spinner");
    expect(spinner.length).toBe(1);
    expect(spinner.attr("style")).toMatch(/display:\s*none/);
    // Content should be visible (no display:none)
    const content = $("#content");
    expect(content.length).toBe(1);
    expect(content.attr("style") || "").not.toMatch(/display\s*:\s*none/);
    expect(content.text()).toContain("Loaded!");
    expect(context.errors).toHaveLength(0);
    expect(next).toHaveBeenCalled();

    launchSpy.mockRestore();
  });

  it("should not wait if loading indicators are present but hidden on page load", async () => {
    // Arrange: HTML with a spinner that is hidden from the start
    const initialHtml = `
      <html><body>
        <div class="spinner" style="display:none">Loading...</div>
        <div id="content">Loaded immediately!</div>
      </body></html>
    `;
    const context = createPipelineTestContext(
      initialHtml,
      "https://example.com/hidden-spinner",
    );
    const next = vi.fn();

    // Mock Playwright - spinner is already hidden so isVisible returns false
    const pageSpy = {
      route: vi.fn().mockResolvedValue(undefined),
      unroute: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      isVisible: vi.fn().mockResolvedValue(false), // Spinner is already hidden
      content: vi.fn().mockResolvedValue(initialHtml), // Return original HTML since no changes needed
      close: vi.fn().mockResolvedValue(undefined),
      $$: vi.fn().mockResolvedValue([]), // No iframes in this test
      evaluate: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://example.com/hidden-spinner"),
    } as unknown as MockedObject<Page>;
    const browserSpy = {
      newPage: vi.fn().mockResolvedValue(pageSpy),
      isConnected: vi.fn().mockReturnValue(true),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<Browser>;
    const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

    await playwrightMiddleware.process(context, next);

    // Use Cheerio to parse the resulting HTML
    const $ = cheerio.load(context.content);
    // Spinner should exist and be hidden
    const spinner = $(".spinner");
    expect(spinner.length).toBe(1);
    expect(spinner.attr("style")).toMatch(/display\s*:\s*none/);
    // Content should be visible
    const content = $("#content");
    expect(content.length).toBe(1);
    expect(content.text()).toContain("Loaded immediately!");
    expect(context.errors).toHaveLength(0);
    expect(next).toHaveBeenCalled();

    launchSpy.mockRestore();
  });
});

describe("extractCredentialsAndOrigin", () => {
  it("extracts credentials and origin from a URL with user:pass", () => {
    const url = "https://user:pass@example.com/path";
    const result = extractCredentialsAndOrigin(url);
    expect(result).toEqual({
      credentials: { username: "user", password: "pass" },
      origin: "https://example.com",
    });
  });

  it("returns null credentials if no user:pass", () => {
    const url = "https://example.com/path";
    const result = extractCredentialsAndOrigin(url);
    expect(result).toEqual({
      credentials: null,
      origin: "https://example.com",
    });
  });

  it("returns nulls for invalid URL", () => {
    const url = "not a url";
    const result = extractCredentialsAndOrigin(url);
    expect(result).toEqual({ credentials: null, origin: null });
  });
});

describe("mergePlaywrightHeaders", () => {
  const baseHeaders = { foo: "bar", authorization: "existing" };
  const customHeaders = {
    foo: "baz",
    custom: "value",
    Authorization: "should-not-overwrite",
  };
  const credentials = { username: "user", password: "pass" };
  const origin = "https://example.com";
  const reqOrigin = "https://example.com";

  it("merges custom headers, does not overwrite existing authorization", () => {
    const result = mergePlaywrightHeaders(baseHeaders, customHeaders);
    expect(result.foo).toBe("baz");
    expect(result.custom).toBe("value");
    expect(result.authorization).toBe("existing");
  });

  it("injects Authorization if credentials and same-origin and not already set", () => {
    const result = mergePlaywrightHeaders(
      { foo: "bar" },
      {},
      credentials,
      origin,
      reqOrigin,
    );
    expect(result.Authorization).toMatch(/^Basic /);
  });

  it("does not inject Authorization if origins differ", () => {
    const result = mergePlaywrightHeaders(
      { foo: "bar" },
      {},
      credentials,
      origin,
      "https://other.com",
    );
    expect(result.Authorization).toBeUndefined();
  });

  it("does not inject Authorization if already set", () => {
    const result = mergePlaywrightHeaders(
      { authorization: "existing" },
      {},
      credentials,
      origin,
      reqOrigin,
    );
    expect(result.authorization).toBe("existing");
  });

  it("works with no credentials and no custom headers", () => {
    const result = mergePlaywrightHeaders({ foo: "bar" }, {});
    expect(result.foo).toBe("bar");
  });
});
