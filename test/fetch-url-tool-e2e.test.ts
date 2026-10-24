/**
 * End-to-end tests for `FetchUrlTool`: fetch one URL, pick the content pipeline
 * for its content type, and return the result as text.
 *
 * Every response comes from the MSW handlers in `test/mock-server.ts`, or from a
 * handler a test adds itself. Private networks are allowed so the access policy
 * skips its DNS lookup, which keeps the suite off the real network entirely.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutoDetectFetcher } from "../src/scraper/fetcher/AutoDetectFetcher";
import { ScrapeMode } from "../src/scraper/types";
import { ToolError, ValidationError } from "../src/tools/errors";
import { FetchUrlTool } from "../src/tools/FetchUrlTool";
import { loadConfig } from "../src/utils/config";
import { server } from "./mock-server";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf-8");
}

describe("FetchUrlTool E2E", () => {
  let fetchUrlTool: FetchUrlTool;

  beforeEach(() => {
    const appConfig = loadConfig();
    appConfig.scraper.security.network.allowPrivateNetworks = true;
    // FetchUrlTool always retries a failed request three times. Without a
    // backoff delay, the failure tests finish in milliseconds.
    appConfig.scraper.fetcher.baseDelayMs = 0;
    fetchUrlTool = new FetchUrlTool(new AutoDetectFetcher(appConfig.scraper), appConfig);
  });

  describe("content types", () => {
    it("converts an HTML page to Markdown", async () => {
      const result = await fetchUrlTool.execute({
        url: "https://httpbin.org/html",
        scrapeMode: ScrapeMode.Fetch,
      });

      expect(result).toContain("# Herman Melville - Moby-Dick");
      expect(result).not.toContain("<h1>");
    });

    it("returns a JSON response unchanged", async () => {
      const result = await fetchUrlTool.execute({ url: "https://httpbin.org/json" });

      expect(JSON.parse(result)).toEqual(JSON.parse(readFixture("json.json")));
    });

    it("returns an XML response unchanged", async () => {
      const result = await fetchUrlTool.execute({ url: "https://httpbin.org/xml" });

      expect(result).toBe(readFixture("xml.xml"));
    });

    it("returns a text/plain response verbatim", async () => {
      const result = await fetchUrlTool.execute({
        url: "https://httpbin.org/robots.txt",
      });

      expect(result).toBe(readFixture("robots.txt"));
    });

    it("does not render HTML markup served as text/plain, even in Playwright mode", async () => {
      // GitHub's raw host serves .html files as text/plain. Treating them as
      // HTML would hand them to Playwright, which is where fetches used to hang.
      const url = "https://raw.githubusercontent.com/example/repo/main/index.html";
      const markup = "<html><body><h1>Raw page</h1><p>Served as text.</p></body></html>";
      server.use(
        http.get(
          url,
          () => new HttpResponse(markup, { headers: { "Content-Type": "text/plain" } }),
        ),
      );

      const result = await fetchUrlTool.execute({
        url,
        scrapeMode: ScrapeMode.Playwright,
      });

      expect(result).toBe(markup);
    });
  });

  describe("request handling", () => {
    it("follows a redirect and returns the target page", async () => {
      const result = await fetchUrlTool.execute({
        url: "https://httpbin.org/redirect/1",
        scrapeMode: ScrapeMode.Fetch,
      });

      expect(result).toContain("# Herman Melville - Moby-Dick");
    });

    it("sends custom headers with the request", async () => {
      const result = await fetchUrlTool.execute({
        url: "https://httpbin.org/headers",
        headers: { "X-Test-Header": "test-value" },
      });

      const echoed = JSON.parse(result) as { headers: Record<string, string> };
      expect(echoed.headers["x-test-header"]).toBe("test-value");
    });
  });

  describe("failures", () => {
    it("rejects a URL that is not HTTP, HTTPS, or file with a ValidationError", async () => {
      await expect(fetchUrlTool.execute({ url: "not-a-url" })).rejects.toThrow(
        new ValidationError(
          "Invalid URL: not-a-url. Must be an HTTP/HTTPS URL or a file:// URL.",
          "FetchUrlTool",
        ),
      );
    });

    it("rejects a 404 response with a ToolError naming the URL", async () => {
      const url = "https://httpbin.org/status/404";

      await expect(fetchUrlTool.execute({ url })).rejects.toThrow(
        expect.objectContaining({
          name: "ToolError",
          message: expect.stringContaining(url),
        }),
      );
    });

    // Today the error reads "Processing resulted in empty content".
    it.todo("reports a 404 response as not found");

    it("rejects a page the browser cannot render in Playwright mode with a ToolError naming the render", async () => {
      // Every launch fails at once, without needing a real browser.
      vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "/nonexistent/chromium");
      const url = "https://httpbin.org/html";

      try {
        await expect(
          fetchUrlTool.execute({ url, scrapeMode: ScrapeMode.Playwright }),
        ).rejects.toThrow(
          expect.objectContaining({
            name: "ToolError",
            message: expect.stringContaining(`Playwright could not render ${url}`),
          }),
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("rejects an unreachable host with a ToolError asking to check the URL", async () => {
      const url = "https://this-domain-definitely-does-not-exist-12345.com";

      await expect(fetchUrlTool.execute({ url })).rejects.toThrow(
        new ToolError(
          `Unable to fetch or process the URL "${url}". Please verify the URL is correct and accessible.`,
          "FetchUrlTool",
        ),
      );
    });
  });
});
