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

// Mock playwright using factory functions
vi.mock("playwright", async () =>
  vi.importActual<typeof import("playwright")>("playwright"),
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
    contentType: "text/html",
    source,
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
    addInitScript: vi.fn().mockResolvedValue(undefined), // Added for shadow DOM support
    waitForTimeout: vi.fn().mockResolvedValue(undefined), // Added for shadow DOM support
    evaluate: vi.fn().mockImplementation((fn: any) => {
      // Mock shadow DOM extraction result
      if (
        typeof fn === "function" ||
        (typeof fn === "string" && fn.includes("shadowExtractor"))
      ) {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    }),
    url: vi.fn().mockReturnValue(url),
    context: vi.fn().mockReturnValue({
      newPage: vi.fn().mockResolvedValue({
        route: vi.fn().mockResolvedValue(undefined),
        unroute: vi.fn().mockResolvedValue(undefined),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        $eval: vi.fn().mockResolvedValue("<p>Frame content</p>"),
        close: vi.fn().mockResolvedValue(undefined),
        addInitScript: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        evaluate: vi
          .fn()
          .mockResolvedValue({ method: "standard", content: "<p>Frame content</p>" }),
        content: vi.fn().mockResolvedValue("<p>Frame content</p>"),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  } as unknown as MockedObject<Page>;
};

// Shared mock factory for browser objects
const createMockBrowser = (
  page: MockedObject<Page>,
  useContext = true, // Default to true since we always use contexts now
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
    // Create a mock scraper configuration
    const mockScraperConfig = {
      maxPages: 1000,
      maxDepth: 3,
      maxConcurrency: 3,
      pageTimeoutMs: 5000,
      browserTimeoutMs: 30000,
      fetcher: {
        maxRetries: 6,
        baseDelayMs: 1000,
        maxCacheItems: 200,
        maxCacheItemSizeBytes: 500 * 1024,
      },
      document: {
        maxSize: 10 * 1024 * 1024,
      },
    };
    playwrightMiddleware = new HtmlPlaywrightMiddleware(mockScraperConfig);
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
    it("should detect and process iframes correctly", async () => {
      const initialHtml =
        '<html><body><h1>Main Content</h1><iframe src="https://example.com/iframe"></iframe></body></html>';

      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      // Track iframe processing behavior
      let iframeProcessingCalled = false;

      const mockIframe = {
        getAttribute: vi.fn().mockResolvedValue("https://example.com/iframe"),
        contentFrame: vi.fn().mockResolvedValue({
          waitForSelector: vi.fn().mockResolvedValue(undefined),
          $eval: vi.fn().mockResolvedValue("<p>Iframe content</p>"),
        }),
      };

      const pageSpy = createMockPlaywrightPage(initialHtml);
      pageSpy.$$ = vi.fn().mockImplementation((selector: string) => {
        if (selector === "iframe") {
          return Promise.resolve([mockIframe]);
        }
        if (selector === "frameset") {
          return Promise.resolve([]); // No framesets
        }
        return Promise.resolve([]);
      });

      pageSpy.evaluate = vi.fn().mockImplementation((fn: any) => {
        // Handle shadow DOM extraction call
        if (typeof fn === "function") {
          const fnStr = fn.toString();
          if (fnStr.includes("shadowExtractor")) {
            return Promise.resolve([]); // Return empty array for shadow DOM extraction
          }
        }

        // Handle other evaluate calls (iframe processing)
        iframeProcessingCalled = true;
        return Promise.resolve(undefined);
      });

      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      // Verify iframe processing was triggered
      expect(pageSpy.$$).toHaveBeenCalledWith("iframe");
      expect(mockIframe.getAttribute).toHaveBeenCalledWith("src");
      expect(mockIframe.contentFrame).toHaveBeenCalled();
      expect(iframeProcessingCalled).toBe(true);
      expect(context.errors).toHaveLength(0);
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });

    it("should preserve content when no valid iframes are found", async () => {
      const initialHtml = `
        <html><body>
          <h1>Main Content</h1>
          <iframe src="about:blank"></iframe>
          <iframe src="data:text/html,test"></iframe>
          <iframe src="javascript:void(0)"></iframe>
          <iframe></iframe>
        </body></html>
      `;

      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      // Mock invalid iframes that should be skipped
      const invalidIframes = [
        { getAttribute: vi.fn().mockResolvedValue("about:blank") },
        { getAttribute: vi.fn().mockResolvedValue("data:text/html,test") },
        { getAttribute: vi.fn().mockResolvedValue("javascript:void(0)") },
        { getAttribute: vi.fn().mockResolvedValue("") },
      ];

      const pageSpy = createMockPlaywrightPage(initialHtml);
      pageSpy.$$ = vi.fn().mockImplementation((selector: string) => {
        if (selector === "iframe") {
          return Promise.resolve(invalidIframes);
        }
        if (selector === "frameset") {
          return Promise.resolve([]); // No framesets
        }
        return Promise.resolve([]);
      });

      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      // Verify iframes were checked but none processed (due to invalid URLs)
      expect(pageSpy.$$).toHaveBeenCalledWith("iframe");
      for (const iframe of invalidIframes) {
        expect(iframe.getAttribute).toHaveBeenCalledWith("src");
      }
      // Shadow DOM extraction will call evaluate once, but no iframe processing calls
      expect(pageSpy.evaluate).toHaveBeenCalledTimes(1);
      expect(context.errors).toHaveLength(0);
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });

    it("should handle iframe access errors gracefully", async () => {
      const initialHtml =
        '<html><body><h1>Main Content</h1><iframe src="https://example.com/iframe"></iframe></body></html>';

      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      // Mock iframe that throws error during content access
      const failingIframe = {
        getAttribute: vi.fn().mockResolvedValue("https://example.com/iframe"),
        contentFrame: vi.fn().mockResolvedValue(null), // Simulate access failure
      };

      const pageSpy = createMockPlaywrightPage(initialHtml);
      pageSpy.$$ = vi.fn().mockImplementation((selector: string) => {
        if (selector === "iframe") {
          return Promise.resolve([failingIframe]);
        }
        if (selector === "frameset") {
          return Promise.resolve([]); // No framesets
        }
        return Promise.resolve([]);
      });

      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      // Verify iframe was attempted but failed gracefully
      expect(pageSpy.$$).toHaveBeenCalledWith("iframe");
      expect(failingIframe.getAttribute).toHaveBeenCalledWith("src");
      expect(failingIframe.contentFrame).toHaveBeenCalled();
      expect(context.errors).toHaveLength(0); // Errors in iframe processing are logged, not added to context
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });

    it("should process multiple iframes and validate behavior", async () => {
      const initialHtml = `
        <html><body>
          <h1>Main Content</h1>
          <iframe src="https://example.com/iframe1"></iframe>
          <p>Between iframes</p>
          <iframe src="https://example.com/iframe2"></iframe>
          <iframe src="about:blank"></iframe>
        </body></html>
      `;

      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      let evaluateCallCount = 0;

      const validIframes = [
        {
          getAttribute: vi.fn().mockResolvedValue("https://example.com/iframe1"),
          contentFrame: vi.fn().mockResolvedValue({
            waitForSelector: vi.fn().mockResolvedValue(undefined),
            $eval: vi.fn().mockResolvedValue("<p>Content 1</p>"),
          }),
        },
        {
          getAttribute: vi.fn().mockResolvedValue("https://example.com/iframe2"),
          contentFrame: vi.fn().mockResolvedValue({
            waitForSelector: vi.fn().mockResolvedValue(undefined),
            $eval: vi.fn().mockResolvedValue("<p>Content 2</p>"),
          }),
        },
        {
          getAttribute: vi.fn().mockResolvedValue("about:blank"), // Should be skipped
        },
      ];

      const pageSpy = createMockPlaywrightPage(initialHtml);
      pageSpy.$$ = vi.fn().mockImplementation((selector: string) => {
        if (selector === "iframe") {
          return Promise.resolve(validIframes);
        }
        if (selector === "frameset") {
          return Promise.resolve([]); // No framesets
        }
        return Promise.resolve([]);
      });

      pageSpy.evaluate = vi.fn().mockImplementation((fn: any) => {
        evaluateCallCount++; // Count all evaluate calls

        // Handle shadow DOM extraction call
        if (typeof fn === "function") {
          const fnStr = fn.toString();
          if (fnStr.includes("shadowExtractor")) {
            return Promise.resolve([]); // Return empty array for shadow DOM extraction
          }
        }

        // Handle other evaluate calls (iframe processing)
        return Promise.resolve(undefined);
      });

      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      // Verify correct number of iframes were processed
      expect(pageSpy.$$).toHaveBeenCalledWith("iframe");
      expect(validIframes[0].getAttribute).toHaveBeenCalledWith("src");
      expect(validIframes[1].getAttribute).toHaveBeenCalledWith("src");
      expect(validIframes[2].getAttribute).toHaveBeenCalledWith("src");

      // Only valid iframes should have contentFrame called
      expect(validIframes[0].contentFrame).toHaveBeenCalled();
      expect(validIframes[1].contentFrame).toHaveBeenCalled();

      // Should have 3 evaluate calls (1 for shadow DOM extraction + 2 for iframe replacement)
      expect(evaluateCallCount).toBe(3);
      expect(context.errors).toHaveLength(0);
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });
  });

  describe("Frameset processing", () => {
    it("should extract frame URLs from frameset structure", async () => {
      // Mock the extractFrameUrls method to return expected frame URLs
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue([
          { src: "nav.html", name: "navigation" },
          { src: "list.html", name: "list" },
          { src: "main.html", name: "content" },
        ]),
      } as unknown as Page;

      // @ts-expect-error Accessing private method for testing
      const frameUrls = await playwrightMiddleware.extractFrameUrls(mockPage);

      expect(frameUrls).toEqual([
        { src: "nav.html", name: "navigation" },
        { src: "list.html", name: "list" },
        { src: "main.html", name: "content" },
      ]);
    });

    it("should merge frame contents sequentially", async () => {
      const frameContents = [
        { url: "nav.html", content: "<nav>Navigation</nav>", name: "navigation" },
        { url: "list.html", content: "<ul><li>Item 1</li></ul>", name: "list" },
        { url: "main.html", content: "<main>Main content</main>", name: "content" },
      ];

      const mockPage = {
        evaluate: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      // @ts-expect-error Accessing private method for testing
      await playwrightMiddleware.mergeFrameContents(mockPage, frameContents);

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.stringContaining("<!-- Frame 1 (navigation): nav.html -->"),
      );
      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.stringContaining("<nav>Navigation</nav>"),
      );
      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.stringContaining("<!-- Frame 2 (list): list.html -->"),
      );
      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.stringContaining("<!-- Frame 3 (content): main.html -->"),
      );
    });

    it("should detect and process framesets correctly", async () => {
      const javadocFrameset = `
        <html>
        <frameset cols="20%,80%">
        <frame src="nav.html" name="navigation">
        <frame src="main.html" name="content">
        </frameset>
        </html>
      `;

      const context = createPipelineTestContext(
        javadocFrameset,
        "https://example.com/docs/",
      );
      const next = vi.fn();

      // We'll test by capturing what the implementation calls
      let extractedFrameUrls: unknown[] = [];
      let mergedContentCalled = false;

      const pageSpy = createMockPlaywrightPage(javadocFrameset);

      // Mock frameset detection
      pageSpy.$$ = vi.fn().mockImplementation((selector: string) => {
        if (selector === "frameset") {
          return Promise.resolve([{}]); // Mock one frameset found
        }
        return Promise.resolve([]);
      });

      // Mock frame URL extraction
      pageSpy.evaluate = vi
        .fn()
        .mockImplementation((fn: (...args: unknown[]) => unknown) => {
          const fnString = fn.toString();

          // Handle shadow DOM extraction call
          if (fnString.includes("shadowExtractor")) {
            return Promise.resolve([]); // Return empty array for shadow DOM extraction
          }

          if (fnString.includes('querySelectorAll("frame")')) {
            extractedFrameUrls = [
              { src: "nav.html", name: "navigation" },
              { src: "main.html", name: "content" },
            ];
            return Promise.resolve(extractedFrameUrls);
          }
          // Mock frame content merging
          if (fnString.includes('querySelectorAll("frameset")')) {
            mergedContentCalled = true;
            return Promise.resolve(undefined);
          }
          return Promise.resolve(undefined);
        });

      // Mock frame page creation for content fetching
      const framePageSpy = createMockPlaywrightPage("");
      framePageSpy.$eval = vi.fn().mockResolvedValue("<p>Frame content</p>");

      const contextSpy = {
        newPage: vi.fn().mockResolvedValue(framePageSpy),
        close: vi.fn().mockResolvedValue(undefined),
      };
      pageSpy.context = vi.fn().mockReturnValue(contextSpy);

      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      // Verify the frameset processing was triggered
      expect(pageSpy.$$).toHaveBeenCalledWith("frameset");
      expect(extractedFrameUrls).toEqual([
        { src: "nav.html", name: "navigation" },
        { src: "main.html", name: "content" },
      ]);
      expect(contextSpy.newPage).toHaveBeenCalledTimes(2); // One for each frame
      expect(mergedContentCalled).toBe(true);
      expect(context.errors).toHaveLength(0);
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });

    it("should create body tag when replacing frameset", async () => {
      const framesetHtml = `
        <html>
        <head><title>Test</title></head>
        <frameset cols="20%,80%">
        <frame src="nav.html" name="navigation">
        <frame src="main.html" name="content">
        </frameset>
        </html>
      `;

      const context = createPipelineTestContext(
        framesetHtml,
        "https://example.com/docs/",
      );
      const next = vi.fn();

      // Track that body element creation is called
      let bodyElementCreated = false;

      const pageSpy = createMockPlaywrightPage(framesetHtml);

      // Mock frameset detection
      pageSpy.$$ = vi.fn().mockImplementation((selector: string) => {
        if (selector === "frameset") {
          return Promise.resolve([{}]); // Mock one frameset found
        }
        return Promise.resolve([]);
      });

      // Mock frame URL extraction and body creation
      pageSpy.evaluate = vi
        .fn()
        .mockImplementation((fn: (...args: unknown[]) => unknown) => {
          const fnString = fn.toString();

          // Handle shadow DOM extraction call
          if (fnString.includes("shadowExtractor")) {
            return Promise.resolve([]); // Return empty array for shadow DOM extraction
          }

          if (fnString.includes('querySelectorAll("frame")')) {
            return Promise.resolve([
              { src: "nav.html", name: "navigation" },
              { src: "main.html", name: "content" },
            ]);
          }
          // Mock body creation in mergeFrameContents
          if (fnString.includes('createElement("body")')) {
            bodyElementCreated = true;
            return Promise.resolve(undefined);
          }
          return Promise.resolve(undefined);
        });

      // Mock frame page creation for content fetching
      const framePageSpy = createMockPlaywrightPage("");
      framePageSpy.$eval = vi.fn().mockResolvedValue("<p>Frame content</p>");

      const contextSpy = {
        newPage: vi.fn().mockResolvedValue(framePageSpy),
        close: vi.fn().mockResolvedValue(undefined),
      };
      pageSpy.context = vi.fn().mockReturnValue(contextSpy);

      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      // Verify that body element was created during frameset replacement
      expect(bodyElementCreated).toBe(true);
      expect(context.errors).toHaveLength(0);
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

describe("Route handling race condition protection", () => {
  let playwrightMiddleware: HtmlPlaywrightMiddleware;

  beforeEach(() => {
    const mockScraperConfig = {
      maxPages: 1000,
      maxDepth: 3,
      maxConcurrency: 3,
      pageTimeoutMs: 5000,
      browserTimeoutMs: 30000,
      fetcher: {
        maxRetries: 6,
        baseDelayMs: 1000,
        maxCacheItems: 200,
        maxCacheItemSizeBytes: 500 * 1024,
      },
      document: {
        maxSize: 10 * 1024 * 1024,
      },
    };
    playwrightMiddleware = new HtmlPlaywrightMiddleware(mockScraperConfig);
  });

  afterAll(async () => {
    await playwrightMiddleware.closeBrowser();
  });

  describe("isRouteAlreadyHandledError", () => {
    it("should detect 'Route is already handled' error", () => {
      const error = new Error("Route is already handled!");
      // @ts-expect-error Accessing private method for testing
      expect(playwrightMiddleware.isRouteAlreadyHandledError(error)).toBe(true);
    });

    it("should detect partial 'Route is already handled' error messages", () => {
      const error = new Error("Error: Route is already handled");
      // @ts-expect-error Accessing private method for testing
      expect(playwrightMiddleware.isRouteAlreadyHandledError(error)).toBe(true);
    });

    it("should not detect other errors as route handled errors", () => {
      const error = new Error("Network timeout");
      // @ts-expect-error Accessing private method for testing
      expect(playwrightMiddleware.isRouteAlreadyHandledError(error)).toBe(false);
    });

    it("should not detect non-Error objects as route handled errors", () => {
      // @ts-expect-error Accessing private method for testing
      expect(playwrightMiddleware.isRouteAlreadyHandledError("some string")).toBe(false);
      // @ts-expect-error Accessing private method for testing
      expect(playwrightMiddleware.isRouteAlreadyHandledError(null)).toBe(false);
      // @ts-expect-error Accessing private method for testing
      expect(playwrightMiddleware.isRouteAlreadyHandledError(undefined)).toBe(false);
    });
  });

  describe("Route handler error handling", () => {
    it("should gracefully handle 'Route is already handled' during route.abort()", async () => {
      const initialHtml = "<html><body><p>Test</p></body></html>";
      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      let routeHandler: ((route: any) => Promise<void>) | null = null;

      const mockRoute = {
        request: () => ({
          url: () => "https://example.com/image.png",
          resourceType: () => "image",
          method: () => "GET",
          headers: () => ({}),
        }),
        abort: vi.fn().mockRejectedValue(new Error("Route is already handled!")),
      };

      const pageSpy = createMockPlaywrightPage(initialHtml);
      pageSpy.route = vi.fn().mockImplementation((_pattern: string, handler: any) => {
        routeHandler = handler;
        return Promise.resolve();
      });

      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      // Simulate route handling with the captured handler
      expect(routeHandler).toBeDefined();
      await expect((routeHandler as any)(mockRoute)).resolves.not.toThrow();

      expect(context.errors).toHaveLength(0);
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });

    it("should gracefully handle 'Route is already handled' during route.fulfill()", async () => {
      const initialHtml = "<html><body><p>Test</p></body></html>";
      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      let routeHandler: ((route: any) => Promise<void>) | null = null;

      const mockRoute = {
        request: () => ({
          url: () => "https://example.com/test",
          resourceType: () => "document",
          method: () => "GET",
          headers: () => ({}),
        }),
        fulfill: vi.fn().mockRejectedValue(new Error("Route is already handled!")),
      };

      const pageSpy = createMockPlaywrightPage(initialHtml);
      pageSpy.route = vi.fn().mockImplementation((_pattern: string, handler: any) => {
        routeHandler = handler;
        return Promise.resolve();
      });

      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      // Simulate route handling with the captured handler
      expect(routeHandler).toBeDefined();
      await expect((routeHandler as any)(mockRoute)).resolves.not.toThrow();

      expect(context.errors).toHaveLength(0);
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });

    it("should gracefully handle 'Route is already handled' during route.continue()", async () => {
      const initialHtml = "<html><body><p>Test</p></body></html>";
      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      let routeHandler: ((route: any) => Promise<void>) | null = null;

      const mockRoute = {
        request: () => ({
          url: () => "https://example.com/api/data",
          resourceType: () => "xhr",
          method: () => "POST",
          headers: () => ({}),
        }),
        continue: vi.fn().mockRejectedValue(new Error("Route is already handled!")),
      };

      const pageSpy = createMockPlaywrightPage(initialHtml);
      pageSpy.route = vi.fn().mockImplementation((_pattern: string, handler: any) => {
        routeHandler = handler;
        return Promise.resolve();
      });

      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      // Simulate route handling with the captured handler
      expect(routeHandler).toBeDefined();
      await expect((routeHandler as any)(mockRoute)).resolves.not.toThrow();

      expect(context.errors).toHaveLength(0);
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });

    it("should re-throw non-'Route is already handled' errors", async () => {
      const initialHtml = "<html><body><p>Test</p></body></html>";
      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      let routeHandler: ((route: any) => Promise<void>) | null = null;

      const mockRoute = {
        request: () => ({
          url: () => "https://example.com/image.png",
          resourceType: () => "image",
          method: () => "GET",
          headers: () => ({}),
        }),
        abort: vi.fn().mockRejectedValue(new Error("Page is closed")),
      };

      const pageSpy = createMockPlaywrightPage(initialHtml);
      pageSpy.route = vi.fn().mockImplementation((_pattern: string, handler: any) => {
        routeHandler = handler;
        return Promise.resolve();
      });

      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      // Simulate route handling with the captured handler - should throw
      expect(routeHandler).toBeDefined();
      await expect((routeHandler as any)(mockRoute)).rejects.toThrow("Page is closed");

      launchSpy.mockRestore();
    });

    it("should handle network errors and gracefully handle already-handled on abort", async () => {
      const initialHtml = "<html><body><p>Test</p></body></html>";
      const context = createPipelineTestContext(initialHtml, "https://example.com/test");
      const next = vi.fn();

      let routeHandler: ((route: any) => Promise<void>) | null = null;

      const mockRoute = {
        request: () => ({
          url: () => "https://example.com/script.js",
          resourceType: () => "script",
          method: () => "GET",
          headers: () => ({}),
        }),
        fetch: vi.fn().mockRejectedValue(new Error("Network timeout")),
        abort: vi.fn().mockRejectedValue(new Error("Route is already handled!")),
      };

      const pageSpy = createMockPlaywrightPage(initialHtml);
      pageSpy.route = vi.fn().mockImplementation((_pattern: string, handler: any) => {
        routeHandler = handler;
        return Promise.resolve();
      });

      const browserSpy = createMockBrowser(pageSpy);
      const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValue(browserSpy);

      await playwrightMiddleware.process(context, next);

      // Simulate route handling with the captured handler
      expect(routeHandler).toBeDefined();
      await expect((routeHandler as any)(mockRoute)).resolves.not.toThrow();

      expect(mockRoute.fetch).toHaveBeenCalled();
      expect(mockRoute.abort).toHaveBeenCalledWith("failed");
      expect(context.errors).toHaveLength(0);
      expect(next).toHaveBeenCalled();

      launchSpy.mockRestore();
    });
  });
});
