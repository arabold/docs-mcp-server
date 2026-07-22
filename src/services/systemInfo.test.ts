import { describe, expect, it } from "vitest";
import type { AppServerConfig } from "../app/AppServerConfig";
import { type AppConfig, loadConfig } from "../utils/config";
import { buildSystemInfo } from "./systemInfo";

/**
 * Minimal, fully-specified AppServerConfig for building test fixtures without
 * repeating every field for each test.
 */
function baseServerConfig(overrides: Partial<AppServerConfig> = {}): AppServerConfig {
  return {
    enableWebInterface: false,
    enableMcpServer: false,
    enableApiServer: true,
    enableWorker: false,
    port: 6280,
    ...overrides,
  };
}

describe("buildSystemInfo", () => {
  const appConfig: AppConfig = loadConfig();

  it("reports embedded worker mode with no url when externalWorkerUrl is unset", () => {
    const info = buildSystemInfo(baseServerConfig({ enableWorker: true }), appConfig);

    expect(info.worker).toEqual({
      mode: "embedded",
      maxConcurrency: appConfig.scraper.maxConcurrency,
    });
  });

  it("reports remote worker mode with the configured url when externalWorkerUrl is set", () => {
    const info = buildSystemInfo(
      baseServerConfig({ externalWorkerUrl: "http://worker.example.com" }),
      appConfig,
    );

    expect(info.worker).toEqual({
      mode: "remote",
      url: "http://worker.example.com",
    });
  });

  it("reflects which services were started", () => {
    const info = buildSystemInfo(
      baseServerConfig({
        enableWebInterface: true,
        enableMcpServer: true,
        enableApiServer: true,
        enableWorker: true,
      }),
      appConfig,
    );

    expect(info.services).toEqual({
      web: true,
      mcp: true,
      api: true,
      worker: true,
    });
  });

  it("includes MCP endpoints only when the MCP server is enabled", () => {
    const enabled = buildSystemInfo(
      baseServerConfig({ enableMcpServer: true }),
      appConfig,
    );
    expect(enabled.mcp).toEqual({ enabled: true, endpoints: ["/mcp", "/sse"] });

    const disabled = buildSystemInfo(
      baseServerConfig({ enableMcpServer: false }),
      appConfig,
    );
    expect(disabled.mcp).toEqual({ enabled: false, endpoints: [] });
  });

  it("omits the issuer when auth is disabled", () => {
    const disabledAuthConfig: AppConfig = JSON.parse(JSON.stringify(appConfig));
    disabledAuthConfig.auth.enabled = false;
    disabledAuthConfig.auth.issuerUrl = "https://auth.example.com";

    const info = buildSystemInfo(baseServerConfig(), disabledAuthConfig);

    expect(info.auth).toEqual({ enabled: false, issuer: undefined });
  });

  it("reports the issuer when auth is enabled and an issuer url is configured", () => {
    const enabledAuthConfig: AppConfig = JSON.parse(JSON.stringify(appConfig));
    enabledAuthConfig.auth.enabled = true;
    enabledAuthConfig.auth.issuerUrl = "https://auth.example.com";

    const info = buildSystemInfo(baseServerConfig(), enabledAuthConfig);

    expect(info.auth).toEqual({
      enabled: true,
      issuer: "https://auth.example.com",
    });
  });

  it("carries through readOnly, telemetryEnabled, and version", () => {
    const customConfig: AppConfig = JSON.parse(JSON.stringify(appConfig));
    customConfig.app.readOnly = true;
    customConfig.app.telemetryEnabled = false;

    const info = buildSystemInfo(baseServerConfig(), customConfig);

    expect(info.readOnly).toBe(true);
    expect(info.telemetryEnabled).toBe(false);
    expect(typeof info.version).toBe("string");
    expect(info.version.length).toBeGreaterThan(0);
  });
});
