/**
 * E2E test for serving the whole application under a base path behind a
 * reverse proxy, e.g. `https://example.com/docs`.
 *
 * A small Node proxy stands in for nginx/Traefik. It forwards `/docs/*` in two
 * modes, prefix stripped (nginx `proxy_pass http://up/;`, Traefik StripPrefix)
 * and prefix forwarded, plus the one extra rule the proxy guide recommends for
 * the RFC 9728 host-root metadata location. Both modes must behave the same.
 * Playwright then drives the web UI under the base path.
 */

import { createServer } from "node:http";
import { Client, SSEClientTransport } from "@modelcontextprotocol/client";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LogLevel, setLogLevel } from "../src/utils/logger";
import { startInProcessServer } from "./in-process-server";
import {
  getFreePort,
  type LocalIssuer,
  listenOnFreePort,
  startLocalIssuer,
  startPrefixProxy,
  tryNodeWebSocket,
} from "./test-helpers";

const BASE_PATH = "/docs";

describe("Serving under a base path behind a reverse proxy", () => {
  let issuer: LocalIssuer;
  let proxy: Awaited<ReturnType<typeof startPrefixProxy>>;
  let docsServer: Awaited<ReturnType<typeof startInProcessServer>> | undefined;
  let proxyOrigin = "";
  let publicUrl = "";

  beforeAll(async () => {
    setLogLevel(LogLevel.ERROR);
    issuer = await startLocalIssuer();
    const upstreamPort = await getFreePort();
    proxy = await startPrefixProxy(upstreamPort, BASE_PATH);
    proxyOrigin = `http://127.0.0.1:${proxy.port}`;
    publicUrl = `${proxyOrigin}${BASE_PATH}`;
    docsServer = await startInProcessServer({ port: upstreamPort, publicUrl, issuerUrl: issuer.url });
  }, 30000);

  afterAll(async () => {
    await docsServer?.stop();
    await proxy?.close();
    await issuer?.close();
  });

  describe.each(["strip", "forward"] as const)("with the proxy in %s mode", (mode) => {
    beforeAll(() => {
      proxy.setMode(mode);
    });

    it("serves the shell with a base element and assets under the path", async () => {
      const response = await fetch(`${publicUrl}/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain(`<base href="${BASE_PATH}/">`);
      const script = html.match(/src="\.\/(assets\/[^"]+\.js)"/)?.[1];
      expect(script).toBeDefined();
      const asset = await fetch(`${publicUrl}/${script}`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toContain("javascript");
    });

    it("serves the shell for a deep link", async () => {
      const response = await fetch(`${publicUrl}/libraries/react`);

      expect(response.status).toBe(200);
      expect(await response.text()).toContain(`<base href="${BASE_PATH}/">`);
    });

    it("serves the API and its WebSocket under the path", async () => {
      const api = await fetch(`${publicUrl}/api/ping`);

      expect(api.status).toBe(200);
      expect(await tryNodeWebSocket(`${publicUrl.replace(/^http/, "ws")}/api`)).toBe("open");
    });

    it("serves MCP under the path", async () => {
      const token = await issuer.mint({ aud: `${publicUrl}/mcp` });

      const response = await fetch(`${publicUrl}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/list",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect((await response.json()).result.tools.length).toBeGreaterThan(0);
    });

    it.each([
      ["the advertised location", `${BASE_PATH}/.well-known/oauth-protected-resource/mcp`],
      ["the RFC 9728 host-root location", `/.well-known/oauth-protected-resource${BASE_PATH}/mcp`],
    ])("serves the protected resource metadata at %s", async (_label, pathname) => {
      const response = await fetch(`${proxyOrigin}${pathname}`);

      expect(response.status).toBe(200);
      expect((await response.json()).resource).toBe(`${publicUrl}/mcp`);
    });

    it("does not serve the deprecated SSE transport", async () => {
      const response = await fetch(`${publicUrl}/sse`);

      expect(response.status).toBe(404);
    });
  });

  describe("web UI in a browser", () => {
    let browser: Awaited<ReturnType<typeof chromium.launch>>;

    beforeAll(async () => {
      proxy.setMode("strip");
      browser = await chromium.launch();
    }, 30000);

    afterAll(async () => {
      await browser?.close();
    });

    it("loads a deep link, keeps every request under the path, and navigates within it", async () => {
      const page = await browser.newPage();
      const requested: string[] = [];
      const sockets: string[] = [];
      page.on("request", (request) => requested.push(request.url()));
      page.on("websocket", (socket) => sockets.push(socket.url()));

      await page.goto(`${publicUrl}/libraries/react`);
      const jobsLink = page.locator(`a[href="${BASE_PATH}/jobs"]`);
      await jobsLink.waitFor();

      const iconWidths = await page.evaluate(() =>
        Array.from(document.querySelectorAll("svg use")).map(
          (use) => use.getBoundingClientRect().width,
        ),
      );
      expect(iconWidths.length).toBeGreaterThan(0);
      expect(Math.max(...iconWidths)).toBeGreaterThan(0);

      if (sockets.length === 0) {
        await page.waitForEvent("websocket", { timeout: 10000 });
      }
      expect(sockets).toContain(`${publicUrl.replace(/^http/, "ws")}/api`);

      const sameOrigin = requested.filter((url) => url.startsWith(proxyOrigin));
      expect(sameOrigin.length).toBeGreaterThan(0);
      for (const url of sameOrigin) {
        expect(new URL(url).pathname.startsWith(`${BASE_PATH}/`), url).toBe(true);
      }

      await jobsLink.click();
      await page.waitForURL(`${publicUrl}/jobs`);
      await page.close();
    }, 60000);

    it("lets a page on another allowed origin read the MCP endpoint's challenge", async () => {
      const pageServer = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>client</title>");
      });
      const pagePort = await listenOnFreePort(pageServer);
      const page = await browser.newPage();
      try {
        // A different origin than the proxy's, and allowed because its host is loopback.
        await page.goto(`http://localhost:${pagePort}/`);
        const result = await page.evaluate(async (endpoint) => {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "mcp-protocol-version": "2026-07-28",
              "mcp-method": "tools/list",
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
          });
          return { status: response.status, challenge: response.headers.get("www-authenticate") };
        }, `${publicUrl}/mcp`);

        expect(result.status).toBe(401);
        expect(result.challenge).toContain(
          `resource_metadata="${publicUrl}/.well-known/oauth-protected-resource/mcp"`,
        );
      } finally {
        await page.close();
        await new Promise<void>((resolve) => pageServer.close(() => resolve()));
      }
    }, 60000);
  });
});

