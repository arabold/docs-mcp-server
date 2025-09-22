/**
 * Type definitions for telemetry events with required properties.
 * Each event type has a corresponding interface defining its required properties.
 */

import type { TelemetryEvent } from "./analytics";

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

export interface PipelineJobCompletedProperties extends BaseTelemetryProperties {
  jobId: string;
  library: string;
  status: string;
  durationMs: number | null;
  queueWaitTimeMs: number | null;
  pagesProcessed: number;
  maxPagesConfigured: number;
  hasVersion: boolean;
  hasError: boolean;
  throughputPagesPerSecond: number;
}

// Document Events
export interface DocumentProcessedProperties extends BaseTelemetryProperties {
  // Content characteristics
  mimeType: string;
  contentSizeBytes: number;
  processingTimeMs: number;
  chunksCreated: number;
  hasTitle: boolean;
  hasDescription: boolean;
  // Privacy-safe location info
  urlDomain: string;
  depth: number;
  // Library context
  library: string;
  libraryVersion: string | null;
  // Processing efficiency
  avgChunkSizeBytes: number;
  processingSpeedKbPerSec: number;
}

// Web UI Events
export interface WebSearchPerformedProperties extends BaseTelemetryProperties {
  library: string;
  version?: string;
  queryLength: number;
  resultCount: number;
  limit: number;
  exactMatch?: boolean;
}

export interface WebScrapeStartedProperties extends BaseTelemetryProperties {
  library: string;
  version?: string;
  url: string;
  scope: string;
  maxDepth: number;
  maxPages: number;
  maxConcurrency?: number;
  ignoreErrors?: boolean;
  scrapeMode?: string;
  hasCustomHeaders?: boolean;
}

// Type mapping for event to properties
export interface TelemetryEventPropertiesMap {
  [TelemetryEvent.APP_STARTED]: AppStartedProperties;
  [TelemetryEvent.APP_SHUTDOWN]: AppShutdownProperties;
  [TelemetryEvent.CLI_COMMAND]: CliCommandProperties;
  [TelemetryEvent.TOOL_USED]: ToolUsedProperties;
  [TelemetryEvent.PIPELINE_JOB_COMPLETED]: PipelineJobCompletedProperties;
  [TelemetryEvent.DOCUMENT_PROCESSED]: DocumentProcessedProperties;
  [TelemetryEvent.WEB_SEARCH_PERFORMED]: WebSearchPerformedProperties;
  [TelemetryEvent.WEB_SCRAPE_STARTED]: WebScrapeStartedProperties;
}
