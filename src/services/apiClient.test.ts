import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { listenOnFreePort } from "../../test/test-helpers";
import { createApiClient, createApiLinks, toWebSocketUrl } from "./apiClient";

describe("toWebSocketUrl", () => {
  it("maps an HTTP(S) URL to the matching WebSocket URL, keeping the path", () => {
    const cases = [
      { httpUrl: "http://localhost:8080/api", wsUrl: "ws://localhost:8080/api" },
      { httpUrl: "https://example.com/docs/api", wsUrl: "wss://example.com/docs/api" },
      { httpUrl: "http://worker:8080", wsUrl: "ws://worker:8080/" },
    ];

    for (const { httpUrl, wsUrl } of cases) {
      expect.soft(toWebSocketUrl(httpUrl), httpUrl).toBe(wsUrl);
    }
  });
});

describe("createApiLinks", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    vi.useRealTimers();
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  /** An API server that records WebSocket upgrades and the messages sent over them. */
  async function startApi() {
    const upgrades: string[] = [];
    const messages: string[] = [];
    const wss = new WebSocketServer({ noServer: true });
    wss.on("connection", (ws) => ws.on("message", (data) => messages.push(String(data))));
    const server = createHttpServer((_request, response) =>
      response.writeHead(500).end(),
    );
    server.on("upgrade", (request, socket, head) => {
      upgrades.push(request.url ?? "");
      wss.handleUpgrade(request, socket, head, (ws) =>
        wss.emit("connection", ws, request),
      );
    });
    const port = await listenOnFreePort(server);
    cleanups.push(async () => {
      for (const client of wss.clients) client.terminate();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    return { url: `http://127.0.0.1:${port}`, upgrades, messages, wss };
  }

  it("opens a kept-alive WebSocket at the API URL, path included, only for subscriptions", async () => {
    const api = await startApi();
    const withoutSubscriptions = createApiClient(`${api.url}/docs/api`, {
      subscriptions: false,
    });
    cleanups.push(withoutSubscriptions.close);
    // The query reaches the server over HTTP; a WebSocket would have opened first
    await expect(withoutSubscriptions.api.ping.query()).rejects.toThrow();
    expect(api.upgrades).toEqual([]);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const connected = once(api.wss, "connection");
    const { close } = createApiLinks(`${api.url}/docs/api/`, { subscriptions: true });
    cleanups.push(close);
    await connected;

    expect(api.upgrades).toEqual(["/docs/api"]);
    // Keep-alive pings the server, so a half-open connection is noticed
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      expect(api.messages).toContain("PING");
    });
  });
});

describe("createApiClient", () => {
  // PipelineClient bounds a job lookup the worker never answers by aborting it
  it("rejects a query when its signal aborts while the server stays silent", async () => {
    const sockets = new Set<Socket>();
    const silent = createServer((socket) => sockets.add(socket));
    const port = await listenOnFreePort(silent);
    const { api, close } = createApiClient(`http://127.0.0.1:${port}/api`, {
      subscriptions: false,
    });
    const controller = new AbortController();
    try {
      const connected = once(silent, "connection");
      const lookup = api.getJob.query({ id: "job-1" }, { signal: controller.signal });
      await connected;

      controller.abort();

      await expect(lookup).rejects.toThrow();
    } finally {
      close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });
});
