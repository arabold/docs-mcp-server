/**
 * Type definitions for telemetry events with required properties.
 * Each event type has a corresponding interface defining its required properties.
 */

import type { TelemetryEvent } from "./telemetry";

// Base interface for all telemetry events
interface BaseTelemetryProperties {
  // Common optional properties that can be added to any event
  [key: string]: unknown;
}

// Application Events
export interface AppStartedProperties extends BaseTelemetryProperties {
  services: string[];
  port?: number;
  externalWorker?: boolean;
  // Context when available
  cliCommand?: string;
  mcpProtocol?: string;
  mcpTransport?: string;
}

export interface AppShutdownProperties extends BaseTelemetryProperties {
  graceful: boolean;
}

// CLI Events
export interface CliCommandProperties extends BaseTelemetryProperties {
  cliCommand: string;
  success: boolean;
  durationMs: number;
}

// Tool Events
export interface ToolUsedProperties extends BaseTelemetryProperties {
  tool: string;
  success: boolean;
  durationMs: number;
  [key: string]: unknown; // Allow additional tool-specific properties
}

// Pipeline Events

export interface PipelineJobStartedProperties extends BaseTelemetryProperties {
  jobId: string;
  library: string;
  hasVersion: boolean;
  maxPagesConfigured: number;
  queueWaitTimeMs: number | null;
}

export interface PipelineJobCompletedProperties extends BaseTelemetryProperties {
  jobId: string;
  library: string;
  durationMs: number | null;
  pagesProcessed: number;
  maxPagesConfigured: number;
  hasVersion: boolean;
  throughputPagesPerSecond: number;
}

export interface PipelineJobFailedProperties extends BaseTelemetryProperties {
  jobId: string;
  library: string;
  durationMs: number | null;
  pagesProcessed: number;
  maxPagesConfigured: number;
  hasVersion: boolean;
  hasError: boolean;
  errorMessage?: string;
}

// Type mapping for event to properties
export interface TelemetryEventPropertiesMap {
  [TelemetryEvent.APP_STARTED]: AppStartedProperties;
  [TelemetryEvent.APP_SHUTDOWN]: AppShutdownProperties;
  [TelemetryEvent.CLI_COMMAND]: CliCommandProperties;
  [TelemetryEvent.TOOL_USED]: ToolUsedProperties;
  [TelemetryEvent.PIPELINE_JOB_STARTED]: PipelineJobStartedProperties;
  [TelemetryEvent.PIPELINE_JOB_COMPLETED]: PipelineJobCompletedProperties;
  [TelemetryEvent.PIPELINE_JOB_FAILED]: PipelineJobFailedProperties;
}
