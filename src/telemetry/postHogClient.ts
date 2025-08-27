/**
 * PostHog client wrapper for telemetry events.
 * Handles PostHog SDK integration and event capture with privacy-first configuration.
 * Automatically converts camelCase property names to snake_case for PostHog compatibility.
 */

import { PostHog } from "posthog-node";
import { logger } from "../utils/logger";

/**
 * Convert camelCase string to snake_case
 * Specifically designed for PostHog property name conversion
 */
function camelToSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Recursively convert object keys from camelCase to snake_case
 * Handles nested objects and arrays while preserving values
 */
function convertPropertiesToSnakeCase(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = camelToSnakeCase(key);

    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      // Recursively convert nested objects
      result[snakeKey] = convertPropertiesToSnakeCase(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      // Handle arrays - convert elements if they are objects
      result[snakeKey] = value.map((item) =>
        item && typeof item === "object" && !(item instanceof Date)
          ? convertPropertiesToSnakeCase(item as Record<string, unknown>)
          : item,
      );
    } else {
      // Primitive values, dates, and null/undefined - keep as-is
      result[snakeKey] = value;
    }
  }

  return result;
}

/**
 * Add PostHog standard properties and remove duplicates
 * Maps our properties to PostHog's expected property names
 */
function addPostHogStandardProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...properties };

  // Add PostHog standard session properties
  if (properties.sessionId) {
    result.$session_id = properties.sessionId;
    delete result.sessionId; // Remove duplicate
  }

  if (properties.startTime) {
    result.$start_timestamp = (properties.startTime as Date).toISOString();
    delete result.startTime; // Remove duplicate
  }

  // Add PostHog standard app properties
  if (properties.appVersion) {
    result.$app_version = properties.appVersion;
    delete result.appVersion; // Remove duplicate
  }

  return result;
}

/**
 * PostHog client wrapper for telemetry events
 */
export class PostHogClient {
  private client?: PostHog;
  private enabled: boolean;

  // PostHog configuration
  private static readonly CONFIG = {
    host: "https://app.posthog.com",

    // Performance optimizations
    flushAt: 20, // Batch size - send after 20 events
    flushInterval: 10000, // 10 seconds - send after time

    // Privacy settings
    disableGeoip: true, // Don't collect IP geolocation
    disableSessionRecording: true, // Never record sessions
    disableSurveys: true, // No user surveys

    // Data handling
    persistence: "memory" as const, // No disk persistence for privacy
  };

  constructor(enabled: boolean) {
    this.enabled = enabled;

    // Check if API key was injected at build time
    if (!__POSTHOG_API_KEY__) {
      logger.debug("PostHog API key not provided - analytics disabled");
      this.enabled = false;
      return;
    }

    if (this.enabled) {
      try {
        this.client = new PostHog(__POSTHOG_API_KEY__, {
          host: PostHogClient.CONFIG.host,
          flushAt: PostHogClient.CONFIG.flushAt,
          flushInterval: PostHogClient.CONFIG.flushInterval,
          disableGeoip: PostHogClient.CONFIG.disableGeoip,
        });
        logger.debug("PostHog client initialized");
      } catch (error) {
        logger.debug(
          `PostHog initialization failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        this.enabled = false;
      }
    } else {
      this.enabled = false;
      logger.debug("PostHog client disabled");
    }
  }

  /**
   * Send event to PostHog
   */
  capture(distinctId: string, event: string, properties: Record<string, unknown>): void {
    if (!this.enabled || !this.client) return;

    try {
      // Add PostHog standard properties and remove duplicates
      const enhancedProperties = addPostHogStandardProperties(properties);

      // Convert camelCase properties to snake_case for PostHog
      const snakeCaseProperties = convertPropertiesToSnakeCase(enhancedProperties);

      this.client.capture({
        distinctId,
        event,
        properties: snakeCaseProperties,
      });
      logger.debug(`PostHog event captured: ${event}`);
    } catch (error) {
      logger.debug(
        `PostHog capture error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Capture exception using PostHog's native error tracking
   */
  captureException(
    distinctId: string,
    error: Error,
    properties?: Record<string, unknown>,
  ): void {
    if (!this.enabled || !this.client) return;

    try {
      // Add PostHog standard properties and remove duplicates
      const enhancedProperties = addPostHogStandardProperties(properties || {});

      // Convert camelCase properties to snake_case for PostHog
      const snakeCaseProperties = convertPropertiesToSnakeCase(enhancedProperties);

      this.client.captureException({
        error,
        distinctId,
        properties: snakeCaseProperties,
      });
      logger.debug(`PostHog exception captured: ${error.constructor.name}`);
    } catch (captureError) {
      logger.debug(
        `PostHog captureException error: ${captureError instanceof Error ? captureError.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Graceful shutdown with event flushing
   */
  async shutdown(): Promise<void> {
    if (this.client) {
      try {
        await this.client.shutdown();
        logger.debug("PostHog client shutdown complete");
      } catch (error) {
        logger.debug(
          `PostHog shutdown error: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  }

  /**
   * Check if client is enabled and ready
   */
  isEnabled(): boolean {
    return this.enabled && !!this.client;
  }
}
