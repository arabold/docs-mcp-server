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
  JOB_LIST_CHANGE = "JOB_LIST_CHANGE",
}

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
  [EventType.JOB_LIST_CHANGE]: undefined;
}

/**
 * Type-safe event listener callback.
 */
export type EventListener<T extends EventType> = (payload: EventPayloads[T]) => void;
