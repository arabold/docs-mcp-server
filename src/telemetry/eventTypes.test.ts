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
      version: "1.0.0",
      platform: "darwin",
      authEnabled: false,
      readOnly: true,
      servicesCount: 2,
      port: 8080,
    });

    // This would cause a TypeScript error if we uncommented it:
    // analytics.track(TelemetryEvent.APP_STARTED, {
    //   version: "1.0.0",
    //   // missing required properties like platform, etc.
    // });
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

  it("should enforce correct properties for PIPELINE_JOB_COMPLETED event", () => {
    // This should compile without errors
    analytics.track(TelemetryEvent.PIPELINE_JOB_COMPLETED, {
      jobId: "job_123",
      library: "react",
      status: "completed",
      duration_ms: 5000,
      queue_wait_time_ms: 200,
      pages_processed: 50,
      max_pages_configured: 100,
      has_version: true,
      has_error: false,
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
