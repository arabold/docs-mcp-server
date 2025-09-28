/**
 * Tests for PostHogClient camelCase to snake_case conversion functionality
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostHogClient } from "./postHogClient";

// Mock PostHog SDK
const mockPostHogInstance = {
  capture: vi.fn(),
  captureException: vi.fn(),
  shutdown: vi.fn(),
};

vi.mock("posthog-node", () => ({
  PostHog: vi.fn(() => mockPostHogInstance),
}));

// Set the global __POSTHOG_API_KEY__ for testing
(global as any).__POSTHOG_API_KEY__ = "test-api-key";

describe("PostHogClient property conversion", () => {
  let client: PostHogClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new PostHogClient(true);
  });

  it("should convert camelCase properties to snake_case", () => {
    const properties = {
      appInterface: "mcp",
      appVersion: "1.0.0",
      appPlatform: "darwin",
      appAuthEnabled: true,
      appReadOnly: false,
      appServicesEnabled: ["mcp", "web"],
      mcpProtocol: "stdio",
      mcpTransport: "sse",
      webRoute: "/dashboard",
      cliCommand: "scrape",
      aiEmbeddingProvider: "openai",
      aiEmbeddingModel: "text-embedding-3-small",
      aiEmbeddingDimensions: 1536,
    };

    client.capture("test-user", "test_event", properties);

    expect(mockPostHogInstance.capture).toHaveBeenCalledWith({
      distinctId: "test-user",
      event: "test_event",
      properties: {
        // PostHog standard properties
        $app_version: "1.0.0",
        // Converted custom properties (note: appVersion is removed as duplicate)
        ai_embedding_dimensions: 1536,
        ai_embedding_model: "text-embedding-3-small",
        ai_embedding_provider: "openai",
        app_auth_enabled: true,
        app_interface: "mcp",
        app_platform: "darwin",
        app_read_only: false,
        app_services_enabled: ["mcp", "web"],
        cli_command: "scrape",
        mcp_protocol: "stdio",
        mcp_transport: "sse",
        web_route: "/dashboard",
      },
    });
  });

  it("should handle nested objects", () => {
    const properties = {
      sessionContext: {
        appInterface: "web",
        appVersion: "1.0.0",
        nestedConfig: {
          authEnabled: true,
          servicesList: ["web", "api"],
        },
      },
      userPreferences: {
        darkMode: true,
        emailNotifications: false,
      },
    };

    client.capture("test-user", "test_event", properties);

    expect(mockPostHogInstance.capture).toHaveBeenCalledWith({
      distinctId: "test-user",
      event: "test_event",
      properties: {
        session_context: {
          app_interface: "web",
          app_version: "1.0.0",
          nested_config: {
            auth_enabled: true,
            services_list: ["web", "api"],
          },
        },
        user_preferences: {
          dark_mode: true,
          email_notifications: false,
        },
      },
    });
  });

  it("should handle arrays with objects", () => {
    const properties = {
      serviceConfigs: [
        { serviceName: "mcp", isEnabled: true },
        { serviceName: "web", isEnabled: false },
      ],
      simpleArray: ["value1", "value2"],
      mixedArray: [
        { camelCaseKey: "test" },
        "string-value",
        123,
        { anotherKey: { nestedProp: true } },
      ],
    };

    client.capture("test-user", "test_event", properties);

    expect(mockPostHogInstance.capture).toHaveBeenCalledWith({
      distinctId: "test-user",
      event: "test_event",
      properties: {
        service_configs: [
          { service_name: "mcp", is_enabled: true },
          { service_name: "web", is_enabled: false },
        ],
        simple_array: ["value1", "value2"],
        mixed_array: [
          { camel_case_key: "test" },
          "string-value",
          123,
          { another_key: { nested_prop: true } },
        ],
      },
    });
  });

  it("should preserve special values", () => {
    const properties = {
      dateValue: new Date("2025-08-24T10:00:00Z"),
      nullValue: null,
      undefinedValue: undefined,
      booleanValue: true,
      numberValue: 42,
      stringValue: "test-string",
      camelCaseString: "preserveThisValue",
    };

    client.capture("test-user", "test_event", properties);

    expect(mockPostHogInstance.capture).toHaveBeenCalledWith({
      distinctId: "test-user",
      event: "test_event",
      properties: {
        date_value: new Date("2025-08-24T10:00:00Z"),
        null_value: null,
        undefined_value: undefined,
        boolean_value: true,
        number_value: 42,
        string_value: "test-string",
        camel_case_string: "preserveThisValue",
      },
    });
  });

  it("should add PostHog standard properties and remove duplicates", () => {
    const properties = {
      sessionId: "test-session-123",
      startTime: new Date("2024-01-01T12:00:00Z"),
      appVersion: "1.0.0",
      appInterface: "cli",
      customProperty: "value",
    };

    client.capture("test-user", "test_event", properties);

    const capturedCall = mockPostHogInstance.capture.mock.calls[0][0];
    const props = capturedCall.properties;

    // Should have PostHog standard properties
    expect(props.$session_id).toBe("test-session-123");
    expect(props.$start_timestamp).toBe("2024-01-01T12:00:00.000Z");
    expect(props.$app_version).toBe("1.0.0");

    // Should NOT have duplicate properties
    expect(props.sessionId).toBeUndefined();
    expect(props.session_id).toBeUndefined();
    expect(props.startTime).toBeUndefined();
    expect(props.start_time).toBeUndefined();
    expect(props.appVersion).toBeUndefined();
    expect(props.app_version).toBeUndefined();

    // Should have converted custom properties
    expect(props.app_interface).toBe("cli");
    expect(props.custom_property).toBe("value");
  });

  it("should convert properties in captureException with PostHog standards", () => {
    const error = new Error("Test error");
    const properties = {
      sessionId: "error-session",
      appVersion: "1.0.0",
      errorContext: "test_context",
      userAction: "button_click",
    };

    client.captureException("test-user", error, properties);

    const capturedCall = mockPostHogInstance.captureException.mock.calls[0][0];
    const props = capturedCall.properties;

    // Should have PostHog standard properties
    expect(props.$session_id).toBe("error-session");
    expect(props.$app_version).toBe("1.0.0");

    // Should have converted custom properties
    expect(props.error_context).toBe("test_context");
    expect(props.user_action).toBe("button_click");

    // Should NOT have duplicates
    expect(props.sessionId).toBeUndefined();
    expect(props.appVersion).toBeUndefined();
  });

  it("should handle captureException without properties", () => {
    const error = new Error("Test error");

    client.captureException("test-user", error);

    expect(mockPostHogInstance.captureException).toHaveBeenCalledWith({
      error,
      distinctId: "test-user",
      properties: {},
    });
  });

  it("should not convert properties when client is disabled", () => {
    const disabledClient = new PostHogClient(false);
    const properties = { appInterface: "mcp" };

    disabledClient.capture("test-user", "test_event", properties);

    expect(mockPostHogInstance.capture).not.toHaveBeenCalled();
  });
});
