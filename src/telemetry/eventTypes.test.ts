/**
 * Test for type-safe telemetry event tracking
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Analytics, TelemetryEvent } from "./analytics";

describe("Type-safe event tracking", () => {
  let analytics: Analytics;

  beforeEach(() => {
    analytics = new Analytics(false); // Disabled for testing
  });

  it("should enforce correct properties for APP_STARTED event", () => {
    // This should compile without errors - all required properties provided
    analytics.track(TelemetryEvent.APP_STARTED, {
      services: ["mcp", "worker"],
      port: 8080,
      externalWorker: false,
      cliCommand: "serve",
      mcpProtocol: "stdio",
      mcpTransport: "stdio",
    });

    // This would cause a TypeScript error if we uncommented it:
    // analytics.track(TelemetryEvent.APP_STARTED, {
    //   port: 8080,
    //   // missing required 'services' property
    // });
  });

  it("should enforce correct properties for APP_SHUTDOWN event", () => {
    // This should compile without errors
    analytics.track(TelemetryEvent.APP_SHUTDOWN, {
      graceful: true,
    });
  });

  it("should enforce correct properties for CLI_COMMAND event", () => {
    // This should compile without errors
    analytics.track(TelemetryEvent.CLI_COMMAND, {
      cliCommand: "serve",
      success: true,
      durationMs: 5000,
    });
  });

  it("should enforce correct properties for TOOL_USED event", () => {
    // This should compile without errors
    analytics.track(TelemetryEvent.TOOL_USED, {
      tool: "search_docs",
      success: true,
      durationMs: 150,
      resultsCount: 5, // Additional tool-specific property
    });
  });

  it("should enforce correct properties for HTTP_REQUEST_COMPLETED event", () => {
    // This should compile without errors - success case
    analytics.track(TelemetryEvent.HTTP_REQUEST_COMPLETED, {
      success: true,
      hostname: "docs.example.com",
      protocol: "https",
      durationMs: 250,
      contentSizeBytes: 1024,
      mimeType: "text/html",
      hasEncoding: true,
      followRedirects: true,
      hadRedirects: false,
    });

    // Failure case
    analytics.track(TelemetryEvent.HTTP_REQUEST_COMPLETED, {
      success: false,
      hostname: "docs.example.com",
      protocol: "https",
      durationMs: 5000,
      statusCode: 404,
      errorType: "NotFound",
      errorCode: "ENOTFOUND",
    });
  });

  it("should enforce correct properties for PIPELINE_JOB_PROGRESS event", () => {
    // This should compile without errors
    analytics.track(TelemetryEvent.PIPELINE_JOB_PROGRESS, {
      jobId: "job_123",
      library: "react",
      pagesScraped: 25,
      totalPages: 100,
      totalDiscovered: 150,
      progressPercent: 25.0,
      currentDepth: 2,
      maxDepth: 5,
      discoveryRatio: 1.5,
      queueEfficiency: 0.8,
    });
  });

  it("should enforce correct properties for PIPELINE_JOB_COMPLETED event", () => {
    // This should compile without errors
    analytics.track(TelemetryEvent.PIPELINE_JOB_COMPLETED, {
      jobId: "job_123",
      library: "react",
      status: "completed",
      durationMs: 5000,
      queueWaitTimeMs: 200,
      pagesProcessed: 50,
      maxPagesConfigured: 100,
      hasVersion: true,
      hasError: false,
      throughputPagesPerSecond: 10.0,
    });
  });

  it("should enforce correct properties for DOCUMENT_PROCESSED event", () => {
    // This should compile without errors
    analytics.track(TelemetryEvent.DOCUMENT_PROCESSED, {
      mimeType: "text/html",
      contentSizeBytes: 2048,
      processingTimeMs: 150,
      chunksCreated: 3,
      hasTitle: true,
      hasDescription: true,
      urlDomain: "docs.example.com",
      depth: 2,
      library: "react",
      libraryVersion: "18.0.0",
      avgChunkSizeBytes: 682,
      processingSpeedKbPerSec: 13.65,
    });
  });

  it("should still allow generic tracking for unknown events", () => {
    // This should still work for custom/unknown events
    analytics.track("custom_event", {
      customProperty: "value",
      anyProperty: 123,
    });
  });

  it("should work with the trackTool instance method", async () => {
    const mockOperation = vi.fn().mockResolvedValue("success");
    const mockGetProperties = vi.fn().mockReturnValue({ resultsCount: 3 });

    const result = await analytics.trackTool(
      "test_tool",
      mockOperation,
      mockGetProperties,
    );

    expect(result).toBe("success");
    expect(mockOperation).toHaveBeenCalled();
    expect(mockGetProperties).toHaveBeenCalledWith("success");
  });
});
