/**
 * Client for connecting to real-time server events via SSE.
 * Provides a consistent interface for subscribing to application events.
 */

import type { SseEventName, SseEventPayloads } from "../events/types";
import { ServerEventName } from "../events/types";

export interface EventData<T extends SseEventName = SseEventName> {
  type: T;
  payload: SseEventPayloads[T];
}

export type EventCallback = (event: EventData) => void;

/**
 * Event client that manages SSE connection to the backend.
 */
export class EventClient {
  private callbacks: Set<EventCallback> = new Set();
  private eventSource?: EventSource;
  private reconnectTimeout?: ReturnType<typeof setTimeout>;
  private isConnected = false;

  /**
   * Start the SSE connection.
   */
  connect(): void {
    if (this.eventSource) {
      console.warn("EventClient already connected");
      return;
    }

    console.log("📡 Connecting to SSE endpoint...");

    this.eventSource = new EventSource("/web/events");

    this.eventSource.addEventListener("open", () => {
      console.log("📡 SSE connection established");
      this.isConnected = true;
    });

    this.eventSource.addEventListener("error", (event) => {
      console.error("❌ SSE connection error:", event);
      this.isConnected = false;
      // EventSource will automatically attempt to reconnect
    });

    // Listen for all event types defined in ServerEventName
    const eventTypes = Object.values(ServerEventName) as SseEventName[];

    console.log("🔧 Setting up event listeners", eventTypes);

    for (const eventType of eventTypes) {
      this.eventSource.addEventListener(eventType, (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          this.notifyCallbacks({
            type: eventType,
            payload,
          });
        } catch (error) {
          console.error(`Failed to parse SSE event data: ${error}`);
        }
      });
    }

    // Add a generic message listener as a fallback to catch any events
    this.eventSource.addEventListener("message", (event: MessageEvent) => {
      console.log("📨 Generic message event received:", event.data);
    });
  }

  /**
   * Subscribe to events with a callback.
   * @param callback Function to call when events are received
   * @returns Unsubscribe function
   */
  subscribe(callback: EventCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  /**
   * Disconnect and clean up resources.
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }

    this.isConnected = false;
  }

  /**
   * Notify all callbacks of an event.
   */
  private notifyCallbacks(event: EventData): void {
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error("Error in event callback:", error);
      }
    }
  }

  /**
   * Check if the client is currently connected.
   */
  isActive(): boolean {
    return this.isConnected;
  }
}
