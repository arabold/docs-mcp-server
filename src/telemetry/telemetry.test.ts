/**
 * Tests for the Telemetry wrapper and the global `telemetry` proxy, with the
 * real configuration, installation ID and PostHog client. Only the PostHog SDK
 * is mocked, so the assertions read what would leave the process.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryConfig } from "./TelemetryConfig";
import { initTelemetry, Telemetry, TelemetryEvent, telemetry } from "./telemetry";

const posthog = vi.hoisted(() => ({
  capture: vi.fn(),
  captureException: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("posthog-node", () => ({
  PostHog: vi.fn(function () {
    return posthog;
  }),
}));

vi.stubGlobal("__POSTHOG_API_KEY__", "test-api-key");

let storePath: string;

/** The installation ID stored in the test's store path. */
function installationId(): string {
  return fs.readFileSync(path.join(storePath, "installation.id"), "utf8");
}

beforeEach(() => {
  vi.clearAllMocks();
  storePath = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-telemetry-"));
  TelemetryConfig.getInstance().setEnabled(true);
});

afterEach(() => {
  TelemetryConfig.getInstance().setEnabled(true);
  fs.rmSync(storePath, { recursive: true, force: true });
});

describe("Telemetry", () => {
  it("sends events with the global context and a timestamp", () => {
    const instance = Telemetry.create(storePath);
    instance.setGlobalContext({ appVersion: "1.0.0", appPlatform: "test" });

    instance.track(TelemetryEvent.TOOL_USED, { tool: "test" });

    expect(posthog.capture).toHaveBeenCalledWith({
      distinctId: installationId(),
      event: TelemetryEvent.TOOL_USED,
      properties: {
        $app_version: "1.0.0",
        app_platform: "test",
        tool: "test",
        timestamp: expect.any(String),
      },
    });
  });

  it("sends exceptions with the global context, without URLs or paths", () => {
    const instance = Telemetry.create(storePath);
    instance.setGlobalContext({ appVersion: "1.0.0" });

    instance.captureException(
      new Error(
        "Failed to fetch https://intranet.example.com/secret into /Users/john/docs",
      ),
      { context: "test" },
    );

    expect(posthog.captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Error",
        message: "Failed to fetch [url] into [path]",
      }),
      installationId(),
      { $app_version: "1.0.0", context: "test", timestamp: expect.any(String) },
    );
    const sent = posthog.captureException.mock.calls[0]?.[0] as Error;
    expect(sent.stack).not.toContain("intranet.example.com");
    expect(sent.stack).not.toContain("/Users/");
  });

  it("flushes the SDK's queued events on shutdown", async () => {
    const instance = Telemetry.create(storePath);
    instance.track(TelemetryEvent.TOOL_USED, { tool: "test" });

    await instance.shutdown();

    expect(posthog.shutdown).toHaveBeenCalledOnce();
  });

  it("sends nothing when the user turned telemetry off", () => {
    TelemetryConfig.getInstance().setEnabled(false);
    const instance = Telemetry.create(storePath);

    instance.track(TelemetryEvent.TOOL_USED, { tool: "test" });
    instance.captureException(new Error("Test error"));

    expect(instance.isEnabled()).toBe(false);
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.captureException).not.toHaveBeenCalled();
  });
});

/**
 * The global `telemetry` proxy must follow initTelemetry(). GitHub issue #306:
 * DOCS_MCP_TELEMETRY=false did not disable telemetry, because the proxy kept a
 * stale enabled instance.
 */
describe("telemetry proxy", () => {
  it("sends nothing after initTelemetry({ enabled: false }), even when it was enabled before", () => {
    initTelemetry({ enabled: true, storePath });
    expect(telemetry.isEnabled()).toBe(true);

    initTelemetry({ enabled: false, storePath });
    telemetry.track(TelemetryEvent.TOOL_USED, { tool: "test" });

    expect(telemetry.isEnabled()).toBe(false);
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("identifies events by the installation ID in the store path", () => {
    initTelemetry({ enabled: true, storePath });

    telemetry.track(TelemetryEvent.TOOL_USED, { tool: "test" });

    expect(posthog.capture).toHaveBeenCalledWith(
      expect.objectContaining({ distinctId: installationId() }),
    );
  });
});
