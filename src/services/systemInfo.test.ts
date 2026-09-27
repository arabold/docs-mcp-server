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

const MCP_URL = "https://docs.example.com/tools/mcp";

describe("buildSystemInfo", () => {
  const appConfig: AppConfig = loadConfig();

  it("reports embedded worker mode with no url when externalWorkerUrl is unset", () => {
    const info = buildSystemInfo(
      baseServerConfig({ enableWorker: true }),
      appConfig,
      MCP_URL,
    );

    expect(info.worker).toEqual({
      mode: "embedded",
      maxConcurrency: appConfig.scraper.maxConcurrency,
    });
  });

  it("reports remote worker mode with the configured url when externalWorkerUrl is set", () => {
    const info = buildSystemInfo(
      baseServerConfig({ externalWorkerUrl: "http://worker.example.com" }),
      appConfig,
      MCP_URL,
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
      MCP_URL,
    );

    expect(info.services).toEqual({
      web: true,
      mcp: true,
      api: true,
      worker: true,
    });
  });

  it("reports scraper limits for clients that use the configured defaults", () => {
    const customConfig: AppConfig = JSON.parse(JSON.stringify(appConfig));
    customConfig.scraper.maxPages = 250;
    customConfig.scraper.maxDepth = 0;

    const info = buildSystemInfo(baseServerConfig(), customConfig, MCP_URL);

    expect(info.scraper).toEqual({ maxPages: 250, maxDepth: 0 });
  });

  it("advertises the MCP endpoint URL only when the MCP server is enabled", () => {
    const enabled = buildSystemInfo(
      baseServerConfig({ enableMcpServer: true }),
      appConfig,
      MCP_URL,
    );
    expect(enabled.mcp).toEqual({ enabled: true, endpoints: [MCP_URL] });

    const disabled = buildSystemInfo(
      baseServerConfig({ enableMcpServer: false }),
      appConfig,
      MCP_URL,
    );
    expect(disabled.mcp).toEqual({ enabled: false, endpoints: [] });
  });

  it("omits the issuer when auth is disabled", () => {
    const disabledAuthConfig: AppConfig = JSON.parse(JSON.stringify(appConfig));
    disabledAuthConfig.auth.enabled = false;
    disabledAuthConfig.auth.issuerUrl = "https://auth.example.com";

    const info = buildSystemInfo(baseServerConfig(), disabledAuthConfig, MCP_URL);

    expect(info.auth).toEqual({ enabled: false, issuer: undefined });
  });

  it("reports the issuer when auth is enabled and an issuer url is configured", () => {
    const enabledAuthConfig: AppConfig = JSON.parse(JSON.stringify(appConfig));
    enabledAuthConfig.auth.enabled = true;
    enabledAuthConfig.auth.issuerUrl = "https://auth.example.com";

    const info = buildSystemInfo(baseServerConfig(), enabledAuthConfig, MCP_URL);

    expect(info.auth).toEqual({
      enabled: true,
      issuer: "https://auth.example.com",
    });
  });

  it("carries through readOnly, telemetryEnabled, and version", () => {
    const customConfig: AppConfig = JSON.parse(JSON.stringify(appConfig));
    customConfig.app.readOnly = true;
    customConfig.app.telemetryEnabled = false;

    const info = buildSystemInfo(baseServerConfig(), customConfig, MCP_URL);

    expect(info.readOnly).toBe(true);
    expect(info.telemetryEnabled).toBe(false);
    expect(typeof info.version).toBe("string");
    expect(info.version.length).toBeGreaterThan(0);
  });
});
