/**
 * One Chromium per crawl, against a real browser.
 *
 * The page refuses the plain HTTP request with a 403, so the crawl fetches it
 * with the browser fetcher, and `scrapeMode: playwright` then renders it with
 * the HTML pipeline. Both must run in the same Chromium process.
 */

import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebScraperStrategy } from "../src/scraper/strategies/WebScraperStrategy";
import { ScrapeMode } from "../src/scraper/types";
import { loadConfig } from "../src/utils/config";
import { chromiumPids, listenOnFreePort } from "./test-helpers";

describe.skipIf(process.platform === "win32")("Shared Chromium for a crawl", () => {
  const requests: string[] = [];
  /** How many Chromium processes were running at each request. */
  const chromiumCounts: number[] = [];
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? "/";
      requests.push(path);
      chromiumCounts.push(chromiumPids().length);
      if (path === "/docs/") {
        // The first request comes from the plain HTTP fetcher; refusing it
        // sends the page to the browser fetcher.
        const firstRequest = requests.filter((seen) => seen === path).length === 1;
        res.writeHead(firstRequest ? 403 : 200, { "content-type": "text/html" });
        res.end(
          '<html><body><h1>Docs</h1><script src="/docs/app.js"></script></body></html>',
        );
        return;
      }
      if (path === "/docs/app.js") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end("document.body.dataset.ready = 'yes';");
        return;
      }
      res.writeHead(404);
      res.end();
    });
    baseUrl = `http://127.0.0.1:${await listenOnFreePort(server)}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("fetches and renders a page in one Chromium", async () => {
    const config = loadConfig();
    // The test server listens on loopback.
    config.scraper.security.network.allowPrivateNetworks = true;
    const strategy = new WebScraperStrategy(config);

    try {
      await strategy.scrape(
        {
          url: `${baseUrl}/docs/`,
          library: "shared-browser",
          version: "",
          maxPages: 1,
          maxDepth: 0,
          scrapeMode: ScrapeMode.Playwright,
        },
        async () => {},
      );
    } finally {
      await strategy.cleanup();
    }

    // The browser fetcher loaded the page, and the renderer loaded its script.
    expect(requests.filter((path) => path === "/docs/")).toHaveLength(2);
    expect(requests).toContain("/docs/app.js");
    expect(Math.max(...chromiumCounts)).toBe(1);
    expect(chromiumPids()).toHaveLength(0);
  });
});
