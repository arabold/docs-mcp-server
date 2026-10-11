/**
 * Relays a remote worker's events onto the local {@link EventBusService}, so
 * code that listens on the bus sees the worker's jobs as it would see jobs it
 * runs itself.
 */

import type { Unsubscribable } from "@trpc/server/observable";
import type { ApiClient } from "../services/apiClient";
import { logger } from "../utils/logger";
import type { EventBusService } from "./EventBusService";
import { EventType } from "./types";

/** First delay before subscribing again after the subscription itself ended. */
const RESUBSCRIBE_BASE_DELAY_MS = 1000;

/** Longest delay between attempts to subscribe again. */
const RESUBSCRIBE_MAX_DELAY_MS = 30_000;

/**
 * Keeps one subscription to the worker's `events.subscribe` on a shared API
 * client and re-emits every event locally.
 *
 * A dropped connection is reconnected and resubscribed by the client's
 * WebSocket; a subscription that ends with an error or is stopped by the worker
 * is subscribed again here, with backoff. When the stream becomes live again
 * after having been live, the relay emits `JOB_LIST_CHANGE` and
 * `LIBRARY_CHANGE` locally, so views refetch what they missed while it was down.
 */
export class RemoteEventProxy {
  private subscription: Unsubscribable | null = null;
  /** Identifies the current subscription, so callbacks from an ended one are ignored. */
  private generation = 0;
  private live = false;
  private wasLive = false;
  private stopped = true;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pending: { promise: Promise<boolean>; settle: (live: boolean) => void } | null =
    null;

  /**
   * @param api The worker's API client; it must have been created with subscriptions.
   * @param eventBus The local bus to re-emit the worker's events on.
   */
  constructor(
    private readonly api: ApiClient,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * Starts the subscription if it is not running and waits until it is live.
   * Calls made while an earlier call still waits share its result.
   *
   * @param timeoutMs How long to wait for the subscription to become live.
   * @returns `true` once the subscription is live; `false` when the connection
   *   fails or nothing is live within `timeoutMs`. Never rejects; the relay
   *   keeps trying in the background.
   */
  connect(timeoutMs: number): Promise<boolean> {
    if (this.stopped) {
      this.stopped = false;
      this.subscribe();
    }
    if (this.live) {
      return Promise.resolve(true);
    }
    if (!this.pending) {
      let settle: (live: boolean) => void = () => {};
      const promise = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => settle(false), timeoutMs);
        settle = (live) => {
          clearTimeout(timer);
          this.pending = null;
          resolve(live);
        };
      });
      this.pending = { promise, settle };
    }
    return this.pending.promise;
  }

  /** Ends the subscription and stops trying to subscribe again. */
  disconnect(): void {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.live = false;
    this.pending?.settle(false);
  }

  /** Whether the worker's events currently reach the local bus. */
  isActive(): boolean {
    return this.live;
  }

  private subscribe(): void {
    const generation = ++this.generation;
    // disconnect() and resubscribeLater() move the generation on
    const current = () => generation === this.generation;
    this.subscription = this.api.events.subscribe.subscribe(undefined, {
      onStarted: () => {
        if (current()) this.setLive(true);
      },
      onData: (event) => {
        if (current()) this.eventBus.emit(event.type, event.payload as never);
      },
      onConnectionStateChange: (state) => {
        if (!current() || state.state !== "connecting") return;
        this.setLive(false);
        // A refused or failed connection will not turn live soon; stop waiting
        if (state.error) this.pending?.settle(false);
      },
      onError: (error) => {
        if (!current()) return;
        logger.debug(`Worker event subscription failed: ${error.message}`);
        this.resubscribeLater();
      },
      onStopped: () => {
        if (current()) this.resubscribeLater();
      },
      onComplete: () => {
        if (current()) this.resubscribeLater();
      },
    });
  }

  private resubscribeLater(): void {
    this.setLive(false);
    this.generation++;
    this.subscription?.unsubscribe();
    this.subscription = null;
    if (this.retryTimer) return;

    const delay = Math.min(
      RESUBSCRIBE_BASE_DELAY_MS * 2 ** this.attempts,
      RESUBSCRIBE_MAX_DELAY_MS,
    );
    this.attempts++;
    // disconnect() clears this timer
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.subscribe();
    }, delay);
    // A pending retry alone must not keep a finished CLI process alive.
    this.retryTimer.unref?.();
  }

  private setLive(live: boolean): void {
    if (live === this.live) return;
    this.live = live;
    if (!live) {
      if (this.wasLive) {
        logger.warn("⚠️  Lost live job updates from the worker; reconnecting");
      }
      return;
    }

    this.attempts = 0;
    this.pending?.settle(true);
    if (this.wasLive) {
      logger.info("🔗 Live job updates from the worker are back");
      // Events sent while the stream was down are lost; have views refetch.
      this.eventBus.emit(EventType.JOB_LIST_CHANGE, undefined);
      this.eventBus.emit(EventType.LIBRARY_CHANGE, undefined);
    } else {
      logger.debug("Subscribed to the worker's events");
    }
    this.wasLive = true;
  }
}
