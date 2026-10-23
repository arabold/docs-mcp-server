/**
 * Telemtry wrapper for privacy-first telemetry using PostHog.
 * Provides global context and automatic data sanitization.
 *
 * Architecture:
 * - PostHogClient: Handles PostHog SDK integration and event capture
 * - Telemtry: High-level coordinator providing public API with global context
 */

import { logger } from "../utils/logger";
import type { TelemetryEventPropertiesMap } from "./eventTypes";
import { PostHogClient } from "./postHogClient";
import { sanitizeErrorForTracking } from "./sanitizer";
import { generateInstallationId, TelemetryConfig } from "./TelemetryConfig";

/**
 * Event types for structured telemetry tracking
 */
export enum TelemetryEvent {
  APP_STARTED = "app_started",
  APP_SHUTDOWN = "app_shutdown",
  CLI_COMMAND = "cli_command",
  TOOL_USED = "tool_used",
  PIPELINE_JOB_STARTED = "pipeline_job_started",
  PIPELINE_JOB_COMPLETED = "pipeline_job_completed",
  PIPELINE_JOB_FAILED = "pipeline_job_failed",
}

/**
 * Main telemetry class providing privacy-first telemetry
 */
export class Telemetry {
  private postHogClient: PostHogClient;
  private enabled: boolean;
  private distinctId: string;
  private globalContext: Record<string, unknown> = {};

  /**
   * Create a new Telemetry instance with proper initialization
   * This is the recommended way to create Telemetry instances
   *
   * @param storePath - Store directory that holds the installation ID; defaults to the standard data directory.
   * @returns The telemetry instance.
   */
  static create(storePath?: string): Telemetry {
    const config = TelemetryConfig.getInstance();

    // Single determination point for enabled status
    const shouldEnable = config.isEnabled() && !!__POSTHOG_API_KEY__;

    const telemetry = new Telemetry(shouldEnable, storePath);

    // Single log message after everything is initialized with better context
    if (telemetry.isEnabled()) {
      logger.debug("Telemetry enabled");
    } else if (!config.isEnabled()) {
      logger.debug("Telemetry disabled (user preference)");
    } else if (!__POSTHOG_API_KEY__) {
      logger.debug("Telemetry disabled (no API key configured)");
    } else {
      logger.debug("Telemetry disabled");
    }

    return telemetry;
  }

  /**
   * Private constructor - use Telemetry.create() instead
   */
  private constructor(enabled: boolean, storePath?: string) {
    this.enabled = enabled;
    this.distinctId = generateInstallationId(storePath);
    this.postHogClient = new PostHogClient(this.enabled);
  }

  /**
   * Set global application context that will be included in all events
   */
  setGlobalContext(context: Record<string, unknown>): void {
    this.globalContext = { ...context };
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
    logger.debug(`Tracking event: ${event}`);
    this.postHogClient.capture(this.distinctId, event, enrichedProperties);
  }

  /**
   * Capture exception using PostHog's native error tracking with global context.
   * The error is sent without URLs, file paths or credentials in its message and stack.
   */
  captureException(
    error: Error | unknown,
    properties: Record<string, unknown> = {},
  ): void {
    if (!this.enabled) return;

    // Merge global context and error properties with timestamp
    const enrichedProperties = {
      ...this.globalContext,
      ...properties,
      timestamp: new Date().toISOString(),
    };
    logger.debug(
      `Capturing exception: ${error instanceof Error ? error.message : String(error)}`,
    );
    this.postHogClient.captureException(
      this.distinctId,
      sanitizeErrorForTracking(error instanceof Error ? error : new Error(String(error))),
      enrichedProperties,
    );
  }

  /**
   * Graceful shutdown with event flushing
   */
  async shutdown(): Promise<void> {
    if (!this.enabled) return;

    await this.postHogClient.shutdown();
  }

  /**
   * Check if telemetry is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Global telemetry instance - initialized lazily
 */
let telemetryInstance: Telemetry | null = null;

/**
 * Get the global telemetry instance, initializing it if needed
 */
export function getTelemetryInstance(): Telemetry {
  if (!telemetryInstance) {
    // Create a basic telemetry instance if not yet initialized
    telemetryInstance = Telemetry.create();
  }
  return telemetryInstance;
}

/**
 * Initialize telemetry system with proper configuration.
 * This should be called once at application startup.
 */
export function initTelemetry(options: { enabled: boolean; storePath?: string }): void {
  // Configure telemetry enabled state
  TelemetryConfig.getInstance().setEnabled(options.enabled);

  // Create the telemetry instance, reading the installation ID from the store path
  telemetryInstance = Telemetry.create(options.storePath);
}

// Export a proxy object that always delegates to the current telemetry instance.
// This ensures configuration changes (like disabling telemetry via initTelemetry)
// are always reflected, avoiding stale cached state.
export const telemetry = new Proxy({} as Telemetry, {
  get(_target, prop) {
    const instance = getTelemetryInstance();
    const value = instance[prop as keyof Telemetry];

    // Bind methods to the instance to preserve 'this' context
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
});
