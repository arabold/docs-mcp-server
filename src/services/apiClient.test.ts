import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { createWSClient } from "@trpc/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listenOnFreePort } from "../../test/test-helpers";
import { createApiClient, createApiLinks, toWebSocketUrl } from "./apiClient";

vi.mock("@trpc/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@trpc/client")>();
  return { ...actual, createWSClient: vi.fn(() => ({ close: vi.fn() })) };
});

describe("toWebSocketUrl", () => {
  it.each([
    ["http://localhost:8080/api", "ws://localhost:8080/api"],
    ["https://example.com/docs/api", "wss://example.com/docs/api"],
    ["http://worker:8080", "ws://worker:8080/"],
  ])("maps %s to %s, keeping the path", (httpUrl, wsUrl) => {
    expect(toWebSocketUrl(httpUrl)).toBe(wsUrl);
  });
});

describe("createApiLinks", () => {
  beforeEach(() => {
    vi.mocked(createWSClient).mockClear();
  });

  it("opens the WebSocket at the API URL, path included", () => {
    createApiLinks("https://example.com/docs/api/", { subscriptions: true });

    expect(createWSClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "wss://example.com/docs/api",
        keepAlive: { enabled: true },
      }),
    );
  });

  it("opens no WebSocket without subscriptions", () => {
    const { links } = createApiLinks("http://localhost:8080/api", {
      subscriptions: false,
    });

    expect(createWSClient).not.toHaveBeenCalled();
    expect(links).toHaveLength(1);
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
