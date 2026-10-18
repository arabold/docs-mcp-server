/**
 * Behavior tests for AppServer on a real Fastify server: service composition,
 * startup log lines, authentication setup, host and origin admission, and
 * the server's lifecycle. Only the token verifier is mocked.
 */
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFreePort } from "../../test/test-helpers";
import { EventBusService } from "../events";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { JobsBackend } from "../services/backend";
import type { DocumentManagementService } from "../store/DocumentManagementService";
import { type AppConfig, loadConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { AppServer } from "./AppServer";
import type { AppServerConfig } from "./AppServerConfig";

const createVerifier = vi.hoisted(() => vi.fn());

vi.mock("../auth/JwtAccessTokenVerifier", () => ({
  JwtAccessTokenVerifier: { create: createVerifier },
}));

/** The backend a server receives: local, with an empty store and pipeline. */
function backend(): JobsBackend {
  return {
    workerUrl: undefined,
    docService: {
      getActiveEmbeddingConfig: () => null,
    } as unknown as DocumentManagementService,
    pipeline: {} as IPipeline,
    eventBus: new EventBusService(),
    isWorkerConnected: undefined,
    close: vi.fn(),
  };
}

/** Which services to run; everything off, on a free port, unless overridden. */
function services(overrides: Partial<AppServerConfig> = {}): AppServerConfig {
  return {
    enableWebInterface: false,
    enableMcpServer: false,
    enableApiServer: false,
    port: 0,
    showLogo: false,
    ...overrides,
  };
}

/** The application config bound to loopback, adjusted by `configure`. */
function appConfig(configure: (config: AppConfig) => void = () => {}): AppConfig {
  const config = loadConfig();
  config.server.host = "127.0.0.1";
  configure(config);
  return config;
}

/** Enables authentication against a test issuer, behind `publicUrl` when given. */
function withAuth(
  overrides: Partial<AppConfig["auth"]> = {},
  publicUrl?: string,
): (config: AppConfig) => void {
  return (config) => {
    config.auth.enabled = true;
    config.auth.issuerUrl = "https://auth.example.com";
    config.auth.audience = "";
    Object.assign(config.auth, overrides);
    if (publicUrl) config.server.publicUrl = publicUrl;
  };
}

const running: AppServer[] = [];

/** Starts a server and stops it after the test. */
async function start(serverConfig: AppServerConfig, config: AppConfig = appConfig()) {
  const server = new AppServer(backend(), serverConfig, config);
  const app = await server.start();
  running.push(server);
  return { server, app, port: (app.server.address() as AddressInfo).port };
}

/** The lines the server logged at a level. */
function logged(level: "info" | "warn"): string[] {
  return vi.mocked(logger[level]).mock.calls.map(([message]) => String(message));
}

describe("AppServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createVerifier.mockResolvedValue({ verifyAccessToken: vi.fn() });
  });

  afterEach(async () => {
    for (const server of running.splice(0)) await server.stop();
  });

  it("serves only the enabled services", async () => {
    const cases: Array<{ label: string; web: boolean; mcp: boolean; api: boolean }> = [
      { label: "no services", web: false, mcp: false, api: false },
      { label: "web interface only", web: true, mcp: false, api: false },
      { label: "MCP endpoint only", web: false, mcp: true, api: false },
      { label: "API only", web: false, mcp: false, api: true },
      { label: "all services", web: true, mcp: true, api: true },
    ];

    for (const { label, web, mcp, api } of cases) {
      const { app } = await start(
        services({ enableWebInterface: web, enableMcpServer: mcp, enableApiServer: api }),
      );

      const shell = await app.inject({ method: "GET", url: "/" });
      expect.soft(shell.statusCode, `${label}: GET /`).toBe(web ? 200 : 404);
      if (web) {
        expect
          .soft(shell.headers["content-type"], `${label}: GET /`)
          .toMatch(/text\/html/);
      }
      const mcpResponse = await app.inject({ method: "POST", url: "/mcp", payload: {} });
      if (mcp) expect.soft(mcpResponse.statusCode, `${label}: POST /mcp`).not.toBe(404);
      else expect.soft(mcpResponse.statusCode, `${label}: POST /mcp`).toBe(404);
      const ping = await app.inject({ method: "GET", url: "/api/ping" });
      expect.soft(ping.statusCode, `${label}: GET /api/ping`).toBe(api ? 200 : 404);
    }
  });

  it("logs the URLs clients use to reach the server", async () => {
    const port = await getFreePort();
    const cases: Array<{
      label: string;
      serverConfig: AppServerConfig;
      configure: (config: AppConfig) => void;
      logs: string[];
      omits?: string[];
      quiet?: boolean;
    }> = [
      {
        label: "wildcard bind: the bind host, not the listen address, and no warnings",
        serverConfig: services({
          enableWebInterface: true,
          enableMcpServer: true,
          enableApiServer: true,
          port,
        }),
        configure: (config) => {
          config.server.host = "0.0.0.0";
        },
        logs: [
          `🚀 Grounded Docs available at http://0.0.0.0:${port}`,
          `MCP endpoint: http://0.0.0.0:${port}/mcp`,
        ],
        omits: ["/sse", `http://127.0.0.1:${port}`],
        quiet: true,
      },
      {
        label: "public origin",
        serverConfig: services({
          enableWebInterface: true,
          enableMcpServer: true,
          enableApiServer: true,
        }),
        configure: (config) => {
          config.server.host = "0.0.0.0";
          config.server.publicOrigin = "https://docs.example.com";
        },
        logs: [
          "🚀 Grounded Docs available at https://docs.example.com",
          "MCP endpoint: https://docs.example.com/mcp",
        ],
      },
      {
        label: "public URL with a path",
        serverConfig: services({ enableMcpServer: true }),
        configure: (config) => {
          config.server.publicUrl = "https://docs.example.com/tools";
        },
        logs: ["MCP endpoint: https://docs.example.com/tools/mcp"],
      },
    ];

    for (const { label, serverConfig, configure, logs, omits = [], quiet } of cases) {
      vi.clearAllMocks();
      await start(serverConfig, appConfig(configure));
      const info = logged("info");

      for (const line of logs) {
        expect
          .soft(
            info.some((message) => message.includes(line)),
            `${label}: ${line}`,
          )
          .toBe(true);
      }
      for (const text of omits) {
        expect
          .soft(
            info.filter((message) => message.includes(text)),
            label,
          )
          .toEqual([]);
      }
      if (quiet) expect.soft(logged("warn"), label).toEqual([]);
      for (const server of running.splice(0)) await server.stop();
    }
  });

  it("warns about server.publicOrigin when it is in effect or ignored", () => {
    const cases = [
      {
        label: "deprecated when in effect",
        configure: (config: AppConfig) => {
          config.server.publicOrigin = "https://docs.example.com";
        },
        warning: /publicOrigin is deprecated.*server\.publicUrl/,
      },
      {
        label: "ignored next to server.publicUrl",
        configure: (config: AppConfig) => {
          config.server.publicOrigin = "https://old.example.com";
          config.server.publicUrl = "https://example.com/docs";
        },
        warning: /server\.publicOrigin is ignored/,
      },
    ];

    for (const { label, configure, warning } of cases) {
      vi.clearAllMocks();
      new AppServer(backend(), services({ enableApiServer: true }), appConfig(configure));

      expect
        .soft(
          logged("warn").some((message) => warning.test(message)),
          label,
        )
        .toBe(true);
    }
  });

  it("refuses to start authentication without a public URL or an issuer", async () => {
    const cases = [
      { label: "no public URL", configure: withAuth(), error: /server\.publicUrl/ },
      {
        label: "no issuer",
        configure: withAuth({ issuerUrl: "" }, "https://docs.example.com/tools"),
        error: /auth\.issuerUrl/,
      },
    ];

    for (const { label, configure, error } of cases) {
      const server = new AppServer(
        backend(),
        services({ enableMcpServer: true }),
        appConfig(configure),
      );
      await expect.soft(server.start(), label).rejects.toThrow(error);
    }
  });

  it("expects the configured audience when one is set", async () => {
    await start(
      services({ enableMcpServer: true }),
      appConfig(
        withAuth(
          { audience: "https://api.example.com" },
          "https://docs.example.com/tools",
        ),
      ),
    );

    expect(createVerifier).toHaveBeenCalledWith({
      issuerUrl: "https://auth.example.com",
      audience: "https://api.example.com",
    });
  });

  it("states at startup that only the MCP endpoint is protected", async () => {
    await start(
      services({ enableMcpServer: true }),
      appConfig(withAuth({}, "https://docs.example.com/tools")),
    );

    expect(logged("info")).toContainEqual(
      expect.stringContaining(
        "Authentication: protects https://docs.example.com/tools/mcp only; the web UI and API are not protected",
      ),
    );
  });

  it("warns that authentication protects nothing without an MCP endpoint", async () => {
    await start(services({ enableApiServer: true }), appConfig(withAuth()));

    expect(logged("warn")).toContainEqual(expect.stringContaining("protects nothing"));
    expect(createVerifier).not.toHaveBeenCalled();
  });

  it("checks the host on every bind and shields the API from foreign origins only on a loopback bind", async () => {
    const loopback = await start(services({ enableApiServer: true }));
    const wildcard = await start(
      services({ enableApiServer: true }),
      appConfig((config) => {
        config.server.host = "0.0.0.0";
      }),
    );
    const foreignOrigin = { host: "127.0.0.1:6280", origin: "https://attacker.example" };
    const cases = [
      {
        label: "loopback, foreign origin, API",
        server: loopback,
        headers: foreignOrigin,
        url: "/api/ping",
        status: 403,
      },
      // The shield covers the API only; this path has no route
      {
        label: "loopback, foreign origin, asset",
        server: loopback,
        headers: foreignOrigin,
        url: "/assets/app.js",
        status: 404,
      },
      {
        label: "loopback, local host name",
        server: loopback,
        headers: { host: "localhost:6280" },
        url: "/api/ping",
        status: 200,
      },
      {
        label: "wildcard, foreign origin, API",
        server: wildcard,
        headers: foreignOrigin,
        url: "/api/ping",
        status: 200,
      },
      {
        label: "wildcard, foreign host name",
        server: wildcard,
        headers: { host: "attacker.example:6280" },
        url: "/api/ping",
        status: 403,
      },
    ];

    for (const { label, server, headers, url, status } of cases) {
      const response = await server.app.inject({ method: "GET", url, headers });
      expect.soft(response.statusCode, label).toBe(status);
    }
  });

  it("fails to start when the port is taken", async () => {
    const { port } = await start(services({ enableApiServer: true }));
    const second = new AppServer(
      backend(),
      services({ enableApiServer: true, port }),
      appConfig(),
    );

    await expect(second.start()).rejects.toThrow(/EADDRINUSE/);
  });

  it("releases the port when stopped", async () => {
    const server = new AppServer(
      backend(),
      services({ enableApiServer: true }),
      appConfig(),
    );
    const app = await server.start();
    const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/ping`;
    expect((await fetch(url)).status).toBe(200);

    await server.stop();

    await expect(fetch(url)).rejects.toThrow();
  });
});
