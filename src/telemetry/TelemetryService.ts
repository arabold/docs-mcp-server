/**
 * TelemetryService listens to events from the EventBusService and tracks them to analytics.
 * This decouples telemetry concerns from the PipelineManager, following the event-driven architecture.
 */

import type { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import type { PipelineJob } from "../pipeline/types";
import type { ScraperProgressEvent } from "../scraper/types";
import { logger } from "../utils/logger";
import { analytics, TelemetryEvent } from "./analytics";

export class TelemetryService {
  private eventBus: EventBusService;
  private unsubscribers: (() => void)[] = [];

  constructor(eventBus: EventBusService) {
    this.eventBus = eventBus;
    this.setupEventListeners();
  }

  /**
   * Sets up event listeners for pipeline events.
   */
  private setupEventListeners(): void {
    // Listen to job status changes
    const unsubStatusChange = this.eventBus.on(
      EventType.JOB_STATUS_CHANGE,
      this.handleJobStatusChange.bind(this),
    );

    // Listen to job progress events for error tracking
    const unsubProgress = this.eventBus.on(
      EventType.JOB_PROGRESS,
      this.handleJobProgress.bind(this),
    );

    this.unsubscribers.push(unsubStatusChange, unsubProgress);

    logger.debug("TelemetryService initialized and listening to events");
  }

  /**
   * Handles job status change events and tracks them to analytics.
   */
  private handleJobStatusChange(job: PipelineJob): void {
    const duration = job.startedAt ? Date.now() - job.startedAt.getTime() : null;
    const queueWaitTime =
      job.startedAt && job.createdAt
        ? job.startedAt.getTime() - job.createdAt.getTime()
        : null;

    analytics.track(TelemetryEvent.PIPELINE_JOB_COMPLETED, {
      jobId: job.id,
      library: job.library,
      status: job.status,
      durationMs: duration,
      queueWaitTimeMs: queueWaitTime,
      pagesProcessed: job.progressPages || 0,
      maxPagesConfigured: job.progressMaxPages || 0,
      hasVersion: !!job.version,
      hasError: !!job.error,
      throughputPagesPerSecond:
        duration && job.progressPages
          ? Math.round((job.progressPages / duration) * 1000)
          : 0,
    });
  }

  /**
   * Handles job progress events. Currently a no-op but can be extended
   * for progress-specific telemetry tracking.
   */
  private handleJobProgress(_event: {
    job: PipelineJob;
    progress: ScraperProgressEvent;
  }): void {
    // Currently no telemetry needed for progress events
    // This handler is here for future extensibility
  }

  /**
   * Cleans up event listeners.
   */
  shutdown(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    logger.debug("TelemetryService shut down");
  }
}
