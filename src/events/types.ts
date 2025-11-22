/**
 * Centralized event type definitions for the event bus system.
 * This serves as the single source of truth for all events in the application.
 */

import type { PipelineJob } from "../pipeline/types";
import type { ScraperProgressEvent } from "../scraper/types";

/**
 * Event type enum used by the EventBusService.
 * These are the internal event identifiers.
 */
export enum EventType {
  JOB_STATUS_CHANGE = "JOB_STATUS_CHANGE",
  JOB_PROGRESS = "JOB_PROGRESS",
  LIBRARY_CHANGE = "LIBRARY_CHANGE",
}

/**
 * Server-side event names used in SSE messages.
 * These match the event names expected by the frontend EventClient.
 */
export const ServerEventName = {
  [EventType.JOB_STATUS_CHANGE]: "job-status-change",
  [EventType.JOB_PROGRESS]: "job-progress",
  [EventType.LIBRARY_CHANGE]: "library-change",
} as const;

/**
 * Type-safe mapping of event types to their payload structures.
 */
export interface EventPayloads {
  [EventType.JOB_STATUS_CHANGE]: PipelineJob;
  [EventType.JOB_PROGRESS]: {
    job: PipelineJob;
    progress: ScraperProgressEvent;
  };
  [EventType.LIBRARY_CHANGE]: undefined;
}

/**
 * Type-safe event listener callback.
 */
export type EventListener<T extends EventType> = (payload: EventPayloads[T]) => void;

/**
 * SSE message payload types that are sent to the frontend.
 * These define the exact structure of data transmitted over the wire.
 */
export interface SseEventPayloads {
  "job-status-change": {
    id: string;
    library: string;
    version: string | null;
    status: string;
    error: { message: string } | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    sourceUrl: string | null;
  };
  "job-progress": {
    id: string;
    library: string;
    version: string | null;
    progress: {
      pagesScraped: number;
      totalPages: number;
      totalDiscovered: number;
      currentUrl: string;
      depth: number;
      maxDepth: number;
    };
  };
  "library-change": Record<string, never>;
}

/**
 * Union type of all SSE event names.
 */
export type SseEventName = keyof SseEventPayloads;
