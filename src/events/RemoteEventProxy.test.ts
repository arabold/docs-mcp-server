import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import { type ApiClient, createApiClient } from "../services/apiClient";
import type { SystemInfo } from "../services/systemInfo";
import { applyTrpcWebSocketHandler } from "../services/trpcService";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { EventBusService } from "./EventBusService";
import { RemoteEventProxy } from "./RemoteEventProxy";
import { EventType } from "./types";

/** A worker's event stream: the application router over a WebSocket server. */
async function startWorkerEvents(port = 0) {
  const eventBus = new EventBusService();
  const wss = new WebSocketServer({ host: "127.0.0.1", port });
  await once(wss, "listening");
  applyTrpcWebSocketHandler(
    wss,
    {} as IPipeline,
    {} as IDocumentManagement,
    eventBus,
    {} as SystemInfo,
  );
  return {
    eventBus,
    port: (wss.address() as AddressInfo).port,
    async stop() {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

describe("RemoteEventProxy", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  function relayTo(port: number) {
    const localBus = new EventBusService();
    const { api, close } = createApiClient(`http://127.0.0.1:${port}/api`, {
      subscriptions: true,
    });
    const relay = new RemoteEventProxy(api, localBus);
    cleanups.push(() => {
      relay.disconnect();
      close();
    });
    return { relay, localBus };
  }

  it("resolves connect once live, and relays an event emitted right after", async () => {
    const worker = await startWorkerEvents();
    cleanups.push(() => worker.stop());
    const { relay, localBus } = relayTo(worker.port);
    const received = new Promise<void>((resolve) =>
      localBus.on(EventType.LIBRARY_CHANGE, () => resolve()),
    );

    await expect(relay.connect(5000)).resolves.toBe(true);
    worker.eventBus.emit(EventType.LIBRARY_CHANGE, undefined);

    await received;
    expect(relay.isActive()).toBe(true);
  });

  it("resolves connect with false when the worker refuses the connection", async () => {
    const worker = await startWorkerEvents();
    const { port } = worker;
    await worker.stop();
    const { relay } = relayTo(port);

    await expect(relay.connect(5000)).resolves.toBe(false);
    expect(relay.isActive()).toBe(false);
  });

  it("connects once for calls made while connecting, and relays each event once", async () => {
    const worker = await startWorkerEvents();
    cleanups.push(() => worker.stop());
    const { relay, localBus } = relayTo(worker.port);
    let libraryChanges = 0;
    localBus.on(EventType.LIBRARY_CHANGE, () => libraryChanges++);
    const listChanged = new Promise<void>((resolve) =>
      localBus.on(EventType.JOB_LIST_CHANGE, () => resolve()),
    );

    await expect(
      Promise.all([relay.connect(5000), relay.connect(5000)]),
    ).resolves.toEqual([true, true]);
    // A second subscription would deliver the first event again before the second
    worker.eventBus.emit(EventType.LIBRARY_CHANGE, undefined);
    worker.eventBus.emit(EventType.JOB_LIST_CHANGE, undefined);
    await listChanged;

    expect(libraryChanges).toBe(1);
  });

  it("reports a dropped stream as down, and as live again once the worker is back", async () => {
    const worker = await startWorkerEvents();
    const { relay, localBus } = relayTo(worker.port);
    await relay.connect(5000);

    await worker.stop();
    await vi.waitFor(() => expect(relay.isActive()).toBe(false));

    const restarted = await startWorkerEvents(worker.port);
    cleanups.push(() => restarted.stop());
    await vi.waitFor(() => expect(relay.isActive()).toBe(true), { timeout: 10_000 });
    const received = new Promise<void>((resolve) =>
      localBus.on(EventType.JOB_PROGRESS, () => resolve()),
    );
    restarted.eventBus.emit(EventType.JOB_PROGRESS, {} as never);

    await received;
  }, 15_000);

  it("asks views to refetch when the stream comes back, not on the first connect", async () => {
    const worker = await startWorkerEvents();
    const { relay, localBus } = relayTo(worker.port);
    const refetches: EventType[] = [];
    localBus.on(EventType.JOB_LIST_CHANGE, () =>
      refetches.push(EventType.JOB_LIST_CHANGE),
    );
    localBus.on(EventType.LIBRARY_CHANGE, () => refetches.push(EventType.LIBRARY_CHANGE));

    await relay.connect(5000);
    expect(refetches).toEqual([]);

    await worker.stop();
    await vi.waitFor(() => expect(relay.isActive()).toBe(false));
    const restarted = await startWorkerEvents(worker.port);
    cleanups.push(() => restarted.stop());
    await vi.waitFor(() => expect(relay.isActive()).toBe(true), { timeout: 10_000 });

    expect(refetches).toEqual([EventType.JOB_LIST_CHANGE, EventType.LIBRARY_CHANGE]);
  }, 15_000);

  it("subscribes again on the same client after the subscription fails", async () => {
    vi.useFakeTimers();
    cleanups.push(() => {
      vi.useRealTimers();
    });
    const observers: Array<{ onError: (error: Error) => void }> = [];
    const subscribe = vi.fn((_input: unknown, observer: (typeof observers)[number]) => {
      observers.push(observer);
      return { unsubscribe: vi.fn() };
    });
    const api = { events: { subscribe: { subscribe } } } as unknown as ApiClient;
    const relay = new RemoteEventProxy(api, new EventBusService());
    cleanups.push(() => relay.disconnect());

    void relay.connect(60_000);
    observers[0]?.onError(new Error("worker restarted"));
    await vi.advanceTimersByTimeAsync(1000);

    expect(subscribe).toHaveBeenCalledTimes(2);
  });
});
