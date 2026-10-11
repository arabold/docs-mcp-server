import { createWSClient } from "@trpc/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("closes the WebSocket it opened", () => {
    const { close } = createApiClient("http://localhost:8080/api", {
      subscriptions: true,
    });
    close();

    const wsClient = vi.mocked(createWSClient).mock.results[0]?.value;
    expect(wsClient.close).toHaveBeenCalledTimes(1);
  });
});
