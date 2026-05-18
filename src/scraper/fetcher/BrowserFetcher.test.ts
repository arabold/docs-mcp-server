import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../utils/config";
import { MARKDOWN_PREFERRED_ACCEPT } from "./headers";

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(),
  },
}));

import { chromium } from "playwright";
import { BrowserFetcher } from "./BrowserFetcher";

describe("BrowserFetcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses broad invalid TLS override for the browser context", async () => {
    const setViewportSize = vi.fn().mockResolvedValue(undefined);
    const setExtraHTTPHeaders = vi.fn().mockResolvedValue(undefined);
    const route = vi.fn().mockResolvedValue(undefined);
    const unroute = vi.fn().mockResolvedValue(undefined);
    const closePage = vi.fn().mockResolvedValue(undefined);
    const page = {
      setViewportSize,
      setExtraHTTPHeaders,
      route,
      unroute,
      close: closePage,
      goto: vi.fn().mockResolvedValue({
        status: () => 200,
        headers: () => ({ "content-type": "text/html" }),
      }),
      url: vi.fn().mockReturnValue("https://example.com"),
      content: vi.fn().mockResolvedValue("<html><body>ok</body></html>"),
    };
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const newContext = vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(page),
      close: closeContext,
    });
    const browser = {
      newContext,
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(chromium.launch).mockResolvedValue(browser as never);

    const config = loadConfig().scraper;
    config.security.network.allowInvalidTls = true;
    const fetcher = new BrowserFetcher(config);

    await fetcher.fetch("http://example.com");

    expect(newContext).toHaveBeenCalledWith(
      expect.objectContaining({ ignoreHTTPSErrors: true }),
    );
  });

  it("restores fingerprint headers and desktop viewport", async () => {
    const setViewportSize = vi.fn().mockResolvedValue(undefined);
    const setExtraHTTPHeaders = vi.fn().mockResolvedValue(undefined);
    const page = {
      setViewportSize,
      setExtraHTTPHeaders,
      route: vi.fn().mockResolvedValue(undefined),
      unroute: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue({
        status: () => 200,
        headers: () => ({ "content-type": "text/html" }),
      }),
      url: vi.fn().mockReturnValue("https://example.com"),
      content: vi.fn().mockResolvedValue("<html><body>ok</body></html>"),
    };
    const browser = {
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue(page),
        close: vi.fn().mockResolvedValue(undefined),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(chromium.launch).mockResolvedValue(browser as never);

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    await fetcher.fetch("https://example.com", { headers: { "X-Test": "1" } });

    expect(setViewportSize).toHaveBeenCalledWith({ width: 1920, height: 1080 });
    expect(setExtraHTTPHeaders).toHaveBeenCalledWith(
      expect.objectContaining({ "X-Test": "1", Accept: MARKDOWN_PREFERRED_ACCEPT }),
    );
  });

  it("preserves caller-supplied Accept headers", async () => {
    const setExtraHTTPHeaders = vi.fn().mockResolvedValue(undefined);
    const page = {
      setViewportSize: vi.fn().mockResolvedValue(undefined),
      setExtraHTTPHeaders,
      route: vi.fn().mockResolvedValue(undefined),
      unroute: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue({
        status: () => 200,
        headers: () => ({ "content-type": "text/html" }),
      }),
      url: vi.fn().mockReturnValue("https://example.com"),
      content: vi.fn().mockResolvedValue("<html><body>ok</body></html>"),
    };
    const browser = {
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue(page),
        close: vi.fn().mockResolvedValue(undefined),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(chromium.launch).mockResolvedValue(browser as never);

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    await fetcher.fetch("https://example.com", { headers: { accept: "text/html" } });

    expect(setExtraHTTPHeaders).toHaveBeenCalledWith(
      expect.objectContaining({ accept: "text/html" }),
    );
    expect(setExtraHTTPHeaders).toHaveBeenCalledWith(
      expect.not.objectContaining({ Accept: MARKDOWN_PREFERRED_ACCEPT }),
    );
  });

  it("returns raw response body for Markdown responses instead of rendered HTML", async () => {
    const page = {
      setViewportSize: vi.fn().mockResolvedValue(undefined),
      setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
      route: vi.fn().mockResolvedValue(undefined),
      unroute: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue({
        status: () => 200,
        headers: () => ({ "content-type": "text/markdown; charset=utf-8" }),
        body: vi.fn().mockResolvedValue(Buffer.from("# Markdown body")),
      }),
      url: vi.fn().mockReturnValue("https://example.com/readme.md"),
      content: vi.fn().mockResolvedValue("<html><body># Markdown body</body></html>"),
    };
    const browser = {
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue(page),
        close: vi.fn().mockResolvedValue(undefined),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(chromium.launch).mockResolvedValue(browser as never);

    const fetcher = new BrowserFetcher(loadConfig().scraper);
    const result = await fetcher.fetch("https://example.com/readme.md");

    expect(page.content).not.toHaveBeenCalled();
    expect(result.mimeType).toBe("text/markdown");
    expect(result.content.toString()).toBe("# Markdown body");
  });
});
