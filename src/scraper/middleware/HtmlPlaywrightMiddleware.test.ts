import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockedObject,
  vi,
} from "vitest";
import { ScrapeMode, type ScraperOptions } from "../types";
import {
  extractCredentialsAndOrigin,
  HtmlPlaywrightMiddleware,
  mergePlaywrightHeaders,
} from "./HtmlPlaywrightMiddleware";
import type { MiddlewareContext } from "./types";

// Suppress logger output during tests
vi.mock("../../../utils/logger");

// Mock playwright using factory functions
vi.mock("playwright", async (importOriginal) =>
  importOriginal<typeof import("playwright")>(),
);

import { type Browser, chromium, type Frame, type Page } from "playwright";

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
  return {
    content,
    source,
    metadata: {},
    links: [],
    errors: [],
    options: fullOptions,
  };
};

// Shared mock factory for Playwright page objects
const createMockPlaywrightPage = (
  contentToReturn: string,
  options: {
    iframes?: Array<{ src: string; content?: string }>;
    shouldThrow?: boolean;
    url?: string;
  } = {},
): MockedObject<Page> => {
  const { iframes = [], shouldThrow = false, url = "https://example.com" } = options;

  // Create mock iframe elements
  const mockIframes = iframes.map((iframe) => ({
    getAttribute: vi.fn().mockResolvedValue(iframe.src),
    contentFrame: vi.fn().mockResolvedValue(
      iframe.content
        ? {
            waitForSelector: vi.fn().mockResolvedValue(undefined),
            $eval: vi.fn().mockResolvedValue(iframe.content),
          }
        : null,
    ),
  }));

  return {
    route: vi.fn().mockResolvedValue(undefined),
    unroute: vi.fn().mockResolvedValue(undefined),
    goto: shouldThrow
      ? vi.fn().mockRejectedValue(new Error("Simulated navigation failure"))
      : vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(false), // Loading indicators not visible by default
    content: vi.fn().mockResolvedValue(contentToReturn),
    close: vi.fn().mockResolvedValue(undefined),
    $$: vi.fn().mockResolvedValue(mockIframes), // Return mock iframes
    evaluate: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue(url),
  } as unknown as MockedObject<Page>;
};

