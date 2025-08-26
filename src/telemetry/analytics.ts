/**
 * Analytics wrapper for privacy-first telemetry using PostHog.
 * Provides global context and automatic data sanitization.
 *
 * Architecture:
 * - PostHogClient: Handles PostHog SDK integration and event capture
 * - Analytics: High-level coordinator providing public API with global context
 */

import { logger } from "../utils/logger";
import type { TelemetryEventPropertiesMap } from "./eventTypes";
import { PostHogClient } from "./postHogClient";
import { generateInstallationId, TelemetryConfig } from "./TelemetryConfig";

/**
 * Telemetry event types for structured analytics
 */
export enum TelemetryEvent {
  APP_STARTED = "app_started",
  APP_SHUTDOWN = "app_shutdown",
  TOOL_USED = "tool_used",
  HTTP_REQUEST_COMPLETED = "http_request_completed",
  PIPELINE_JOB_PROGRESS = "pipeline_job_progress",
  PIPELINE_JOB_COMPLETED = "pipeline_job_completed",
  DOCUMENT_PROCESSED = "document_processed",
}

/**
 * Main analytics class providing privacy-first telemetry
 */
export class Analytics {
  private postHogClient: PostHogClient;
  private enabled: boolean = true;
  private distinctId: string;
  private globalContext: Record<string, unknown> = {};

  constructor(enabled?: boolean) {
    this.enabled = enabled ?? TelemetryConfig.getInstance().isEnabled();
    this.distinctId = generateInstallationId();

    this.postHogClient = new PostHogClient(this.enabled);

    if (this.enabled) {
      logger.debug("Analytics enabled");
    } else {
      logger.debug("Analytics disabled");
    }
  }

  /**
   * Set global application context that will be included in all events
   */
  setGlobalContext(context: Record<string, unknown>): void {
    this.globalContext = { ...context };
  }

  /**
   * Get current global context
   */
  getGlobalContext(): Record<string, unknown> {
    return { ...this.globalContext };
  }

  /**
   * Track an event with automatic global context inclusion
   *
   * Type-safe overloads for specific events:
   */
  track<T extends keyof TelemetryEventPropertiesMap>(
    event: T,
    properties: TelemetryEventPropertiesMap[T],
  ): void;
  track(event: string, properties?: Record<string, unknown>): void;
  track(event: string, properties: Record<string, unknown> = {}): void {
    if (!this.enabled) return;

    // Merge global context and event properties with timestamp
    const enrichedProperties = {
      ...this.globalContext,
      ...properties,
      timestamp: new Date().toISOString(),
    };
    this.postHogClient.capture(this.distinctId, event, enrichedProperties);
  }

  /**
   * Capture exception using PostHog's native error tracking with global context
   */
  captureException(error: Error, properties: Record<string, unknown> = {}): void {
    if (!this.enabled) return;

    // Merge global context and error properties with timestamp
    const enrichedProperties = {
      ...this.globalContext,
      ...properties,
      timestamp: new Date().toISOString(),
    };
    this.postHogClient.captureException(this.distinctId, error, enrichedProperties);
  }

  /**
   * Graceful shutdown with event flushing
   */
  async shutdown(): Promise<void> {
    await this.postHogClient.shutdown();
  }

  /**
   * Check if analytics is enabled
   */
  isEnabled(): boolean {
    return this.enabled && this.postHogClient.isEnabled();
  }

  /**
   * Track tool usage with error handling and automatic timing
   */
  async trackTool<T>(
    toolName: string,
    operation: () => Promise<T>,
    getProperties?: (result: T) => Record<string, unknown>,
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await operation();

      this.track(TelemetryEvent.TOOL_USED, {
        tool: toolName,
        success: true,
        durationMs: Date.now() - startTime,
        ...(getProperties ? getProperties(result) : {}),
      });

      return result;
    } catch (error) {
      // Track the tool usage failure
      this.track(TelemetryEvent.TOOL_USED, {
        tool: toolName,
        success: false,
        durationMs: Date.now() - startTime,
      });

      // Capture the exception with full error tracking
      if (error instanceof Error) {
        this.captureException(error, {
          tool: toolName,
          context: "tool_execution",
          durationMs: Date.now() - startTime,
        });
      }

      throw error;
    }
  }
}

/**
 * Global analytics instance
 */
export const analytics = new Analytics();
