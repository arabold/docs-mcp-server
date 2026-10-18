/**
 * One Chromium per crawl, against a real browser.
 *
 * The page refuses the plain HTTP request with a 403, so the crawl fetches it
 * with the browser fetcher, and `scrapeMode: playwright` then renders it with
 * the HTML pipeline. Both must run in the same Chromium process, and a crawl
 * that fails while pages are still loading must leave no Chromium behind.
 */

import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebScraperStrategy } from "../src/scraper/strategies/WebScraperStrategy";
import { ScrapeMode } from "../src/scraper/types";
import { loadConfig } from "../src/utils/config";
import { chromiumPids, listenOnFreePort } from "./test-helpers";

/** How long the slow pages take to answer the browser. */
const SLOW_PAGE_MS = 1000;

/** A promise that resolves once `tick()` has been called `count` times. */
function countdown(count: number): { done: Promise<void>; tick: () => void } {
  let left = count;
  let resolve = () => {};
  const done = new Promise<void>((settle) => {
    resolve = settle;
  });
  return {
    done,
    tick: () => {
      left -= 1;
      if (left === 0) resolve();
    },
  };
}

describe.skipIf(process.platform === "win32")("Shared Chromium for a crawl", () => {
  const requests: string[] = [];
  /** How many Chromium processes were running at each request. */
  const chromiumCounts: number[] = [];
  /** Counts the browser's requests for the two slow pages. */
  let slowPagesLoading = countdown(2);
  /** Counts the slow pages' answers. */
  let slowPagesAnswered = countdown(2);
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
      if (path.startsWith("/failing/")) {
        // Every page refuses the plain HTTP request, so each one goes to the
        // browser fetcher. There, `fails` is refused again and ends the crawl,
        // but only once the browser is loading `slow1` and `slow2`, which take
        // a second to answer.
        const blocked = () => {
          res.writeHead(403, { "content-type": "text/html" });
          res.end("<html><body>Blocked</body></html>");
        };
        if (!["/failing/", "/failing/fails", "/failing/slow1", "/failing/slow2"].includes(path)) {
          // The crawl's llms.txt probe. A 403 would send it to the browser,
          // where it would count as a slow page.
          res.writeHead(404);
          res.end();
          return;
        }
        const firstRequest = requests.filter((seen) => seen === path).length === 1;
        if (firstRequest) {
          blocked();
        } else if (path === "/failing/fails") {
          void slowPagesLoading.done.then(blocked);
        } else if (path === "/failing/") {
          res.writeHead(200, { "content-type": "text/html" });
          res.end(
            '<html><body><a href="/failing/fails">x</a><a href="/failing/slow1">y</a><a href="/failing/slow2">z</a></body></html>',
          );
        } else {
          slowPagesLoading.tick();
          setTimeout(() => {
            res.writeHead(200, { "content-type": "text/html" });
            res.end(`<html><body><h1>${path}</h1></body></html>`);
            slowPagesAnswered.tick();
          }, SLOW_PAGE_MS);
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });
    baseUrl = `http://127.0.0.1:${await listenOnFreePort(server)}`;
  });

  beforeEach(() => {
    requests.length = 0;
    chromiumCounts.length = 0;
    slowPagesLoading = countdown(2);
    slowPagesAnswered = countdown(2);
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

  it("leaves no Chromium running when the crawl fails while pages are loading", async () => {
    const config = loadConfig();
    config.scraper.security.network.allowPrivateNetworks = true;
    const strategy = new WebScraperStrategy(config);

    // What ScraperService does: clean up as soon as the crawl rejects.
    try {
      await expect(
        strategy.scrape(
          {
            url: `${baseUrl}/failing/`,
            library: "shared-browser",
            version: "",
            maxPages: 10,
            maxDepth: 1,
            maxConcurrency: 3,
            ignoreErrors: false,
            scrapeMode: ScrapeMode.Fetch,
          },
          async () => {},
        ),
      ).rejects.toThrow(/403/);
    } finally {
      await strategy.cleanup();
    }

    // Wait until the slow pages answered: nothing may relaunch a browser or
    // retry them after the cleanup.
    await slowPagesAnswered.done;
    expect(chromiumPids()).toHaveLength(0);
    expect(requests.filter((path) => path === "/failing/slow1")).toHaveLength(2);
    expect(requests.filter((path) => path === "/failing/slow2")).toHaveLength(2);
  });
});
