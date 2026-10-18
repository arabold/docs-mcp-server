import { type Browser, chromium, type Route } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, DEFAULT_CONFIG } from "../../utils/config";
import { MARKDOWN_PREFERRED_ACCEPT } from "../fetcher/headers";
import { ScrapeMode, type ScraperOptions } from "../types";
import {
  extractCredentialsAndOrigin,
  HtmlPlaywrightMiddleware,
  mergePlaywrightHeaders,
} from "./HtmlPlaywrightMiddleware";
import type { MiddlewareContext } from "./types";

/**
 * The real scraper defaults, with the test hosts listed so the access policy
 * accepts them without a DNS lookup. IP literals are still checked against the
 * special-use ranges.
 */
function makeScraperConfig(
  overrides: Partial<AppConfig["scraper"]> = {},
): AppConfig["scraper"] {
  return {
    ...DEFAULT_CONFIG.scraper,
    security: {
      ...DEFAULT_CONFIG.scraper.security,
      network: {
        ...DEFAULT_CONFIG.scraper.security.network,
        allowedHosts: ["example.com", "cdn.example.net", "www.google-analytics.com"],
      },
    },
    ...overrides,
  };
}

const FETCHED_HTML = "<html><body><p>Fetched</p></body></html>";
const RENDERED_HTML = "<html><body><p>Rendered</p></body></html>";

function htmlContext(
  source = "https://example.com/page",
  options: Partial<ScraperOptions> = {},
): MiddlewareContext {
  return {
    content: FETCHED_HTML,
    contentType: "text/html",
    source,
    links: [],
    errors: [],
    options: { url: source, library: "test-lib", version: "1.0.0", ...options },
  };
}

/** A main page whose `$$` finds the given iframes. */
function fakePage(options: { url?: string; iframes?: unknown[] } = {}) {
  return {
    route: vi.fn().mockResolvedValue(undefined),
    unroute: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(null),
    waitForSelector: vi.fn().mockResolvedValue(null),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(false),
    content: vi.fn().mockResolvedValue(RENDERED_HTML),
    close: vi.fn().mockResolvedValue(undefined),
    $$: vi.fn(async (selector: string) => {
      if (selector === "iframe") return options.iframes ?? [];
      return [];
    }),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    // Every in-page script finds nothing by default: no shadow roots, no frames.
    evaluate: vi.fn().mockResolvedValue([]),
    url: vi.fn().mockReturnValue(options.url ?? "https://example.com/page"),
    context: vi.fn(),
  };
}
type FakePage = ReturnType<typeof fakePage>;

