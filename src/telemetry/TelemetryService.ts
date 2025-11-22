/**
 * TelemetryService listens to events from the EventBusService and tracks them to analytics.
 * This decouples telemetry concerns from the PipelineManager, following the event-driven architecture.
 */

import type { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import { type PipelineJob, PipelineJobStatus } from "../pipeline/types";
import type { ScraperProgressEvent } from "../scraper/types";
import { logger } from "../utils/logger";
import { TelemetryEvent, telemetry } from "./telemetry";

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
   * Only tracks events for meaningful state transitions: started, completed, and failed.
   */
  private handleJobStatusChange(job: PipelineJob): void {
    const duration = job.startedAt ? Date.now() - job.startedAt.getTime() : null;
    const queueWaitTime =
      job.startedAt && job.createdAt
        ? job.startedAt.getTime() - job.createdAt.getTime()
        : null;

    switch (job.status) {
      case PipelineJobStatus.RUNNING:
        telemetry.track(TelemetryEvent.PIPELINE_JOB_STARTED, {
          jobId: job.id,
          library: job.library,
          hasVersion: !!job.version,
          maxPagesConfigured: job.progressMaxPages || 0,
          queueWaitTimeMs: queueWaitTime,
        });
        break;

      case PipelineJobStatus.COMPLETED:
        telemetry.track(TelemetryEvent.PIPELINE_JOB_COMPLETED, {
          jobId: job.id,
          library: job.library,
          durationMs: duration,
          pagesProcessed: job.progressPages || 0,
          maxPagesConfigured: job.progressMaxPages || 0,
          hasVersion: !!job.version,
          throughputPagesPerSecond:
            duration && job.progressPages
              ? Math.round((job.progressPages / duration) * 1000)
              : 0,
        });
        break;

      case PipelineJobStatus.FAILED:
        telemetry.track(TelemetryEvent.PIPELINE_JOB_FAILED, {
          jobId: job.id,
          library: job.library,
          durationMs: duration,
          pagesProcessed: job.progressPages || 0,
          maxPagesConfigured: job.progressMaxPages || 0,
          hasVersion: !!job.version,
          hasError: !!job.error,
          errorMessage: job.error?.message,
        });
        break;

      // Ignore queued, cancelling, and cancelled states - no telemetry needed
      default:
        break;
    }
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
