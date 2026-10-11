import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../utils/config";
import { HttpStatusError, RedirectError, ScraperError } from "../../utils/errors";
import { MARKDOWN_PREFERRED_ACCEPT } from "./headers";

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(),
  },
}));

import { chromium } from "playwright";
import { BrowserFetcher } from "./BrowserFetcher";
import { FingerprintGenerator } from "./FingerprintGenerator";
import { ManagedBrowser } from "./ManagedBrowser";
import { FetchStatus } from "./types";

/**
 * Builds a mocked Playwright page/context/browser tree and makes it the browser
 * every launch returns. `pageOverrides` lets a test replace individual page
 * methods (e.g. a rejecting `goto`).
 */
function mockBrowser(pageOverrides: Record<string, unknown> = {}) {
  const mocks = buildBrowser(pageOverrides);
  vi.mocked(chromium.launch).mockResolvedValue(mocks.browser as never);
  return mocks;
}

/** Builds a mocked Playwright page/context/browser tree without launching it. */
function buildBrowser(pageOverrides: Record<string, unknown> = {}) {
  const page = {
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    route: vi.fn().mockResolvedValue(undefined),
    unroute: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    // Navigation-response listener used to read the final main-frame status.
    on: vi.fn(),
    mainFrame: vi.fn().mockReturnValue({}),
    goto: vi.fn().mockResolvedValue({
      status: () => 200,
      headers: () => ({ "content-type": "text/html" }),
    }),
    url: vi.fn().mockReturnValue("https://example.com"),
    content: vi.fn().mockResolvedValue("<html><body>ok</body></html>"),
    request: { get: vi.fn() },
    ...pageOverrides,
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  };
  return { page, context, browser };
}

/** Builds a mocked browser whose Chromium exits as soon as a page is opened. */
function crashingBrowser() {
  const { browser } = buildBrowser();
  browser.newContext.mockImplementation(async () => {
    browser.isConnected.mockReturnValue(false);
    throw new Error(
      "browser.newContext: Target page, context or browser has been closed",
    );
  });
  return browser;
}

