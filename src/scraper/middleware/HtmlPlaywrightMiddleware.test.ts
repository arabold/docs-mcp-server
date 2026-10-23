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

/** A redirect as `route.fetch` returns it when told not to follow redirects. */
function redirectResponse(location: string, status = 302) {
  return {
    status: () => status,
    headers: () => ({ location }),
    text: vi.fn().mockResolvedValue(""),
    dispose: vi.fn().mockResolvedValue(undefined),
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
    it("leaves the content alone without a browser for scrapeMode fetch or non-HTML content", async () => {
      const cases: Array<{ label: string; context: MiddlewareContext }> = [
        {
          label: "scrapeMode fetch",
          context: htmlContext(undefined, { scrapeMode: ScrapeMode.Fetch }),
        },
        {
          label: "non-HTML content",
          context: { ...htmlContext(), contentType: "text/markdown" },
        },
      ];

      for (const { label, context } of cases) {
        await middleware.process(context, next);

        expect.soft(context.content, label).toBe(FETCHED_HTML);
        expect.soft(context.errors, label).toEqual([]);
      }
      expect(chromium.launch).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(cases.length);
    });

    // HtmlPipeline treats a missing scrapeMode as "no browser" and never calls
    // the middleware then; on its own the middleware defaults to Auto.
    it("replaces the content with the rendered page for scrapeMode playwright, auto or unset", async () => {
      launch(fakeBrowser(fakePage()).browser);
      const scrapeModes = [ScrapeMode.Playwright, ScrapeMode.Auto, undefined];

      for (const scrapeMode of scrapeModes) {
        const context = htmlContext(undefined, { scrapeMode });

        await middleware.process(context, next);

        expect.soft(context.content, String(scrapeMode)).toBe(RENDERED_HTML);
        expect.soft(context.errors, String(scrapeMode)).toEqual([]);
      }
      expect(next).toHaveBeenCalledTimes(scrapeModes.length);
    });
  });

  describe("rendering", () => {
    it("opens the page in a browser context with its credentials and user agent", async () => {
      const cases: Array<{
        label: string;
        source: string;
        headers: Record<string, string>;
        httpCredentials?: { username: string; password: string };
        userAgent: unknown;
      }> = [
        {
          label: "credentials embedded in the URL",
          source: "https://user:password@example.com/",
          headers: {},
          httpCredentials: { username: "user", password: "password" },
          userAgent: expect.stringContaining("Mozilla/5.0"),
        },
        {
          label: "no credentials",
          source: "https://example.com/",
          headers: {},
          httpCredentials: undefined,
          userAgent: expect.stringContaining("Mozilla/5.0"),
        },
        {
          label: "a caller user agent",
          source: "https://example.com/",
          headers: { "User-Agent": "custom-agent" },
          httpCredentials: undefined,
          userAgent: "custom-agent",
        },
      ];
      const page = fakePage();
      const { browser } = fakeBrowser(page);
      launch(browser);

      for (const { label, source, headers, httpCredentials, userAgent } of cases) {
        await middleware.process(htmlContext(source, { headers }), next);

        const contextOptions = browser.newContext.mock.lastCall?.[0];
        expect.soft(contextOptions?.httpCredentials, label).toEqual(httpCredentials);
        expect.soft(contextOptions?.userAgent, label).toEqual(userAgent);
        expect.soft(page.goto.mock.lastCall?.[0], label).toBe(source);
      }
    });

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
  });

  describe("failures", () => {
    it("keeps the fetched HTML, records the error and keeps the browser when navigation or the body wait fails", async () => {
      const cases = [
        ["navigation fails", "goto", new Error("Simulated navigation failure")],
        [
          "the body never appears",
          "waitForSelector",
          new Error("Timeout 5000ms exceeded"),
        ],
      ] as const;

      for (const [label, failingCall, error] of cases) {
        middleware = new HtmlPlaywrightMiddleware(makeScraperConfig());
        const page = fakePage();
        page[failingCall].mockRejectedValue(error);
        const { browser, browserContext } = fakeBrowser(page);
        const launchSpy = launch(browser);
        launchSpy.mockClear();
        next.mockClear();
        const context = htmlContext();

        await middleware.process(context, next);

        expect.soft(context.content, label).toBe(FETCHED_HTML);
        expect.soft(context.errors, label).toEqual([error]);
        expect.soft(next, label).toHaveBeenCalledOnce();
        expect.soft(page.close, label).toHaveBeenCalled();
        expect.soft(browserContext.close, label).toHaveBeenCalled();
        // Other pages may be using the browser, and nothing suggests it is stuck.
        expect.soft(browser.close, label).not.toHaveBeenCalled();

        await middleware.process(htmlContext(), next);
        expect.soft(launchSpy, label).toHaveBeenCalledOnce();
      }
    });

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

    it("aborts images, fonts, media and speculative prefetches without fetching them", async () => {
      const handleRoute = await captureRouteHandler(page);
      const cases: Array<{
        label: string;
        url: string;
        resourceType: string;
        headers?: Record<string, string>;
        reason: string | undefined;
      }> = [
        {
          label: "image",
          url: "https://cdn.example.net/asset",
          resourceType: "image",
          reason: undefined,
        },
        {
          label: "font",
          url: "https://cdn.example.net/asset",
          resourceType: "font",
          reason: undefined,
        },
        {
          label: "media",
          url: "https://cdn.example.net/asset",
          resourceType: "media",
          reason: undefined,
        },
        {
          label: "next-router-prefetch",
          url: "https://example.com/docs/next?_rsc=abc",
          resourceType: "fetch",
          headers: { "next-router-prefetch": "1" },
          reason: "aborted",
        },
        {
          label: "purpose: prefetch",
          url: "https://example.com/docs/next?_rsc=abc",
          resourceType: "fetch",
          headers: { purpose: "prefetch" },
          reason: "aborted",
        },
        {
          label: "sec-purpose: prefetch",
          url: "https://example.com/docs/next?_rsc=abc",
          resourceType: "fetch",
          headers: { "sec-purpose": "prefetch;prerender" },
          reason: "aborted",
        },
      ];

      for (const { label, url, resourceType, headers, reason } of cases) {
        const route = fakeRoute(url, { resourceType, headers });

        await handleRoute(route);

        expect.soft(route.abort, label).toHaveBeenCalledWith(reason);
        expect.soft(route.fetch, label).not.toHaveBeenCalled();
      }
    });

    it("blocks a request to an address the access policy denies", async () => {
      const handleRoute = await captureRouteHandler(page);
      const route = fakeRoute("http://169.254.169.254/latest/meta-data");

      await handleRoute(route);

      expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
      expect(route.fetch).not.toHaveBeenCalled();
    });

    it("follows an allowed redirect one checked hop at a time", async () => {
      const handleRoute = await captureRouteHandler(page);
      const route = fakeRoute("https://example.com/lib.js");
      const final = fakeResponse("", "text/javascript");
      route.fetch
        .mockResolvedValueOnce(redirectResponse("https://cdn.example.net/lib@1.js"))
        .mockResolvedValueOnce(final);

      await handleRoute(route);

      const hops = route.fetch.mock.calls.map(([options]) => [
        options?.url,
        options?.maxRedirects,
      ]);
      expect(hops).toEqual([
        ["https://example.com/lib.js", 0],
        ["https://cdn.example.net/lib@1.js", 0],
      ]);
      expect(route.fulfill).toHaveBeenCalledWith({ response: final });
    });

    it("drops the page's credentials on a redirect to another origin", async () => {
      const handleRoute = await captureRouteHandler(
        page,
        htmlContext("https://user:pass@example.com/page"),
      );
      const route = fakeRoute("https://example.com/app.js");
      route.fetch
        .mockResolvedValueOnce(redirectResponse("https://cdn.example.net/app.js"))
        .mockResolvedValueOnce(fakeResponse("", "text/javascript"));

      await handleRoute(route);

      expect(route.fetch.mock.calls[0]?.[0]?.headers).toHaveProperty("Authorization");
      expect(route.fetch.mock.calls[1]?.[0]?.headers).not.toHaveProperty("Authorization");
    });

    it("aborts a request that keeps redirecting", async () => {
      const handleRoute = await captureRouteHandler(page);
      const route = fakeRoute("https://example.com/loop.js");
      route.fetch.mockResolvedValue(redirectResponse("https://example.com/loop.js"));

      await handleRoute(route);

      expect(route.abort).toHaveBeenCalledWith("failed");
      expect(route.fulfill).not.toHaveBeenCalled();
    });

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
    it("ignores 'Route is already handled' wherever it settles a route", async () => {
      const cases = [
        {
          label: "fulfilling the page's own request",
          url: "https://example.com/page",
          resourceType: "document",
          method: "GET",
          settle: "fulfill",
          fetches: false,
        },
        {
          label: "blocking a tracker",
          url: "https://www.google-analytics.com/analytics.js",
          resourceType: "script",
          method: "GET",
          settle: "abort",
          fetches: false,
        },
        {
          label: "aborting an image",
          url: "https://example.com/image.png",
          resourceType: "image",
          method: "GET",
          settle: "abort",
          fetches: false,
        },
        {
          label: "continuing a POST",
          url: "https://example.com/api",
          resourceType: "xhr",
          method: "POST",
          settle: "continue",
          fetches: false,
        },
        {
          label: "aborting after a failed fetch",
          url: "https://example.com/app.js",
          resourceType: "script",
          method: "GET",
          settle: "abort",
          fetches: true,
        },
      ] as const;
      const handleRoute = await captureRouteHandler(page);

      for (const { label, url, resourceType, method, settle, fetches } of cases) {
        const route = fakeRoute(url, { resourceType, method });
        route.fetch.mockRejectedValue(new Error("Network timeout"));
        route[settle].mockRejectedValue(new Error("Route is already handled!"));

        await expect.soft(handleRoute(route), label).resolves.toBeUndefined();
        expect.soft(route[settle], label).toHaveBeenCalled();
        expect.soft(route.fetch.mock.calls.length > 0, label).toBe(fetches);
      }
    });

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

    it("aborts listed sub-resources unless they are documents or skipKnownTrackers is off", async () => {
      const cases: Array<{
        label: string;
        url: string;
        resourceType: string;
        skipKnownTrackers: boolean;
        expected: "blockedbyclient" | "fetch";
      }> = [
        {
          label: "a listed tracker script",
          url: analyticsScript,
          resourceType: "script",
          skipKnownTrackers: true,
          expected: "blockedbyclient",
        },
        {
          label: "a listed tracker script with skipKnownTrackers off",
          url: analyticsScript,
          resourceType: "script",
          skipKnownTrackers: false,
          expected: "fetch",
        },
        {
          // It may be the page itself or an iframe.
          label: "a document on a listed host",
          url: "https://www.google-analytics.com/docs",
          resourceType: "document",
          skipKnownTrackers: true,
          expected: "fetch",
        },
        {
          // Blocked as a tracker, before the generic image abort.
          label: "a tracker image",
          url: "https://www.google-analytics.com/collect.gif",
          resourceType: "image",
          skipKnownTrackers: true,
          expected: "blockedbyclient",
        },
      ];

      for (const { label, url, resourceType, skipKnownTrackers, expected } of cases) {
        const route = fakeRoute(url, { resourceType });

        await routeWith(skipKnownTrackers, route);

        if (expected === "fetch") {
          expect.soft(route.fetch, label).toHaveBeenCalled();
          expect.soft(route.abort, label).not.toHaveBeenCalled();
        } else {
          expect.soft(route.abort, label).toHaveBeenCalledWith(expected);
          expect.soft(route.fetch, label).not.toHaveBeenCalled();
        }
      }
    });
  });

  // test/playwright-embedded-content-e2e.test.ts inlines iframes in Chromium and
  // skips data: and javascript: iframes; this test covers iframes that cannot be
  // inlined.
  describe("iframes", () => {
    it("leaves an iframe without a frame, readable body or text in place without an error", async () => {
      const iframes = {
        "has no accessible frame": fakeIframe("https://example.com/frame-a", undefined),
        "cannot be read": fakeIframe(
          "https://example.com/frame-b",
          new Error("Access denied"),
        ),
        "has an empty body": fakeIframe("https://example.com/frame-c", "   "),
      };
      const page = fakePage({ iframes: Object.values(iframes) });
      launch(fakeBrowser(page).browser);
      const context = htmlContext();

      await middleware.process(context, next);

      for (const [label, iframe] of Object.entries(iframes)) {
        expect.soft(iframe.evaluate, label).not.toHaveBeenCalled();
      }
      expect(context.errors).toEqual([]);
      expect(context.content).toBe(RENDERED_HTML);
    });
  });
});

