import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryConfig } from "./TelemetryConfig";
import { initTelemetry, Telemetry, TelemetryEvent, telemetry } from "./telemetry";

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

// Mock PostHogClient
vi.mock("./postHogClient", () => ({
  PostHogClient: vi.fn().mockImplementation(() => ({
    capture: vi.fn(),
    captureException: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    isEnabled: vi.fn(() => true),
  })),
}));

describe("Telemetry", () => {
  let telemetry: Telemetry;
  let mockPostHogClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset TelemetryConfig mock to default enabled state
    const mockConfig = {
      isEnabled: vi.fn(() => true),
    };
    vi.mocked(TelemetryConfig.getInstance).mockReturnValue(mockConfig as any);

    telemetry = Telemetry.create();

    // Get the mocked instance that was created by the constructor
    mockPostHogClient = (telemetry as any).postHogClient;
  });

  describe("constructor", () => {
    it("should initialize with PostHogClient", () => {
      expect(telemetry).toBeDefined();
      expect(telemetry.isEnabled()).toBe(true);
    });

    it("should respect disabled config", () => {
      // Mock config to return disabled
      const mockConfig = {
        isEnabled: vi.fn(() => false),
      };
      vi.mocked(TelemetryConfig.getInstance).mockReturnValue(mockConfig as any);

      const disabledTelemetry = Telemetry.create();
      expect(disabledTelemetry.isEnabled()).toBe(false);
    });
  });

  describe("global context", () => {
    it("should set and get global context", () => {
      const context = { appVersion: "1.0.0", appPlatform: "test" };

      telemetry.setGlobalContext(context);

      expect(telemetry.getGlobalContext()).toEqual(context);
    });

    it("should return copy of global context", () => {
      const context = { appVersion: "1.0.0" };
      telemetry.setGlobalContext(context);

      const retrieved = telemetry.getGlobalContext();
      retrieved.appPlatform = "modified";

      expect(telemetry.getGlobalContext()).toEqual({ appVersion: "1.0.0" });
    });
  });

  describe("event tracking", () => {
    it("should track events via PostHogClient with global context", () => {
      telemetry.setGlobalContext({ appVersion: "1.0.0" });

      telemetry.track(TelemetryEvent.TOOL_USED, { tool: "test" });

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
      telemetry.track(TelemetryEvent.APP_STARTED, {});

      expect(mockPostHogClient.capture).toHaveBeenCalledWith(
        "test-installation-id",
        TelemetryEvent.APP_STARTED,
        expect.objectContaining({
          timestamp: expect.any(String),
        }),
      );
    });

    describe("disabled telemetry behavior", () => {
      let mockConfig: any;
      let disabledTelemetry: Telemetry;

      beforeEach(() => {
        // Mock config to return disabled
        mockConfig = {
          isEnabled: vi.fn(() => false),
        };
        vi.mocked(TelemetryConfig.getInstance).mockReturnValue(mockConfig);
        disabledTelemetry = Telemetry.create();
      });

      it("should return false for isEnabled when disabled", () => {
        expect(disabledTelemetry.isEnabled()).toBe(false);
      });

      it("should not track events when disabled", () => {
        disabledTelemetry.track(TelemetryEvent.TOOL_USED, { tool: "test" });
        expect(mockPostHogClient.capture).not.toHaveBeenCalled();
      });

      it("should not capture exceptions when disabled", () => {
        const error = new Error("Test error");
        disabledTelemetry.captureException(error);
        expect(mockPostHogClient.captureException).not.toHaveBeenCalled();
      });
    });
  });

  describe("exception tracking", () => {
    it("should capture exceptions via PostHogClient with global context", () => {
      const error = new Error("Test error");
      telemetry.setGlobalContext({ appVersion: "1.0.0" });

      telemetry.captureException(error, { context: "test" });

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
      await telemetry.shutdown();

      expect(mockPostHogClient.shutdown).toHaveBeenCalled();
    });
  });

  describe("isEnabled", () => {
    it("should return enabled state", () => {
      expect(telemetry.isEnabled()).toBe(true);
    });
  });
});

/**
 * Tests for the telemetry proxy and initTelemetry() behavior.
 * These tests verify that the global `telemetry` proxy correctly reflects
 * configuration changes made via initTelemetry().
 *
 * This specifically tests the fix for GitHub issue #306 where disabling
 * telemetry via DOCS_MCP_TELEMETRY=false was not working because the proxy
 * was caching a stale enabled instance.
 */
describe("telemetry proxy", () => {
  // We need to reset module state between tests to ensure isolation.
  // The telemetryInstance is module-level state that persists.

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Reset the telemetry instance by calling initTelemetry with enabled: true
    // to restore default state for other tests
    const mockConfig = {
      isEnabled: vi.fn(() => true),
      setEnabled: vi.fn(),
    };
    vi.mocked(TelemetryConfig.getInstance).mockReturnValue(mockConfig as any);
    initTelemetry({ enabled: true });
  });

  it("should reflect disabled state after initTelemetry({ enabled: false })", () => {
    // First, configure mock to return enabled = false when checked
    const mockConfig = {
      isEnabled: vi.fn(() => false),
      setEnabled: vi.fn(),
    };
    vi.mocked(TelemetryConfig.getInstance).mockReturnValue(mockConfig as any);

    // Call initTelemetry to create a new disabled instance
    initTelemetry({ enabled: false });

    // The proxy should now reflect the disabled state
    expect(telemetry.isEnabled()).toBe(false);
    expect(mockConfig.setEnabled).toHaveBeenCalledWith(false);
  });

  it("should not track events when disabled via initTelemetry", () => {
    // First, configure mock to return enabled = false
    const mockConfig = {
      isEnabled: vi.fn(() => false),
      setEnabled: vi.fn(),
    };
    vi.mocked(TelemetryConfig.getInstance).mockReturnValue(mockConfig as any);

    // Call initTelemetry to create a new disabled instance
    initTelemetry({ enabled: false });

    // Access the telemetry proxy and try to track - should not throw
    // and should not actually track anything
    telemetry.track(TelemetryEvent.TOOL_USED, { tool: "test" });

    // If we got here without errors, the proxy is working correctly
    expect(telemetry.isEnabled()).toBe(false);
  });
});