function fakeBrowser(page: FakePage) {
  const browserContext = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
  page.context.mockReturnValue(browserContext);
  const browser = {
    newContext: vi.fn().mockResolvedValue(browserContext),
    // The CDP session ManagedBrowser checks redirects in.
    newBrowserCDPSession: vi.fn().mockResolvedValue({
      on: vi.fn(),
      send: vi.fn().mockResolvedValue({}),
      detach: vi.fn().mockResolvedValue(undefined),
    }),
    isConnected: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { browser, browserContext };
}

function launch(browser: ReturnType<typeof fakeBrowser>["browser"]) {
  return vi.spyOn(chromium, "launch").mockResolvedValue(browser as unknown as Browser);
}

function fakeResponse(body: string, contentType: string, status = 200) {
  return {
    status: () => status,
    headers: () => ({ "content-type": contentType }),
    text: vi.fn().mockResolvedValue(body),
  };
}

function fakeRoute(
  url: string,
  request: {
    resourceType?: string;
    method?: string;
    headers?: Record<string, string>;
  } = {},
) {
  return {
    request: () => ({
      url: () => url,
      resourceType: () => request.resourceType ?? "script",
      method: () => request.method ?? "GET",
      headers: () => request.headers ?? {},
    }),
    abort: vi.fn().mockResolvedValue(undefined),
    fulfill: vi.fn().mockResolvedValue(undefined),
    continue: vi.fn().mockResolvedValue(undefined),
    // An empty body is never cached, so routes in one test cannot leak into the
    // resource cache that every instance shares.
    fetch: vi.fn().mockResolvedValue(fakeResponse("", "text/javascript")),
  };
}
type FakeRoute = ReturnType<typeof fakeRoute>;

function fakeIframe(src: string | null, body?: string | Error) {
  const frame =
    body === undefined
      ? null
      : {
          waitForSelector: vi.fn().mockResolvedValue(null),
          isVisible: vi.fn().mockResolvedValue(false),
          $eval:
            body instanceof Error
              ? vi.fn().mockRejectedValue(body)
              : vi.fn().mockResolvedValue(body),
        };
  return {
    getAttribute: vi.fn().mockResolvedValue(src),
    contentFrame: vi.fn().mockResolvedValue(frame),
    // Replaces the iframe with its content in the page.
    evaluate: vi.fn().mockResolvedValue(undefined),
  };
}

describe("HtmlPlaywrightMiddleware", () => {
  let middleware: HtmlPlaywrightMiddleware;
  const next = vi.fn();

  /** Renders the context and returns the route handler the page registered. */
  async function captureRouteHandler(
    page: FakePage,
    context = htmlContext(),
  ): Promise<(route: FakeRoute) => Promise<void>> {
    await middleware.process(context, next);
    const handler = page.route.mock.calls[0]?.[1];
    if (typeof handler !== "function") throw new Error("no route handler registered");
    return (route) => handler(route as unknown as Route);
  }

  beforeEach(() => {
    middleware = new HtmlPlaywrightMiddleware(makeScraperConfig());
    next.mockReset();
    // Unit tests never start Chromium; each test that renders provides a fake.
    vi.spyOn(chromium, "launch").mockRejectedValue(
      new Error("Chromium is not available"),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when it renders", () => {
    it.each([
      [
        "scrapeMode fetch",
        () => htmlContext(undefined, { scrapeMode: ScrapeMode.Fetch }),
      ],
      ["non-HTML content", () => ({ ...htmlContext(), contentType: "text/markdown" })],
    ])("leaves the content alone for %s", async (_label, createContext) => {
      const context = createContext();

      await middleware.process(context, next);

      expect(context.content).toBe(FETCHED_HTML);
      expect(context.errors).toEqual([]);
      expect(chromium.launch).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    // HtmlPipeline treats a missing scrapeMode as "no browser" and never calls
    // the middleware then; on its own the middleware defaults to Auto.
    it.each([ScrapeMode.Playwright, ScrapeMode.Auto, undefined])(
      "replaces the content with the rendered page for scrapeMode %s",
      async (scrapeMode) => {
        const page = fakePage();
        launch(fakeBrowser(page).browser);
        const context = htmlContext(undefined, { scrapeMode });

        await middleware.process(context, next);

        expect(context.content).toBe(RENDERED_HTML);
        expect(context.errors).toEqual([]);
        expect(next).toHaveBeenCalledOnce();
      },
    );
  });

  describe("rendering", () => {
    it.each<{
      label: string;
      source: string;
      headers: Record<string, string>;
      expected: {
        httpCredentials?: { username: string; password: string };
        userAgent: unknown;
      };
    }>([
      {
        label: "credentials embedded in the URL",
        source: "https://user:password@example.com/",
        headers: {},
        expected: {
          httpCredentials: { username: "user", password: "password" },
          userAgent: expect.stringContaining("Mozilla/5.0"),
        },
      },
      {
        label: "no credentials",
        source: "https://example.com/",
        headers: {},
        expected: {
          httpCredentials: undefined,
          userAgent: expect.stringContaining("Mozilla/5.0"),
        },
      },
      {
        label: "a caller user agent",
        source: "https://example.com/",
        headers: { "User-Agent": "custom-agent" },
        expected: { httpCredentials: undefined, userAgent: "custom-agent" },
      },
    ])(
      "opens the page in a browser context for $label",
      async ({ source, headers, expected }) => {
        const page = fakePage();
        const { browser } = fakeBrowser(page);
        launch(browser);

        await middleware.process(htmlContext(source, { headers }), next);

        const contextOptions = browser.newContext.mock.calls[0]?.[0];
        expect(contextOptions?.httpCredentials).toEqual(expected.httpCredentials);
        expect(contextOptions?.userAgent).toEqual(expected.userAgent);
        expect(page.goto).toHaveBeenCalledWith(source, expect.any(Object));
      },
    );

    it("answers the page's own request with the fetched HTML, without the hash", async () => {
      const page = fakePage({ url: "https://example.com/docs#/guide" });
      launch(fakeBrowser(page).browser);
      const route = fakeRoute("https://example.com/docs", { resourceType: "document" });
      // The browser requests the page while navigating to it.
      page.goto.mockImplementation(async () => {
        const handler = page.route.mock.calls[0]?.[1];
        await handler(route);
        return null;
      });

      await middleware.process(
        htmlContext("https://example.com/docs#/guide", {
          scrapeMode: ScrapeMode.Playwright,
          preserveHashes: true,
        }),
        next,
      );

      expect(route.fulfill).toHaveBeenCalledWith({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: FETCHED_HTML,
      });
      expect(route.fetch).not.toHaveBeenCalled();
    });

    it("reuses the browser across renders", async () => {
      const page = fakePage();
      const launchSpy = launch(fakeBrowser(page).browser);

      await middleware.process(htmlContext(), next);
      await middleware.process(htmlContext(), next);

      expect(launchSpy).toHaveBeenCalledOnce();
    });

    it("shares one browser launch between concurrent renders", async () => {
      const launchSpy = launch(fakeBrowser(fakePage()).browser);

      await Promise.all(
        ["a", "b", "c"].map((name) =>
          middleware.process(htmlContext(`https://example.com/${name}`), next),
        ),
      );

      expect(launchSpy).toHaveBeenCalledOnce();
    });

    it("closes a browser whose launch was still in flight at shutdown", async () => {
      const { browser } = fakeBrowser(fakePage());
      let finishLaunch: (launched: Browser) => void = () => {};
      const launchSpy = vi.spyOn(chromium, "launch").mockReturnValue(
        new Promise<Browser>((resolve) => {
          finishLaunch = resolve;
        }),
      );

      const processing = middleware.process(htmlContext(), next);
      await vi.waitFor(() => expect(launchSpy).toHaveBeenCalled());
      const closing = middleware.closeBrowser();
      finishLaunch(browser as unknown as Browser);
      await closing;
      await processing;

      expect(browser.close).toHaveBeenCalled();
    });
  });

  describe("failures", () => {
    it.each([
      ["navigation fails", "goto", new Error("Simulated navigation failure")],
      ["the body never appears", "waitForSelector", new Error("Timeout 5000ms exceeded")],
    ] as const)(
      "keeps the fetched HTML, records the error and keeps the browser when %s",
      async (_label, failingCall, error) => {
        const page = fakePage();
        page[failingCall].mockRejectedValue(error);
        const { browser, browserContext } = fakeBrowser(page);
        const launchSpy = launch(browser);
        const context = htmlContext();

        await middleware.process(context, next);

        expect(context.content).toBe(FETCHED_HTML);
        expect(context.errors).toEqual([error]);
        expect(next).toHaveBeenCalledOnce();
        expect(page.close).toHaveBeenCalled();
        expect(browserContext.close).toHaveBeenCalled();
        // Other pages may be using the browser, and nothing suggests it is stuck.
        expect(browser.close).not.toHaveBeenCalled();

        await middleware.process(htmlContext(), next);
        expect(launchSpy).toHaveBeenCalledOnce();
      },
    );

    it.each(["page", "browserContext"] as const)(
      "bounds a %s that will not close, keeps the render and replaces the browser",
      async (stuck) => {
        vi.useFakeTimers();
        const page = fakePage();
        const fakes = { page, ...fakeBrowser(page) };
        fakes[stuck].close.mockImplementation(() => new Promise(() => {}));
        launch(fakes.browser);
        const context = htmlContext();

        const processing = middleware.process(context, next);
        await vi.advanceTimersByTimeAsync(2 * DEFAULT_CONFIG.scraper.pageTimeoutMs);
        await processing;

        expect(context.content).toBe(RENDERED_HTML);
        expect(context.errors).toEqual([]);
        expect(fakes.browser.close).toHaveBeenCalled();
        expect(next).toHaveBeenCalledOnce();
      },
    );

    it("keeps the browser when only the route cleanup fails", async () => {
      const page = fakePage();
      page.unroute.mockRejectedValue(new Error("Route already removed"));
      const { browser } = fakeBrowser(page);
      launch(browser);

      await middleware.process(htmlContext(), next);

      // The page and context closed, so nothing suggests Chromium is stuck.
      expect(page.close).toHaveBeenCalled();
      expect(browser.close).not.toHaveBeenCalled();
    });

    describe("render deadline", () => {
      const browserTimeoutMs = 1000;
      const hang = () => new Promise<never>(() => {});

      type Fakes = { page: FakePage } & ReturnType<typeof fakeBrowser>;

      beforeEach(() => {
        vi.useFakeTimers();
      });

      // `opened` names what the render had opened before it hung, which must be
      // closed although the render never finished. Only a render that hung before
      // it had a context of its own was waiting on the shared browser itself, so
      // only that one replaces the browser.
      it.each<
        [string, (fakes: Fakes) => void, Array<"browserContext" | "page">, boolean]
      >([
        [
          "browser context creation",
          ({ browser }) => browser.newContext.mockImplementation(hang),
          [],
          true,
        ],
        [
          "page creation",
          ({ browserContext }) => browserContext.newPage.mockImplementation(hang),
          ["browserContext"],
          false,
        ],
        [
          "content extraction",
          ({ page }) => page.content.mockImplementation(hang),
          ["page", "browserContext"],
          false,
        ],
      ])(
        "abandons a render that hangs in %s",
        async (_, hangIn, opened, replacesBrowser) => {
          middleware = new HtmlPlaywrightMiddleware(
            makeScraperConfig({ pageTimeoutMs: 100, browserTimeoutMs }),
          );
          const page = fakePage();
          const fakes = { page, ...fakeBrowser(page) };
          hangIn(fakes);
          launch(fakes.browser);
          const context = htmlContext();

          const processing = middleware.process(context, next);

          // Navigation alone may use the whole browser timeout, so the render is still
          // running just before it.
          await vi.advanceTimersByTimeAsync(browserTimeoutMs - 1);
          expect(next).not.toHaveBeenCalled();

          await vi.runAllTimersAsync();
          await processing;

          expect(context.errors).toHaveLength(1);
          expect(context.errors[0].message).toContain("timed out");
          expect(context.content).toBe(FETCHED_HTML);
          for (const name of opened) {
            expect(fakes[name].close).toHaveBeenCalled();
          }
          if (replacesBrowser) {
            expect(fakes.browser.close).toHaveBeenCalled();
          } else {
            expect(fakes.browser.close).not.toHaveBeenCalled();
          }
          expect(next).toHaveBeenCalledOnce();
        },
      );
    });
  });

  describe("sub-resource requests", () => {
    let page: FakePage;

    beforeEach(() => {
      page = fakePage();
      launch(fakeBrowser(page).browser);
    });

    it.each(["image", "font", "media"])(
      "aborts %s requests without fetching them",
      async (resourceType) => {
        const handleRoute = await captureRouteHandler(page);
        const route = fakeRoute("https://cdn.example.net/asset", { resourceType });

        await handleRoute(route);

        expect(route.abort).toHaveBeenCalledWith(undefined);
        expect(route.fetch).not.toHaveBeenCalled();
      },
    );

    it("blocks a request to an address the access policy denies", async () => {
      const handleRoute = await captureRouteHandler(page);
      const route = fakeRoute("http://169.254.169.254/latest/meta-data");

      await handleRoute(route);

      expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
      expect(route.fetch).not.toHaveBeenCalled();
    });

    it.each<Record<string, string>>([
      { "next-router-prefetch": "1" },
      { purpose: "prefetch" },
      { "sec-purpose": "prefetch;prerender" },
    ])(
      "aborts a speculative prefetch marked by %j without fetching it",
      async (headers) => {
        const handleRoute = await captureRouteHandler(page);
        const route = fakeRoute("https://example.com/docs/next?_rsc=abc", {
          resourceType: "fetch",
          headers,
        });

        await handleRoute(route);

        expect(route.abort).toHaveBeenCalledWith("aborted");
        expect(route.fetch).not.toHaveBeenCalled();
      },
    );

    it("forwards caller headers to every request and credentials only to the page's origin", async () => {
      const handleRoute = await captureRouteHandler(
        page,
        htmlContext("https://user:pass@example.com/page", {
          headers: { "X-Custom-Header": "custom" },
        }),
      );
      const sameOrigin = fakeRoute("https://example.com/app.js");
      const crossOrigin = fakeRoute("https://cdn.example.net/lib.js");

      await handleRoute(sameOrigin);
      await handleRoute(crossOrigin);

      const sameOriginHeaders = sameOrigin.fetch.mock.calls[0]?.[0]?.headers;
      const crossOriginHeaders = crossOrigin.fetch.mock.calls[0]?.[0]?.headers;
      expect(sameOriginHeaders).toMatchObject({
        "X-Custom-Header": "custom",
        Authorization: `Basic ${Buffer.from("user:pass").toString("base64")}`,
      });
      expect(crossOriginHeaders).toMatchObject({ "X-Custom-Header": "custom" });
      expect(crossOriginHeaders).not.toHaveProperty("Authorization");
    });

    it("serves a repeated text request from the cache", async () => {
      const handleRoute = await captureRouteHandler(page);
      // Unique to this test: the cache is shared by every instance.
      const url = "https://cdn.example.net/cached-once.js";
      const first = fakeRoute(url);
      first.fetch.mockResolvedValue(fakeResponse("console.log(1)", "text/javascript"));
      const second = fakeRoute(url);

      await handleRoute(first);
      await handleRoute(second);

      expect(second.fetch).not.toHaveBeenCalled();
      expect(second.fulfill).toHaveBeenCalledWith({
        status: 200,
        contentType: "text/javascript",
        body: "console.log(1)",
      });
    });

    it("passes an uncacheable response through without reading it", async () => {
      const handleRoute = await captureRouteHandler(page);
      const response = fakeResponse("PNG", "image/png");
      const route = fakeRoute("https://example.com/logo-as-script.png");
      route.fetch.mockResolvedValue(response);

      await handleRoute(route);

      expect(response.text).not.toHaveBeenCalled();
      expect(route.fulfill).toHaveBeenCalledWith({ response });
    });

    it("continues a non-GET request with the merged headers", async () => {
      const handleRoute = await captureRouteHandler(
        page,
        htmlContext(undefined, { headers: { "X-Custom-Header": "custom" } }),
      );
      const route = fakeRoute("https://example.com/api", { method: "POST" });

      await handleRoute(route);

      expect(route.continue).toHaveBeenCalledWith({
        headers: expect.objectContaining({ "X-Custom-Header": "custom" }),
      });
      expect(route.fetch).not.toHaveBeenCalled();
    });

    it("aborts a request whose fetch fails", async () => {
      const handleRoute = await captureRouteHandler(page);
      const route = fakeRoute("https://example.com/script.js");
      route.fetch.mockRejectedValue(new Error("Network timeout"));

      await handleRoute(route);

      expect(route.abort).toHaveBeenCalledWith("failed");
    });

    it("leaves a request alone when its page closed during the fetch", async () => {
      const handleRoute = await captureRouteHandler(page);
      const route = fakeRoute("https://example.com/script.js");
      route.fetch.mockRejectedValue(
        new Error(
          "route.fetch: Target page, context or browser has been closed\nCall log:",
        ),
      );

      await handleRoute(route);

      expect(route.abort).not.toHaveBeenCalled();
    });

    // Another handler can settle a route first; that race is not an error.
    it.each([
      [
        "fulfilling the page's own request",
        "https://example.com/page",
        "document",
        "GET",
        "fulfill",
      ],
      ["aborting an image", "https://example.com/image.png", "image", "GET", "abort"],
      ["continuing a POST", "https://example.com/api", "xhr", "POST", "continue"],
      [
        "aborting after a failed fetch",
        "https://example.com/app.js",
        "script",
        "GET",
        "abort",
      ],
    ] as const)(
      "ignores 'Route is already handled' when %s",
      async (_label, url, resourceType, method, settle) => {
        const handleRoute = await captureRouteHandler(page);
        const route = fakeRoute(url, { resourceType, method });
        route.fetch.mockRejectedValue(new Error("Network timeout"));
        route[settle].mockRejectedValue(new Error("Route is already handled!"));

        await expect(handleRoute(route)).resolves.toBeUndefined();
        expect(route[settle]).toHaveBeenCalled();
      },
    );

    it("rethrows other errors from settling a route", async () => {
      const handleRoute = await captureRouteHandler(page);
      const route = fakeRoute("https://example.com/image.png", { resourceType: "image" });
      route.abort.mockRejectedValue(new Error("Page is closed"));

      await expect(handleRoute(route)).rejects.toThrow("Page is closed");
    });
  });

  // Which hosts are listed is tested in subresourceBlocklist.test.ts; these cover
  // how the middleware applies the list.
  describe("tracker blocklist", () => {
    const analyticsScript = "https://www.google-analytics.com/analytics.js";

    async function routeWith(skipKnownTrackers: boolean, route: FakeRoute) {
      middleware = new HtmlPlaywrightMiddleware(makeScraperConfig({ skipKnownTrackers }));
      const page = fakePage();
      launch(fakeBrowser(page).browser);
      const handleRoute = await captureRouteHandler(page);
      await handleRoute(route);
    }

    it("aborts a listed tracker script as blocked by the client", async () => {
      const route = fakeRoute(analyticsScript);

      await routeWith(true, route);

      expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
      expect(route.fetch).not.toHaveBeenCalled();
    });

    it("fetches a listed tracker script when skipKnownTrackers is off", async () => {
      const route = fakeRoute(analyticsScript);

      await routeWith(false, route);

      expect(route.fetch).toHaveBeenCalled();
      expect(route.abort).not.toHaveBeenCalled();
    });

    it("lets a document on a listed host load, since it may be the page or an iframe", async () => {
      const route = fakeRoute("https://www.google-analytics.com/docs", {
        resourceType: "document",
      });

      await routeWith(true, route);

      expect(route.abort).not.toHaveBeenCalled();
      expect(route.fetch).toHaveBeenCalled();
    });

    it("blocks a tracker image as a tracker, before the generic image abort", async () => {
      const route = fakeRoute("https://www.google-analytics.com/collect.gif", {
        resourceType: "image",
      });

      await routeWith(true, route);

      expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
    });

    it("ignores 'Route is already handled' when blocking", async () => {
      const route = fakeRoute(analyticsScript);
      route.abort.mockRejectedValue(new Error("Route is already handled!"));

      await expect(routeWith(true, route)).resolves.toBeUndefined();
      expect(route.fetch).not.toHaveBeenCalled();
    });
  });

  // test/playwright-embedded-content-e2e.test.ts inlines iframes in Chromium;
  // these tests cover the iframes the middleware leaves alone.
  describe("iframes", () => {
    it.each([
      ["no src", null],
      ["an empty src", ""],
      ["about:blank", "about:blank"],
      ["a data: URL", "data:text/html,test"],
      ["a javascript: URL", "javascript:void(0)"],
    ])("skips an iframe with %s", async (_label, src) => {
      const iframe = fakeIframe(src, "<p>Never read</p>");
      const page = fakePage({ iframes: [iframe] });
      launch(fakeBrowser(page).browser);

      await middleware.process(htmlContext(), next);

      expect(iframe.contentFrame).not.toHaveBeenCalled();
      expect(iframe.evaluate).not.toHaveBeenCalled();
    });

    it.each([
      ["has no accessible frame", undefined],
      ["cannot be read", new Error("Access denied")],
      ["has an empty body", "   "],
    ])("leaves an iframe that %s in place without an error", async (_label, body) => {
      const iframe = fakeIframe("https://example.com/frame", body);
      const page = fakePage({ iframes: [iframe] });
      launch(fakeBrowser(page).browser);
      const context = htmlContext();

      await middleware.process(context, next);

      expect(iframe.evaluate).not.toHaveBeenCalled();
      expect(context.errors).toEqual([]);
      expect(context.content).toBe(RENDERED_HTML);
    });
  });
});

describe("extractCredentialsAndOrigin", () => {
  it.each([
    [
      "https://user:pass@example.com/path",
      {
        credentials: { username: "user", password: "pass" },
        origin: "https://example.com",
      },
    ],
    ["https://example.com/path", { credentials: null, origin: "https://example.com" }],
    ["not-a-url", { credentials: null, origin: null }],
  ])("%s", (url, expected) => {
    expect(extractCredentialsAndOrigin(url)).toEqual(expected);
  });
});

describe("mergePlaywrightHeaders", () => {
  const credentials = { username: "user", password: "pass" };

  it("adds custom headers and the Markdown-preferred Accept", () => {
    expect(
      mergePlaywrightHeaders({ "content-type": "text/html" }, { "x-custom": "value" }),
    ).toEqual({
      "content-type": "text/html",
      "x-custom": "value",
      Accept: MARKDOWN_PREFERRED_ACCEPT,
    });
  });

  it("keeps an existing authorization header over a custom one", () => {
    const result = mergePlaywrightHeaders(
      { authorization: "Bearer existing" },
      { Authorization: "Bearer custom" },
    );

    expect(result.authorization).toBe("Bearer existing");
    expect(result.Authorization).toBeUndefined();
  });

  it.each([
    [
      "injects basic auth for a same-origin request",
      {},
      "https://example.com",
      "Basic dXNlcjpwYXNz",
    ],
    [
      "leaves out basic auth for a cross-origin request",
      {},
      "https://other.com",
      undefined,
    ],
    [
      "leaves out basic auth when authorization is already set",
      { authorization: "Bearer x" },
      "https://example.com",
      undefined,
    ],
  ])("%s", (_label, existing, requestOrigin, expected) => {
    const result = mergePlaywrightHeaders(
      existing,
      {},
      credentials,
      "https://example.com",
      requestOrigin,
    );

    expect(result.Authorization).toBe(expected);
  });

  it("keeps a caller-supplied Accept header", () => {
    expect(
      mergePlaywrightHeaders({ accept: "text/html" }, { accept: "application/json" }),
    ).toEqual({
      accept: "application/json",
    });
  });
});