describe("BrowserFetcher", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("uses broad invalid TLS override for the browser context", async () => {
    const { browser } = mockBrowser();
    const config = loadConfig().scraper;
    config.security.network.allowInvalidTls = true;
    const fetcher = new BrowserFetcher(config);

    await fetcher.fetch("http://example.com");

    expect(browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ ignoreHTTPSErrors: true }),
    );
  });

  it("restores fingerprint headers and desktop viewport", async () => {
    const { page } = mockBrowser();
    const fetcher = new BrowserFetcher(loadConfig().scraper);
    await fetcher.fetch("https://example.com", { headers: { "X-Test": "1" } });

    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 1920, height: 1080 });
    expect(page.setExtraHTTPHeaders).toHaveBeenCalledWith(
      expect.objectContaining({ "X-Test": "1", Accept: MARKDOWN_PREFERRED_ACCEPT }),
    );
  });

  it("preserves caller-supplied Accept headers", async () => {
    const { page } = mockBrowser();
    const fetcher = new BrowserFetcher(loadConfig().scraper);
    await fetcher.fetch("https://example.com", { headers: { accept: "text/html" } });

    expect(page.setExtraHTTPHeaders).toHaveBeenCalledWith(
      expect.objectContaining({ accept: "text/html" }),
    );
    expect(page.setExtraHTTPHeaders).toHaveBeenCalledWith(
      expect.not.objectContaining({ Accept: MARKDOWN_PREFERRED_ACCEPT }),
    );
  });

  it("keeps Sec-Fetch headers off the page so Chromium sets its own", async () => {
    // Overridden Sec-Fetch-* headers make Chromium fail the page's scripts and
    // other sub-resources while requests are intercepted.
    const generateHeaders = vi
      .spyOn(FingerprintGenerator.prototype, "generateHeaders")
      .mockReturnValue({
        "user-agent": "Fingerprint/1.0",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
      });
    try {
      const { page } = mockBrowser();
      const fetcher = new BrowserFetcher(loadConfig().scraper);
      await fetcher.fetch("https://example.com", {
        headers: { "Sec-Fetch-Site": "none", "X-Test": "1" },
      });

      const [headers] = vi.mocked(page.setExtraHTTPHeaders).mock.calls[0];
      expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^sec-fetch-/)]),
      );
      expect(headers).toEqual(
        expect.objectContaining({ "user-agent": "Fingerprint/1.0", "X-Test": "1" }),
      );
    } finally {
      generateHeaders.mockRestore();
    }
  });

  it("returns raw response body for Markdown responses instead of rendered HTML", async () => {
    const { page } = mockBrowser({
      goto: vi.fn().mockResolvedValue({
        status: () => 200,
        headers: () => ({ "content-type": "text/markdown; charset=utf-8" }),
        body: vi.fn().mockResolvedValue(Buffer.from("# Markdown body")),
      }),
      url: vi.fn().mockReturnValue("https://example.com/readme.md"),
    });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    const result = await fetcher.fetch("https://example.com/readme.md");

    expect(page.content).not.toHaveBeenCalled();
    expect(result.mimeType).toBe("text/markdown");
    expect(result.content.toString()).toBe("# Markdown body");
  });

  it("falls back to the request API when goto rejects on a non-navigable resource", async () => {
    // First goto (the .md) rejects as non-navigable; the origin goto (to clear
    // any challenge) resolves; then the request API returns the markdown bytes.
    const goto = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "page.goto: net::ERR_INVALID_ARGUMENT at https://x/automation/index.md",
        ),
      )
      .mockResolvedValue({ status: () => 200, headers: () => ({}) });
    const requestGet = vi.fn().mockResolvedValue({
      ok: () => true,
      status: () => 200,
      headers: () => ({ "content-type": "text/markdown" }),
      body: vi.fn().mockResolvedValue(Buffer.from("# from request api")),
    });
    const { page } = mockBrowser({ goto, request: { get: requestGet } });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    const result = await fetcher.fetch("https://example.com/automation/index.md");

    expect(requestGet).toHaveBeenCalledWith(
      "https://example.com/automation/index.md",
      expect.any(Object),
    );
    expect(goto).toHaveBeenCalledWith("https://example.com", expect.any(Object));
    expect(page.content).not.toHaveBeenCalled();
    expect(result.mimeType).toBe("text/markdown");
    expect(result.content.toString()).toBe("# from request api");
  });

  it("throws a retryable ScraperError when the request-API fallback is still blocked", async () => {
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error("page.goto: net::ERR_ABORTED"))
      .mockResolvedValue({ status: () => 200, headers: () => ({}) });
    const requestGet = vi.fn().mockResolvedValue({
      ok: () => false,
      status: () => 403,
      headers: () => ({ "content-type": "text/html" }),
      body: vi.fn().mockResolvedValue(Buffer.from("Just a moment...")),
    });
    mockBrowser({ goto, request: { get: requestGet } });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    const error = await fetcher
      .fetch("https://example.com/automation/index.md")
      .catch((e) => e);

    expect(error).toBeInstanceOf(ScraperError);
    expect((error as InstanceType<typeof ScraperError>).isRetryable).toBe(true);
  });

  it("rejects a request-API redirect to a disallowed host before fetching it", async () => {
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error("page.goto: net::ERR_ABORTED"))
      .mockResolvedValue({ status: () => 200, headers: () => ({}) });
    const requestGet = vi.fn().mockResolvedValue({
      ok: () => false,
      status: () => 302,
      headers: () => ({ location: "http://127.0.0.1/secret" }),
      body: vi.fn(),
    });
    mockBrowser({ goto, request: { get: requestGet } });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    await expect(
      fetcher.fetch("https://example.com/automation/index.md"),
    ).rejects.toThrow();
    expect(requestGet).toHaveBeenCalledTimes(1);
  });

  it("follows an allowed request-API redirect and reports the redirect target as source", async () => {
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error("page.goto: net::ERR_ABORTED"))
      .mockResolvedValue({ status: () => 200, headers: () => ({}) });
    const requestGet = vi
      .fn()
      .mockResolvedValueOnce({
        ok: () => false,
        status: () => 302,
        headers: () => ({ location: "https://example.com/redirected.md" }),
        body: vi.fn(),
      })
      .mockResolvedValueOnce({
        ok: () => true,
        status: () => 200,
        headers: () => ({ "content-type": "text/markdown" }),
        body: vi.fn().mockResolvedValue(Buffer.from("# redirected content")),
      });
    mockBrowser({ goto, request: { get: requestGet } });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    const result = await fetcher.fetch("https://example.com/automation/index.md");

    expect(requestGet).toHaveBeenCalledTimes(2);
    expect(requestGet).toHaveBeenNthCalledWith(
      2,
      "https://example.com/redirected.md",
      expect.any(Object),
    );
    expect(result.source).toBe("https://example.com/redirected.md");
    expect(result.content.toString()).toBe("# redirected content");
  });

  it("throws a non-retryable RedirectError for request-API redirects when followRedirects is false", async () => {
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error("page.goto: net::ERR_ABORTED"))
      .mockResolvedValue({ status: () => 200, headers: () => ({}) });
    const requestGet = vi.fn().mockResolvedValue({
      ok: () => false,
      status: () => 302,
      headers: () => ({ location: "https://example.com/redirected.md" }),
      body: vi.fn(),
    });
    mockBrowser({ goto, request: { get: requestGet } });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    const error = await fetcher
      .fetch("https://example.com/automation/index.md", { followRedirects: false })
      .catch((e) => e);

    expect(error).toBeInstanceOf(RedirectError);
    expect((error as InstanceType<typeof ScraperError>).isRetryable).toBe(false);
    expect((error as RedirectError).redirectUrl).toBe(
      "https://example.com/redirected.md",
    );
    expect(requestGet).toHaveBeenCalledTimes(1);
  });

  it("throws a non-retryable RedirectError from the main navigation path when followRedirects is false", async () => {
    const { page } = mockBrowser({
      goto: vi.fn().mockResolvedValue({
        status: () => 302,
        headers: () => ({ location: "https://example.com/other" }),
      }),
    });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    const error = await fetcher
      .fetch("https://example.com", { followRedirects: false })
      .catch((e) => e);

    expect(error).toBeInstanceOf(RedirectError);
    expect((error as InstanceType<typeof ScraperError>).isRetryable).toBe(false);
    expect((error as RedirectError).redirectUrl).toBe("https://example.com/other");
    expect(page.content).not.toHaveBeenCalled();
  });

  it("sends the same fingerprint/Accept headers to the request-API fallback as the page navigation", async () => {
    // The page leaves Sec-Fetch-* to Chromium; the request API is Playwright's
    // own client, so it sends them to look like the same browser.
    const generateHeaders = vi
      .spyOn(FingerprintGenerator.prototype, "generateHeaders")
      .mockReturnValue({
        "user-agent": "Fingerprint/1.0",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
      });
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error("page.goto: net::ERR_ABORTED"))
      .mockResolvedValue({ status: () => 200, headers: () => ({}) });
    const requestGet = vi.fn().mockResolvedValue({
      ok: () => true,
      status: () => 200,
      headers: () => ({ "content-type": "text/markdown" }),
      body: vi.fn().mockResolvedValue(Buffer.from("# from request api")),
    });
    const { page } = mockBrowser({ goto, request: { get: requestGet } });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    await fetcher.fetch("https://example.com/automation/index.md", {
      headers: { "X-Test": "1" },
    });

    generateHeaders.mockRestore();
    const [pageHeaders] = page.setExtraHTTPHeaders.mock.calls[0];
    const [, requestOptions] = requestGet.mock.calls[0];
    expect(requestOptions.headers).toEqual({
      ...pageHeaders,
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    });
    expect(requestOptions.headers).toEqual(expect.objectContaining({ "X-Test": "1" }));
  });

  it("does not fetch through the request API when the page was detached mid-navigation", async () => {
    // Chromium reports a navigation cut off by a closing browser as ERR_ABORTED
    // too; fetching the resource again there only adds a request.
    const goto = vi
      .fn()
      .mockRejectedValue(
        new Error("page.goto: net::ERR_ABORTED; maybe frame was detached?"),
      );
    const requestGet = vi.fn();
    mockBrowser({ goto, request: { get: requestGet } });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    await expect(fetcher.fetch("https://example.com/page")).rejects.toThrow(
      /ERR_ABORTED/,
    );
    expect(requestGet).not.toHaveBeenCalled();
  });

  it("fetches a file the browser downloads through the request API", async () => {
    // With requests routed, Playwright reports a download as "Download is
    // starting" rather than a network error.
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error("page.goto: Download is starting"))
      .mockResolvedValue({ status: () => 200, headers: () => ({}) });
    const requestGet = vi.fn().mockResolvedValue({
      ok: () => true,
      status: () => 200,
      headers: () => ({ "content-type": "application/x-yaml" }),
      body: vi.fn().mockResolvedValue(Buffer.from("key: value")),
    });
    mockBrowser({ goto, request: { get: requestGet } });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    const result = await fetcher.fetch("https://example.com/openapi.yaml");

    expect(result.status).toBe(FetchStatus.SUCCESS);
    expect(result.content.toString()).toBe("key: value");
  });

  it("rejects a blocked page instead of returning the block page as content", async () => {
    // The 403/429 fallback sends blocked urls here; if the browser does not get
    // through either, its error page must not be indexed as documentation.
    mockBrowser({
      goto: vi.fn().mockResolvedValue({
        status: () => 403,
        headers: () => ({ "content-type": "text/html" }),
      }),
      content: vi.fn().mockResolvedValue("<html><body>Access denied</body></html>"),
    });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    await expect(fetcher.fetch("https://example.com")).rejects.toThrow(/status 403/);
  });

  it("reports a browser 404 as NOT_FOUND rather than success", async () => {
    mockBrowser({
      goto: vi.fn().mockResolvedValue({
        status: () => 404,
        headers: () => ({ "content-type": "text/html" }),
      }),
    });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    const result = await fetcher.fetch("https://example.com");

    expect(result.status).toBe(FetchStatus.NOT_FOUND);
  });

  it("honors a caller User-Agent given in lowercase", async () => {
    // Header names are case-insensitive, so the context user agent must match
    // the value the caller actually sends.
    const { browser } = mockBrowser();

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    await fetcher.fetch("https://example.com", {
      headers: { "user-agent": "CustomAgent/1.0" },
    });

    expect(browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: "CustomAgent/1.0" }),
    );
  });

  it("reports a request-API 404 as NOT_FOUND, matching the navigation path", async () => {
    // Refresh uses a 404 to delete a stale page and llms.txt seeds treat it as
    // non-fatal; surfacing it as a generic failure breaks both.
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error("page.goto: net::ERR_ABORTED"))
      .mockResolvedValue({ status: () => 200, headers: () => ({}) });
    const requestGet = vi.fn().mockResolvedValue({
      ok: () => false,
      status: () => 404,
      headers: () => ({ "content-type": "text/html" }),
      body: vi.fn().mockResolvedValue(Buffer.from("not found")),
    });
    mockBrowser({ goto, request: { get: requestGet } });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    const result = await fetcher.fetch("https://example.com/docs/page.md");

    expect(result.status).toBe(FetchStatus.NOT_FOUND);
  });

  it("carries the request-API status on the thrown error", async () => {
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error("page.goto: net::ERR_ABORTED"))
      .mockResolvedValue({ status: () => 200, headers: () => ({}) });
    const requestGet = vi.fn().mockResolvedValue({
      ok: () => false,
      status: () => 403,
      headers: () => ({ "content-type": "text/html" }),
      body: vi.fn().mockResolvedValue(Buffer.from("blocked")),
    });
    mockBrowser({ goto, request: { get: requestGet } });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    const error = await fetcher.fetch("https://example.com/docs/page.md").catch((e) => e);

    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as InstanceType<typeof HttpStatusError>).statusCode).toBe(403);
  });

  it("extracts from the document a challenge navigated to, not the challenge itself", async () => {
    // page.goto() returns the challenge response; the page that ends up loaded
    // is a later main-frame response, and it owns the real content type/etag.
    const challengeResponse = {
      status: () => 503,
      headers: () => ({ "content-type": "text/html", etag: "challenge-etag" }),
    };
    const destinationResponse = {
      status: () => 200,
      headers: () => ({ "content-type": "text/html", etag: "real-etag" }),
    };
    const listeners: Array<(r: unknown) => void> = [];
    const mainFrame = {};
    const { page } = mockBrowser({
      goto: vi.fn().mockResolvedValue(challengeResponse),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
      on: vi.fn((event: string, handler: (r: unknown) => void) => {
        if (event === "response") listeners.push(handler);
      }),
    });
    // The navigation that clears the challenge.
    page.waitForLoadState = vi.fn().mockImplementation(async () => {
      for (const handler of listeners) {
        handler({
          ...destinationResponse,
          request: () => ({
            isNavigationRequest: () => true,
            frame: () => mainFrame,
          }),
        });
      }
    });

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    const result = await fetcher.fetch("https://example.com");

    expect(result.status).toBe(FetchStatus.SUCCESS);
    expect(result.etag).toBe("real-etag");
  });

  describe("Chromium exiting mid-fetch", () => {
    it("retries a page once on a new browser when Chromium exits during the fetch", async () => {
      const { browser } = mockBrowser();
      vi.mocked(chromium.launch).mockResolvedValueOnce(crashingBrowser() as never);
      const fetcher = new BrowserFetcher(loadConfig().scraper);

      const result = await fetcher.fetch("https://example.com");

      expect(result.status).toBe(FetchStatus.SUCCESS);
      expect(browser.newContext).toHaveBeenCalledTimes(1);
    });

    it("gives up after one retry when the new browser exits too", async () => {
      vi.mocked(chromium.launch).mockImplementation(
        async () => crashingBrowser() as never,
      );
      const fetcher = new BrowserFetcher(loadConfig().scraper);

      await expect(fetcher.fetch("https://example.com")).rejects.toThrow(ScraperError);
      expect(chromium.launch).toHaveBeenCalledTimes(2);
    });

    it("does not retry a failure while the browser is still connected", async () => {
      const { browser } = mockBrowser();
      browser.newContext.mockRejectedValue(new Error("context failed"));
      const fetcher = new BrowserFetcher(loadConfig().scraper);

      await expect(fetcher.fetch("https://example.com")).rejects.toThrow(ScraperError);
      expect(chromium.launch).toHaveBeenCalledTimes(1);
      expect(browser.newContext).toHaveBeenCalledTimes(1);
    });

    it("retries when another user retired the shared browser, before it reports disconnected", async () => {
      // On Linux the navigation fails with "frame was detached" while the
      // retired browser is still closing and still reports connected.
      const managed = new ManagedBrowser(loadConfig().scraper);
      const { browser: retired } = buildBrowser();
      retired.newContext.mockImplementation(async () => {
        void managed.retire(retired as never, "replaced by the renderer");
        throw new Error("page.goto: net::ERR_ABORTED; maybe frame was detached?");
      });
      const { browser: replacement } = buildBrowser();
      vi.mocked(chromium.launch)
        .mockResolvedValueOnce(retired as never)
        .mockResolvedValueOnce(replacement as never);
      const fetcher = new BrowserFetcher(loadConfig().scraper, managed);

      const result = await fetcher.fetch("https://example.com");

      expect(result.status).toBe(FetchStatus.SUCCESS);
      expect(replacement.newContext).toHaveBeenCalledTimes(1);
    });

    it("does not retry when the fetch was aborted, even though the browser is gone", async () => {
      // The crawl aborts its items and then closes the shared browser; a retry
      // would launch a new one after that cleanup.
      const controller = new AbortController();
      const browser = crashingBrowser();
      browser.newContext.mockImplementation(async () => {
        controller.abort();
        browser.isConnected.mockReturnValue(false);
        throw new Error(
          "browser.newContext: Target page, context or browser has been closed",
        );
      });
      vi.mocked(chromium.launch).mockResolvedValue(browser as never);
      const fetcher = new BrowserFetcher(loadConfig().scraper);

      await expect(
        fetcher.fetch("https://example.com", { signal: controller.signal }),
      ).rejects.toThrow("Browser fetch cancelled");
      expect(chromium.launch).toHaveBeenCalledTimes(1);
    });
  });

  it("stops a page that is still loading when the fetch is aborted", async () => {
    // Closing the context ends the navigation at once; otherwise an aborted
    // fetch would wait for the navigation timeout.
    let failNavigation: (error: Error) => void = () => undefined;
    const goto = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          failNavigation = reject;
        }),
    );
    const { context } = mockBrowser({ goto });
    context.close.mockImplementation(async () => {
      failNavigation(
        new Error("page.goto: Target page, context or browser has been closed"),
      );
    });
    const controller = new AbortController();
    const fetcher = new BrowserFetcher(loadConfig().scraper);

    const fetching = fetcher.fetch("https://example.com", { signal: controller.signal });
    await vi.waitFor(() => expect(goto).toHaveBeenCalled());
    controller.abort();

    await expect(fetching).rejects.toThrow("Browser fetch cancelled");
    expect(context.close).toHaveBeenCalled();
  });
});