// Shared mock factory for browser objects
const createMockBrowser = (
  page: MockedObject<Page>,
  useContext = false,
): MockedObject<Browser> => {
  if (useContext) {
    const contextSpy = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };
    return {
      newContext: vi.fn().mockResolvedValue(contextSpy),
      isConnected: vi.fn().mockReturnValue(true),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<Browser>;
  }

  return {
    newPage: vi.fn().mockResolvedValue(page),
    isConnected: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as MockedObject<Browser>;
};

describe("HtmlPlaywrightMiddleware", () => {
  let playwrightMiddleware: HtmlPlaywrightMiddleware;

  beforeEach(() => {
    playwrightMiddleware = new HtmlPlaywrightMiddleware();
  });

  afterEach(async () => {
    // Clean up any browser instances
    // @ts-expect-error Accessing private property for testing
    if (playwrightMiddleware.browser) {
      // @ts-expect-error Accessing private property for testing
      await playwrightMiddleware.browser.close();
      // @ts-expect-error Accessing private property for testing
      playwrightMiddleware.browser = null;
    }
  });

  afterAll(async () => {
    await playwrightMiddleware.closeBrowser();
  });

  describe("Core functionality", () => {
    it("should render HTML content and call next", async () => {
      const initialHtml = "<html><body><p>Hello</p></body></html>";
      const renderedHtml = "<html><body><p>Hello Playwright!</p></body></html>";
      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      const pageSpy = createMockPlaywrightPage(renderedHtml);
      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      expect(context.errors).toHaveLength(0);
      expect(context.content).toContain("Hello Playwright!");
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });

    it("should handle errors gracefully and still call next", async () => {
      const initialHtml = "<html><body><p>Test</p></body></html>";
      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      const pageSpy = createMockPlaywrightPage(initialHtml, { shouldThrow: true });
      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0].message).toContain("Simulated navigation failure");
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });

    it("should skip processing when scrapeMode is not playwright/auto", async () => {
      const initialHtml = "<html><body><p>Test</p></body></html>";
      const context = createPipelineTestContext(initialHtml, "https://example.com/test", {
        scrapeMode: ScrapeMode.Fetch,
      });
      const next = vi.fn();

      await playwrightMiddleware.process(context, next);

      // Should not modify content and should call next
      expect(context.content).toBe(initialHtml);
      expect(context.errors).toHaveLength(0);
      expect(next).toHaveBeenCalled();
    });
  });

  describe("Authentication", () => {
    it("should support embedded credentials in URLs", async () => {
      const urlWithCreds = "https://user:password@example.com/";
      const initialHtml = "<html><body><p>Test</p></body></html>";
      const context = createPipelineTestContext(initialHtml, urlWithCreds);
      const next = vi.fn();

      const pageSpy = createMockPlaywrightPage(initialHtml, { url: urlWithCreds });
      const browserSpy = createMockBrowser(pageSpy, true); // Use context for credentials
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      expect(pageSpy.goto).toHaveBeenCalledWith(urlWithCreds, expect.any(Object));
      expect(context.errors).toHaveLength(0);
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });

    it("should forward custom headers correctly", async () => {
      const initialHtml = "<html><body><p>Test</p></body></html>";
      const context = createPipelineTestContext(initialHtml, "https://example.com/test", {
        headers: { "X-Custom-Header": "test-value" },
      });
      const next = vi.fn();

      const pageSpy = createMockPlaywrightPage(initialHtml);
      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      // Verify route handler was set up (headers are handled in route)
      expect(pageSpy.route).toHaveBeenCalledWith("**/*", expect.any(Function));
      expect(context.errors).toHaveLength(0);
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });
  });

  describe("Iframe processing", () => {
    it("should extract content from valid iframes", async () => {
      const initialHtml =
        '<html><body><iframe src="https://example.com/iframe"></iframe></body></html>';
      const iframeContent = "<p>Iframe content</p>";
      const expectedHtml = `<html><body><div>${iframeContent}</div></body></html>`;

      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      const pageSpy = createMockPlaywrightPage(expectedHtml, {
        iframes: [{ src: "https://example.com/iframe", content: iframeContent }],
      });
      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      expect(context.errors).toHaveLength(0);
      expect(pageSpy.evaluate).toHaveBeenCalled(); // iframe replacement
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });

    it("should skip invalid iframe sources", async () => {
      const initialHtml = `
        <html><body>
          <iframe src="about:blank"></iframe>
          <iframe src="data:text/html,test"></iframe>
          <iframe src="javascript:void(0)"></iframe>
          <iframe></iframe>
        </body></html>
      `;

      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      const pageSpy = createMockPlaywrightPage(initialHtml, {
        iframes: [
          { src: "about:blank" },
          { src: "data:text/html,test" },
          { src: "javascript:void(0)" },
          { src: "" }, // Empty src
        ],
      });
      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      expect(context.errors).toHaveLength(0);
      // evaluate should not be called since all iframes are skipped
      expect(pageSpy.evaluate).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });

    it("should handle iframe access errors gracefully", async () => {
      const initialHtml =
        '<html><body><iframe src="https://example.com/iframe"></iframe></body></html>';

      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      // Mock iframe that throws error during content access
      const failingIframe = {
        getAttribute: vi.fn().mockResolvedValue("https://example.com/iframe"),
        contentFrame: vi.fn().mockResolvedValue(null), // Simulate access failure
      };

      const pageSpy = createMockPlaywrightPage(initialHtml);
      pageSpy.$$ = vi.fn().mockResolvedValue([failingIframe]);

      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      expect(context.errors).toHaveLength(0); // Errors in iframe processing are logged, not added to context
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });

    it("should process multiple iframes correctly", async () => {
      const initialHtml = `
        <html><body>
          <iframe src="https://example.com/iframe1"></iframe>
          <iframe src="https://example.com/iframe2"></iframe>
          <iframe src="about:blank"></iframe>
        </body></html>
      `;

      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      const pageSpy = createMockPlaywrightPage(initialHtml, {
        iframes: [
          { src: "https://example.com/iframe1", content: "<p>Content 1</p>" },
          { src: "https://example.com/iframe2", content: "<p>Content 2</p>" },
          { src: "about:blank" }, // This should be skipped
        ],
      });
      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      expect(context.errors).toHaveLength(0);
      // evaluate should be called twice (once for each valid iframe)
      expect(pageSpy.evaluate).toHaveBeenCalledTimes(2);
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });
  });

  describe("Private method testing", () => {
    describe("shouldSkipIframeSrc", () => {
      it("should skip null/undefined src", () => {
        // @ts-expect-error Accessing private method for testing
        expect(playwrightMiddleware.shouldSkipIframeSrc(null)).toBe(true);
        // @ts-expect-error Accessing private method for testing
        expect(playwrightMiddleware.shouldSkipIframeSrc("")).toBe(true);
      });

      it("should skip about:blank", () => {
        // @ts-expect-error Accessing private method for testing
        expect(playwrightMiddleware.shouldSkipIframeSrc("about:blank")).toBe(true);
      });

      it("should skip data: URLs", () => {
        // @ts-expect-error Accessing private method for testing
        expect(playwrightMiddleware.shouldSkipIframeSrc("data:text/html,test")).toBe(
          true,
        );
      });

      it("should skip javascript: URLs", () => {
        // @ts-expect-error Accessing private method for testing
        expect(playwrightMiddleware.shouldSkipIframeSrc("javascript:void(0)")).toBe(true);
      });

      it("should allow valid HTTP/HTTPS URLs", () => {
        // @ts-expect-error Accessing private method for testing
        expect(playwrightMiddleware.shouldSkipIframeSrc("https://example.com")).toBe(
          false,
        );
        // @ts-expect-error Accessing private method for testing
        expect(playwrightMiddleware.shouldSkipIframeSrc("http://example.com")).toBe(
          false,
        );
      });
    });

    describe("extractIframeContent", () => {
      it("should extract content from frame", async () => {
        const mockFrame = {
          $eval: vi.fn().mockResolvedValue("<p>Test content</p>"),
        } as unknown as Frame;

        // @ts-expect-error Accessing private method for testing
        const content = await playwrightMiddleware.extractIframeContent(mockFrame);

        expect(content).toBe("<p>Test content</p>");
        expect(mockFrame.$eval).toHaveBeenCalledWith("body", expect.any(Function));
      });

      it("should return null on extraction error", async () => {
        const mockFrame = {
          $eval: vi.fn().mockRejectedValue(new Error("Access denied")),
        } as unknown as Frame;

        // @ts-expect-error Accessing private method for testing
        const content = await playwrightMiddleware.extractIframeContent(mockFrame);

        expect(content).toBeNull();
      });
    });

    describe("replaceIframeWithContent", () => {
      it("should call page.evaluate with correct parameters", async () => {
        const mockPage = {
          evaluate: vi.fn().mockResolvedValue(undefined),
        } as unknown as Page;

        // @ts-expect-error Accessing private method for testing
        await playwrightMiddleware.replaceIframeWithContent(
          mockPage,
          0,
          "<p>Content</p>",
        );

        expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), [
          0,
          "<p>Content</p>",
        ]);
      });
    });
  });
});

