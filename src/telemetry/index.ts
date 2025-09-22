/**
 * Telemetry utilities for privacy-first analytics.
 *
 * This module provides comprehensive telemetry functionality including:
 * - Analytics tracking with PostHog integration and installation ID
 * - Global context management for application-level properties
 * - Data sanitization for privacy protection
 * - Configuration management with opt-out controls
 */

// Core analytics and tracking
export { analytics, initTelemetry, TelemetryEvent } from "./analytics";
export type * from "./eventTypes";
export * from "./sanitizer";
// Configuration and privacy
export {
  generateInstallationId,
  shouldEnableTelemetry,
  TelemetryConfig,
} from "./TelemetryConfig";
