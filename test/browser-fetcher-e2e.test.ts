/**
 * BrowserFetcher against a real Chromium and a local server.
 *
 * The browser fetcher exists to get past pages that a plain HTTP request
 * cannot, such as JavaScript challenges, so the page it loads must be able to
 * run its scripts.
 */

import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserFetcher } from "../src/scraper/fetcher/BrowserFetcher";
import { FetchStatus } from "../src/scraper/fetcher/types";
import { loadConfig } from "../src/utils/config";
import { listenOnFreePort } from "./test-helpers";

describe("BrowserFetcher in a real browser", () => {
  const requests: string[] = [];
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? "/";
      requests.push(path);
      if (path === "/app.js") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end("document.body.dataset.ran = 'yes';");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<html><body><h1>Docs</h1><script src="/app.js"></script></body></html>');
    });
    baseUrl = `http://127.0.0.1:${await listenOnFreePort(server)}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("runs the page's scripts even when the request headers name Sec-Fetch values", async () => {
    const config = loadConfig().scraper;
    // The test server listens on loopback.
    config.security.network.allowPrivateNetworks = true;
    const fetcher = new BrowserFetcher(config);

    try {
      // Generated fingerprints sometimes carry these; Chromium must set its own.
      const result = await fetcher.fetch(`${baseUrl}/`, {
        headers: {
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-User": "?1",
          "Sec-Fetch-Dest": "document",
        },
      });

      expect(result.status).toBe(FetchStatus.SUCCESS);
      expect(requests).toContain("/app.js");
      expect(result.content.toString()).toContain('data-ran="yes"');
    } finally {
      await fetcher.close();
    }
  });
});
