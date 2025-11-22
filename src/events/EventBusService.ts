/**
 * Central event bus service for application-wide event distribution.
 *
 * This service provides a pub/sub mechanism that can be used by any service
 * to emit and listen for events. Events emitted here can be:
 * - Consumed locally by in-process subscribers
 * - Broadcast to remote processes via tRPC subscriptions
 * - Forwarded to SSE clients via the web service
 *
 * This decouples event producers (like DocumentManagementService) from
 * consumers (like the Web UI), enabling a clean, scalable architecture.
 */

import EventEmitter from "node:events";
import { logger } from "../utils/logger";
import type { EventListener, EventPayloads, EventType } from "./types";

/**
 * Central event bus for application-wide events.
 */
export class EventBusService {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    // Increase max listeners to support multiple subscribers
    this.emitter.setMaxListeners(100);
  }

  /**
   * Emit an event to all subscribers.
   */
  emit<T extends EventType>(eventType: T, payload: EventPayloads[T]): void {
    logger.debug(`Event emitted: ${eventType}`);
    this.emitter.emit(eventType, payload);
  }

  /**
   * Subscribe to events of a specific type.
   * Returns an unsubscribe function.
   */
  on<T extends EventType>(eventType: T, listener: EventListener<T>): () => void {
    this.emitter.on(eventType, listener);
    return () => this.emitter.off(eventType, listener);
  }

  /**
   * Subscribe to events once (auto-unsubscribes after first event).
   */
  once<T extends EventType>(eventType: T, listener: EventListener<T>): void {
    this.emitter.once(eventType, listener);
  }

  /**
   * Remove a specific listener.
   */
  off<T extends EventType>(eventType: T, listener: EventListener<T>): void {
    this.emitter.off(eventType, listener);
  }

  /**
   * Remove all listeners for a specific event type, or all listeners if no type specified.
   */
  removeAllListeners(eventType?: EventType): void {
    if (eventType === undefined) {
      this.emitter.removeAllListeners();
    } else {
      this.emitter.removeAllListeners(eventType);
    }
  }

  /**
   * Get the count of listeners for a specific event type.
   */
  listenerCount(eventType: EventType): number {
    return this.emitter.listenerCount(eventType);
  }
}