describe("extractCredentialsAndOrigin", () => {
  it("splits a URL into its credentials and origin", () => {
    const cases: Array<[string, ReturnType<typeof extractCredentialsAndOrigin>]> = [
      [
        "https://user:pass@example.com/path",
        {
          credentials: { username: "user", password: "pass" },
          origin: "https://example.com",
        },
      ],
      ["https://example.com/path", { credentials: null, origin: "https://example.com" }],
      ["not-a-url", { credentials: null, origin: null }],
    ];

    for (const [url, expected] of cases) {
      expect.soft(extractCredentialsAndOrigin(url), url).toEqual(expected);
    }
  });
});

// Per-origin credentials are covered through the route handler above ("forwards
// caller headers to every request and credentials only to the page's origin").
describe("mergePlaywrightHeaders", () => {
  it("merges custom headers without overriding authorization or a caller Accept", () => {
    const credentials = { username: "user", password: "pass" };
    const cases: Array<{
      label: string;
      args: Parameters<typeof mergePlaywrightHeaders>;
      expected: Record<string, string>;
    }> = [
      {
        label: "adds custom headers and the Markdown-preferred Accept",
        args: [{ "content-type": "text/html" }, { "x-custom": "value" }],
        expected: {
          "content-type": "text/html",
          "x-custom": "value",
          Accept: MARKDOWN_PREFERRED_ACCEPT,
        },
      },
      {
        label: "keeps an existing authorization header over a custom one",
        args: [{ authorization: "Bearer existing" }, { Authorization: "Bearer custom" }],
        expected: { authorization: "Bearer existing", Accept: MARKDOWN_PREFERRED_ACCEPT },
      },
      {
        label: "leaves out basic auth when authorization is already set",
        args: [
          { authorization: "Bearer x" },
          {},
          credentials,
          "https://example.com",
          "https://example.com",
        ],
        expected: { authorization: "Bearer x", Accept: MARKDOWN_PREFERRED_ACCEPT },
      },
      {
        label: "keeps a caller-supplied Accept header",
        args: [{ accept: "text/html" }, { accept: "application/json" }],
        expected: { accept: "application/json" },
      },
    ];

    for (const { label, args, expected } of cases) {
      expect.soft(mergePlaywrightHeaders(...args), label).toEqual(expected);
    }
  });
});
