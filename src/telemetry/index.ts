/**
 * Telemetry utilities for privacy-first analytics.
 *
 * This module provides comprehensive telemetry functionality including:
 * - Telemetry tracking with PostHog integration and installation ID
 * - Global context management for application-level properties
 * - Data sanitization for privacy protection
 * - Configuration management with opt-out controls
 */

export type * from "./eventTypes";
export * from "./sanitizer";
// Configuration and privacy
export {
  generateInstallationId,
  shouldEnableTelemetry,
  TelemetryConfig,
} from "./TelemetryConfig";
export { TelemetryService } from "./TelemetryService";
// Core telemetry and tracking
export { initTelemetry, TelemetryEvent, telemetry } from "./telemetry";