describe("Deprecated SSE transport under a base path, without authentication", () => {
  let proxy: Awaited<ReturnType<typeof startPrefixProxy>>;
  let docsServer: Awaited<ReturnType<typeof startInProcessServer>> | undefined;
  let publicUrl = "";

  beforeAll(async () => {
    setLogLevel(LogLevel.ERROR);
    const upstreamPort = await getFreePort();
    proxy = await startPrefixProxy(upstreamPort, BASE_PATH);
    publicUrl = `http://127.0.0.1:${proxy.port}${BASE_PATH}`;
    docsServer = await startInProcessServer({ port: upstreamPort, publicUrl });
  }, 30000);

  afterAll(async () => {
    await docsServer?.stop();
    await proxy?.close();
  });

  describe.each(["strip", "forward"] as const)("with the proxy in %s mode", (mode) => {
    beforeAll(() => {
      proxy.setMode(mode);
    });

    it("names the message URL under the path in the endpoint event", async () => {
      const abort = new AbortController();
      const response = await fetch(`${publicUrl}/sse`, { signal: abort.signal });
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let received = "";
      while (reader && !received.includes("\n\n")) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        received += decoder.decode(value, { stream: true });
      }
      abort.abort();

      expect(received).toMatch(
        new RegExp(`^event: endpoint\\ndata: ${BASE_PATH}/messages\\?sessionId=[\\w-]+\\n\\n`),
      );
    });

    it("serves a handshake-era client through the proxy", async () => {
      const client = new Client({ name: "base-path-legacy-sse", version: "1.0.0" });
      await client.connect(new SSEClientTransport(new URL(`${publicUrl}/sse`)));
      try {
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toContain("search_docs");
      } finally {
        await client.close();
      }
    }, 30000);
  });
});
