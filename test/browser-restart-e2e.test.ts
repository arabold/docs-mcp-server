/**
 * BrowserFetcher against a real Chromium that dies mid-crawl (issue #531).
 *
 * Chromium is killed with SIGKILL, the way the OS ends it under memory
 * pressure. The fetcher must launch a new browser for the pages that follow,
 * retry the page Chromium died loading, and never start more than one browser
 * for pages that ask at the same time.
 */

import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserFetcher } from "../src/scraper/fetcher/BrowserFetcher";
import { FetchStatus } from "../src/scraper/fetcher/types";
import { type AppConfig, loadConfig } from "../src/utils/config";
import { listenOnFreePort } from "./test-helpers";

/**
 * PIDs of the Chromium browsers this test process launched. Playwright starts
 * the browser as a direct child, talking to it over `--remote-debugging-pipe`;
 * its renderer and GPU helpers are children of the browser, not of this process.
 */
function chromiumPids(): number[] {
  // pgrep exits with 1 when nothing matches, which spawnSync does not treat as
  // an error.
  const { stdout } = spawnSync(
    "pgrep",
    ["-P", String(process.pid), "-f", "remote-debugging-pipe"],
    { encoding: "utf8" },
  );
  return stdout.split("\n").filter(Boolean).map(Number);
}

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
  let server: Server;
  let baseUrl: string;
  let config: AppConfig["scraper"];
  let fetcher: BrowserFetcher;

  beforeAll(async () => {
    // CI installs Playwright's browsers with --no-shell, so point the fetcher
    // at the full Chromium build, as the Docker image does with its own.
    if (!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
      vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", chromium.executablePath());
    }

    server = createServer((req, res) => {
      const path = req.url ?? "/";
      requests.push(path);
      if (path === crashOnPath) {
        // Chromium dies while this page loads; the request is never answered.
        crashOnPath = null;
        killChromium();
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
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    requests.length = 0;
    crashOnPath = null;
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
});
