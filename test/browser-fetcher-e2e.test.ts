/**
 * BrowserFetcher against a real Chromium and a local server.
 *
 * The browser fetcher exists to get past pages that a plain HTTP request
 * cannot, such as JavaScript challenges, so the page it loads must be able to
 * run its scripts. Files the browser would download instead of showing are
 * fetched through the request API. With private networks blocked, no request
 * the page makes, and no redirect it follows, may reach a blocked address.
 */

import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BrowserFetcher } from "../src/scraper/fetcher/BrowserFetcher";
import { FetchStatus } from "../src/scraper/fetcher/types";
import { loadConfig } from "../src/utils/config";
import { AccessPolicyError } from "../src/utils/errors";
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
      if (path === "/openapi.yaml") {
        res.writeHead(200, { "content-type": "application/x-yaml" });
        res.end("openapi: 3.1.0\n");
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

  it("fetches a file the browser would download through the request API", async () => {
    const config = loadConfig().scraper;
    config.security.network.allowPrivateNetworks = true;
    const fetcher = new BrowserFetcher(config);

    try {
      const result = await fetcher.fetch(`${baseUrl}/openapi.yaml`);

      expect(result.status).toBe(FetchStatus.SUCCESS);
      expect(result.mimeType).toBe("application/x-yaml");
      expect(result.content.toString()).toBe("openapi: 3.1.0\n");
    } finally {
      await fetcher.close();
    }
  });
});

describe("BrowserFetcher with private networks blocked", () => {
  // Both servers listen on loopback. The policy lets the docs site through by
  // its host name, `localhost`, and blocks the loopback address `127.0.0.1`,
  // under which the page reaches the internal service.
  const docsRequests: string[] = [];
  const internalRequests: string[] = [];
  let docsServer: Server;
  let internalServer: Server;
  let docsUrl: string;
  let internalUrl: string;
  let fetcher: BrowserFetcher;

  beforeAll(async () => {
    internalServer = createServer((req, res) => {
      internalRequests.push(req.url ?? "/");
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>internal</body></html>");
    });
    internalUrl = `http://127.0.0.1:${await listenOnFreePort(internalServer)}`;

    docsServer = createServer((req, res) => {
      const path = req.url ?? "/";
      docsRequests.push(path);
      if (path === "/app.js") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end("document.body.dataset.ran = 'yes';");
        return;
      }
      if (path === "/moved") {
        res.writeHead(302, { location: `${internalUrl}/latest/meta-data/` });
        res.end();
        return;
      }
      if (path === "/moved.js") {
        res.writeHead(302, { location: `${internalUrl}/moved.js` });
        res.end();
        return;
      }
      if (path === "/redirecting-script") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end('<html><body><h1>Docs</h1><script src="/moved.js"></script></body></html>');
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<html><body><h1>Docs</h1><script src="${internalUrl}/track.js"></script>` +
          `<img src="${internalUrl}/pixel.png"><script src="/app.js"></script></body></html>`,
      );
    });
    docsUrl = `http://localhost:${await listenOnFreePort(docsServer)}`;

    const config = loadConfig().scraper;
    config.security.network.allowPrivateNetworks = false;
    config.security.network.allowedHosts = ["localhost"];
    fetcher = new BrowserFetcher(config);
  });

  beforeEach(() => {
    docsRequests.length = 0;
    internalRequests.length = 0;
  });

  afterAll(async () => {
    await fetcher.close();
    for (const server of [docsServer, internalServer]) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("loads the page without the resources it asks of a blocked address", async () => {
    const result = await fetcher.fetch(`${docsUrl}/`);

    expect(result.status).toBe(FetchStatus.SUCCESS);
    expect(result.content.toString()).toContain("<h1>Docs</h1>");
    // The page's own script still ran: only the blocked address was cut off.
    expect(result.content.toString()).toContain('data-ran="yes"');
    expect(internalRequests).toEqual([]);
  });

  it("refuses a redirect to a blocked address without following it", async () => {
    const error = await fetcher.fetch(`${docsUrl}/moved`).catch((e) => e);

    expect(error).toBeInstanceOf(AccessPolicyError);
    expect(docsRequests).toContain("/moved");
    expect(internalRequests).toEqual([]);
  });

  it("blocks a resource that redirects to a blocked address", async () => {
    const result = await fetcher.fetch(`${docsUrl}/redirecting-script`);

    expect(result.status).toBe(FetchStatus.SUCCESS);
    expect(docsRequests).toContain("/moved.js");
    expect(internalRequests).toEqual([]);
  });
});
