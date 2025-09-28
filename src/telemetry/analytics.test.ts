import { beforeEach, describe, expect, it, vi } from "vitest";
import { Analytics, TelemetryEvent } from "./analytics";
import { TelemetryConfig } from "./TelemetryConfig";

// Set the global __POSTHOG_API_KEY__ for testing
(global as any).__POSTHOG_API_KEY__ = "test-api-key";

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

    // Reset TelemetryConfig mock to default enabled state
    const mockConfig = {
      isEnabled: vi.fn(() => true),
    };
    vi.mocked(TelemetryConfig.getInstance).mockReturnValue(mockConfig as any);

    analytics = Analytics.create();

    // Get the mocked instance that was created by the constructor
    mockPostHogClient = (analytics as any).postHogClient;
  });

  describe("constructor", () => {
    it("should initialize with PostHogClient", () => {
      expect(analytics).toBeDefined();
      expect(analytics.isEnabled()).toBe(true);
    });

    it("should respect disabled config", () => {
      // Mock config to return disabled
      const mockConfig = {
        isEnabled: vi.fn(() => false),
      };
      vi.mocked(TelemetryConfig.getInstance).mockReturnValue(mockConfig as any);

      const disabledAnalytics = Analytics.create();
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

    describe("disabled analytics behavior", () => {
      let mockConfig: any;
      let disabledAnalytics: Analytics;

      beforeEach(() => {
        // Mock config to return disabled
        mockConfig = {
          isEnabled: vi.fn(() => false),
        };
        vi.mocked(TelemetryConfig.getInstance).mockReturnValue(mockConfig);
        disabledAnalytics = Analytics.create();
      });

      it("should return false for isEnabled when disabled", () => {
        expect(disabledAnalytics.isEnabled()).toBe(false);
      });

      it("should not track events when disabled", () => {
        disabledAnalytics.track(TelemetryEvent.TOOL_USED, { tool: "test" });
        expect(mockPostHogClient.capture).not.toHaveBeenCalled();
      });

      it("should not capture exceptions when disabled", () => {
        const error = new Error("Test error");
        disabledAnalytics.captureException(error);
        expect(mockPostHogClient.captureException).not.toHaveBeenCalled();
      });
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
  });
});