// Helper function tests (these don't need the class instance)
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
    const url = "not-a-url";
    const result = extractCredentialsAndOrigin(url);
    expect(result).toEqual({
      credentials: null,
      origin: null,
    });
  });
});

describe("mergePlaywrightHeaders", () => {
  it("merges custom headers, does not overwrite existing authorization", () => {
    const existingHeaders = { authorization: "Bearer existing" };
    const customHeaders = { "x-custom": "value" };
    const result = mergePlaywrightHeaders(existingHeaders, customHeaders);
    expect(result).toEqual({ authorization: "Bearer existing", "x-custom": "value" });
  });

  it("injects Authorization if credentials and same-origin and not already set", () => {
    const existingHeaders = {};
    const customHeaders = {};
    const credentials = { username: "user", password: "pass" };
    const origin = "https://example.com";
    const reqOrigin = "https://example.com";

    const result = mergePlaywrightHeaders(
      existingHeaders,
      customHeaders,
      credentials,
      origin,
      reqOrigin,
    );
    expect(result.Authorization).toBe("Basic dXNlcjpwYXNz");
  });

  it("does not inject Authorization if origins differ", () => {
    const existingHeaders = {};
    const customHeaders = {};
    const credentials = { username: "user", password: "pass" };
    const origin = "https://example.com";
    const reqOrigin = "https://other.com";

    const result = mergePlaywrightHeaders(
      existingHeaders,
      customHeaders,
      credentials,
      origin,
      reqOrigin,
    );
    expect(result.Authorization).toBeUndefined();
  });

  it("does not inject Authorization if already set", () => {
    const existingHeaders = { authorization: "Bearer existing" };
    const customHeaders = {};
    const credentials = { username: "user", password: "pass" };
    const origin = "https://example.com";
    const reqOrigin = "https://example.com";

    const result = mergePlaywrightHeaders(
      existingHeaders,
      customHeaders,
      credentials,
      origin,
      reqOrigin,
    );
    expect(result.authorization).toBe("Bearer existing");
  });

  it("works with no credentials and no custom headers", () => {
    const existingHeaders = { "content-type": "text/html" };
    const customHeaders = {};
    const result = mergePlaywrightHeaders(existingHeaders, customHeaders);
    expect(result).toEqual({ "content-type": "text/html" });
  });
});
