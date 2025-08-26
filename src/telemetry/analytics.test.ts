import { beforeEach, describe, expect, it, vi } from "vitest";
import { Analytics, TelemetryEvent } from "./analytics";

// Mock the config module
vi.mock("./TelemetryConfig", () => ({
  TelemetryConfig: {
    getInstance: vi.fn(() => ({
      isEnabled: vi.fn(() => true),
    })),
  },
  generateInstallationId: vi.fn(() => "test-installation-id"),
}));

// Mock the logger
vi.mock("../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
  },
}));

// Mock PostHogClient
vi.mock("./postHogClient", () => ({
  PostHogClient: vi.fn().mockImplementation(() => ({
    capture: vi.fn(),
    captureException: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    isEnabled: vi.fn(() => true),
  })),
}));

describe("Analytics", () => {
  let analytics: Analytics;
  let mockPostHogClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    analytics = new Analytics();

    // Get the mocked instance that was created by the constructor
    mockPostHogClient = (analytics as any).postHogClient;
  });

  describe("constructor", () => {
    it("should initialize with PostHogClient", () => {
      expect(analytics).toBeDefined();
      expect(analytics.isEnabled()).toBe(true);
    });

    it("should respect explicit enabled parameter", () => {
      const disabledAnalytics = new Analytics(false);
      expect(disabledAnalytics.isEnabled()).toBe(false);
    });
  });

  describe("global context", () => {
    it("should set and get global context", () => {
      const context = { appVersion: "1.0.0", appPlatform: "test" };

      analytics.setGlobalContext(context);

      expect(analytics.getGlobalContext()).toEqual(context);
    });

    it("should return copy of global context", () => {
      const context = { appVersion: "1.0.0" };
      analytics.setGlobalContext(context);

      const retrieved = analytics.getGlobalContext();
      retrieved.appPlatform = "modified";

      expect(analytics.getGlobalContext()).toEqual({ appVersion: "1.0.0" });
    });
  });

  describe("event tracking", () => {
    it("should track events via PostHogClient with global context", () => {
      analytics.setGlobalContext({ appVersion: "1.0.0" });

      analytics.track(TelemetryEvent.TOOL_USED, { tool: "test" });

      expect(mockPostHogClient.capture).toHaveBeenCalledWith(
        "test-installation-id",
        TelemetryEvent.TOOL_USED,
        {
          appVersion: "1.0.0",
          tool: "test",
          timestamp: expect.any(String),
        },
      );
    });

    it("should include timestamp in all events", () => {
      analytics.track(TelemetryEvent.APP_STARTED, {});

      expect(mockPostHogClient.capture).toHaveBeenCalledWith(
        "test-installation-id",
        TelemetryEvent.APP_STARTED,
        expect.objectContaining({
          timestamp: expect.any(String),
        }),
      );
    });

    it("should not track when disabled", () => {
      const disabledAnalytics = new Analytics(false);

      disabledAnalytics.track(TelemetryEvent.TOOL_USED, { tool: "test" });

      expect(mockPostHogClient.capture).not.toHaveBeenCalled();
    });
  });

  describe("exception tracking", () => {
    it("should capture exceptions via PostHogClient with global context", () => {
      const error = new Error("Test error");
      analytics.setGlobalContext({ appVersion: "1.0.0" });

      analytics.captureException(error, { context: "test" });

      expect(mockPostHogClient.captureException).toHaveBeenCalledWith(
        "test-installation-id",
        error,
        {
          appVersion: "1.0.0",
          context: "test",
          timestamp: expect.any(String),
        },
      );
    });

    it("should not capture exceptions when disabled", () => {
      const disabledAnalytics = new Analytics(false);
      const error = new Error("Test error");

      disabledAnalytics.captureException(error);

      expect(mockPostHogClient.captureException).not.toHaveBeenCalled();
    });
  });

  describe("trackTool", () => {
    it("should track successful tool execution", async () => {
      const mockOperation = vi.fn().mockResolvedValue("success");

      const result = await analytics.trackTool("test_tool", mockOperation);

      expect(result).toBe("success");
      expect(mockPostHogClient.capture).toHaveBeenCalledWith(
        "test-installation-id",
        TelemetryEvent.TOOL_USED,
        expect.objectContaining({
          tool: "test_tool",
          success: true,
          durationMs: expect.any(Number),
          timestamp: expect.any(String),
        }),
      );
    });

    it("should track failed tool execution", async () => {
      const mockOperation = vi.fn().mockRejectedValue(new Error("Tool failed"));

      await expect(analytics.trackTool("test_tool", mockOperation)).rejects.toThrow(
        "Tool failed",
      );

      expect(mockPostHogClient.capture).toHaveBeenCalledWith(
        "test-installation-id",
        TelemetryEvent.TOOL_USED,
        expect.objectContaining({
          tool: "test_tool",
          success: false,
          durationMs: expect.any(Number),
          timestamp: expect.any(String),
        }),
      );

      expect(mockPostHogClient.captureException).toHaveBeenCalledWith(
        "test-installation-id",
        expect.any(Error),
        expect.objectContaining({
          tool: "test_tool",
          context: "tool_execution",
          durationMs: expect.any(Number),
          timestamp: expect.any(String),
        }),
      );
    });

    it("should include custom properties from getProperties function", async () => {
      const mockOperation = vi.fn().mockResolvedValue({ count: 5 });
      const getProperties = (result: any) => ({ itemCount: result.count });

      await analytics.trackTool("test_tool", mockOperation, getProperties);

      expect(mockPostHogClient.capture).toHaveBeenCalledWith(
        "test-installation-id",
        TelemetryEvent.TOOL_USED,
        expect.objectContaining({
          tool: "test_tool",
          success: true,
          itemCount: 5,
          durationMs: expect.any(Number),
          timestamp: expect.any(String),
        }),
      );
    });
  });

  describe("shutdown", () => {
    it("should shutdown PostHogClient", async () => {
      await analytics.shutdown();

      expect(mockPostHogClient.shutdown).toHaveBeenCalled();
    });
  });

  describe("isEnabled", () => {
    it("should return enabled state", () => {
      expect(analytics.isEnabled()).toBe(true);
    });

    it("should return false when analytics is disabled", () => {
      const disabledAnalytics = new Analytics(false);
      expect(disabledAnalytics.isEnabled()).toBe(false);
    });
  });
});
