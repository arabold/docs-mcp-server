/**
 * BrowserFetcher against a real Chromium that dies mid-crawl (issue #531).
 *
 * Chromium is killed with SIGKILL, the way the OS ends it under memory
 * pressure. The fetcher must launch a new browser for the pages that follow,
 * retry the page Chromium died loading, and never start more than one browser
 * for pages that ask at the same time. A page whose shared browser another user
 * replaces is retried too, and a browser that will not close is killed.
 */

import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserFetcher } from "../src/scraper/fetcher/BrowserFetcher";
import { ManagedBrowser } from "../src/scraper/fetcher/ManagedBrowser";
import { FetchStatus } from "../src/scraper/fetcher/types";
import { type AppConfig, loadConfig } from "../src/utils/config";
import { chromiumPids, listenOnFreePort } from "./test-helpers";

/** Kills every Chromium this process launched and returns their PIDs. */
function killChromium(): number[] {
  const pids = chromiumPids();
  for (const pid of pids) {
    process.kill(pid, "SIGKILL");
  }
  return pids;
}

describe.skipIf(process.platform === "win32")("Browser restart after Chromium dies", () => {
  const requests: string[] = [];
  let crashOnPath: string | null = null;
  let retireOnPath: string | null = null;
  let sharedBrowser: ManagedBrowser | null = null;
  let server: Server;
  let baseUrl: string;
  let config: AppConfig["scraper"];
  let fetcher: BrowserFetcher;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? "/";
      requests.push(path);
      if (path === crashOnPath) {
        // Chromium dies while this page loads; the request is never answered.
        crashOnPath = null;
        killChromium();
        return;
      }
      if (path === retireOnPath && sharedBrowser) {
        // Another user of the shared browser replaces it while this page loads.
        retireOnPath = null;
        const managed = sharedBrowser;
        void managed.get().then((browser) => managed.retire(browser, "test"));
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><body><h1>Page ${path}</h1></body></html>`);
    });
    baseUrl = `http://127.0.0.1:${await listenOnFreePort(server)}`;

    config = loadConfig().scraper;
    // The test server listens on loopback.
    config.security.network.allowPrivateNetworks = true;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    requests.length = 0;
    crashOnPath = null;
    retireOnPath = null;
    sharedBrowser = null;
    fetcher = new BrowserFetcher(config);
  });

  afterEach(async () => {
    await fetcher.close();
  });

  it("launches a new Chromium for the next page after the old one was killed", async () => {
    await fetcher.fetch(`${baseUrl}/first`);
    const killed = killChromium();
    expect(killed).toHaveLength(1);

    const result = await fetcher.fetch(`${baseUrl}/second`);

    expect(result.status).toBe(FetchStatus.SUCCESS);
    expect(result.content.toString()).toContain("Page /second");
    const running = chromiumPids();
    expect(running).toHaveLength(1);
    expect(running).not.toContain(killed[0]);
  });

  it("retries the page Chromium died loading on a new browser", async () => {
    crashOnPath = "/crash";

    const result = await fetcher.fetch(`${baseUrl}/crash`);

    expect(result.status).toBe(FetchStatus.SUCCESS);
    expect(result.content.toString()).toContain("Page /crash");
    expect(requests.filter((path) => path === "/crash")).toHaveLength(2);
  });

  it("starts one Chromium for pages that ask for a browser at the same time", async () => {
    const results = await Promise.all(
      ["a", "b", "c"].map((name) => fetcher.fetch(`${baseUrl}/${name}`)),
    );

    expect(results.map((result) => result.status)).toEqual([
      FetchStatus.SUCCESS,
      FetchStatus.SUCCESS,
      FetchStatus.SUCCESS,
    ]);
    expect(chromiumPids()).toHaveLength(1);
  });

  it("retries the page on a new browser when another user retires the shared one", async () => {
    // The renderer replaces a browser it shares with the fetcher when a page
    // will not close; the fetcher's page in that browser must not be lost.
    sharedBrowser = new ManagedBrowser(config);
    const sharingFetcher = new BrowserFetcher(config, sharedBrowser);
    retireOnPath = "/retired";

    try {
      const result = await sharingFetcher.fetch(`${baseUrl}/retired`);

      expect(result.status).toBe(FetchStatus.SUCCESS);
      expect(result.content.toString()).toContain("Page /retired");
      expect(requests.filter((path) => path === "/retired")).toHaveLength(2);
    } finally {
      await sharingFetcher.close();
    }
  });
});

describe.skipIf(process.platform === "win32")("Browser that will not close", () => {
  it("kills the Chromium process when closing it times out", async () => {
    const config = loadConfig().scraper;
    config.pageTimeoutMs = 500;
    const managed = new ManagedBrowser(config);
    const browser = await managed.get();
    expect(chromiumPids()).toHaveLength(1);

    // A browser that never answers the close request.
    browser.close = () => new Promise<void>(() => {});
    await managed.retire(browser, "close timed out in test");

    await vi.waitFor(() => expect(chromiumPids()).toHaveLength(0), { timeout: 5000 });
  });
});
