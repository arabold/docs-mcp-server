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
    port: 6280,
    ...overrides,
  };
}

const MCP_URL = "https://docs.example.com/tools/mcp";

describe("buildSystemInfo", () => {
  const appConfig: AppConfig = loadConfig();

  it("reports where the worker runs", () => {
    const cases = [
      {
        label: "embedded, without a worker URL",
        workerUrl: undefined,
        worker: { mode: "embedded", maxConcurrency: appConfig.scraper.maxConcurrency },
      },
      {
        label: "remote, with the worker URL",
        workerUrl: "http://worker.example.com",
        worker: { mode: "remote", url: "http://worker.example.com" },
      },
    ];

    for (const { label, workerUrl, worker } of cases) {
      const info = buildSystemInfo(baseServerConfig(), appConfig, MCP_URL, workerUrl);

      expect.soft(info.worker, label).toEqual(worker);
    }
  });

  it("reports the MCP endpoint URL only when it is served, and the paths auth leaves open", () => {
    const withAuth = (enabled: boolean): AppConfig => {
      const config: AppConfig = JSON.parse(JSON.stringify(appConfig));
      config.auth.enabled = enabled;
      return config;
    };
    const cases = [
      {
        label: "MCP disabled",
        enableMcpServer: false,
        config: withAuth(false),
        mcp: { enabled: false, endpoints: [] },
      },
      {
        label: "MCP enabled without auth",
        enableMcpServer: true,
        config: withAuth(false),
        mcp: { enabled: true, url: MCP_URL, endpoints: ["/mcp", "/sse"] },
      },
      {
        label: "MCP enabled with auth",
        enableMcpServer: true,
        config: withAuth(true),
        mcp: { enabled: true, url: MCP_URL, endpoints: ["/mcp"] },
      },
    ];

    for (const { label, enableMcpServer, config, mcp } of cases) {
      const info = buildSystemInfo(
        baseServerConfig({ enableMcpServer }),
        config,
        MCP_URL,
        undefined,
      );

      expect.soft(info.mcp, label).toEqual(mcp);
    }
  });

  it("reports the issuer only when auth is enabled", () => {
    const cases = [
      { enabled: false, auth: { enabled: false, issuer: undefined } },
      { enabled: true, auth: { enabled: true, issuer: "https://auth.example.com" } },
    ];

    for (const { enabled, auth } of cases) {
      const config: AppConfig = JSON.parse(JSON.stringify(appConfig));
      config.auth.enabled = enabled;
      config.auth.issuerUrl = "https://auth.example.com";

      const info = buildSystemInfo(baseServerConfig(), config, MCP_URL, undefined);

      expect.soft(info.auth, `auth enabled: ${enabled}`).toEqual(auth);
    }
  });

  it("reports the started services, scraper limits, readOnly, telemetryEnabled and version", () => {
    const customConfig: AppConfig = JSON.parse(JSON.stringify(appConfig));
    customConfig.scraper.maxPages = 250;
    customConfig.scraper.maxDepth = 0;
    customConfig.app.readOnly = true;
    customConfig.app.telemetryEnabled = false;

    const info = buildSystemInfo(
      baseServerConfig({
        enableWebInterface: true,
        enableMcpServer: true,
        enableApiServer: true,
      }),
      customConfig,
      MCP_URL,
      undefined,
    );

    expect(info).toMatchObject({
      services: { web: true, mcp: true, api: true, worker: true },
      scraper: { maxPages: 250, maxDepth: 0 },
      readOnly: true,
      telemetryEnabled: false,
      version: __APP_VERSION__,
    });
  });
});
