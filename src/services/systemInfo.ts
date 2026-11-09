/**
 * Distilled, serializable snapshot of how the server process was started.
 *
 * `SystemInfo` is derived once from {@link AppServerConfig} (service
 * composition/runtime wiring) and {@link AppConfig} (resolved env/YAML/CLI
 * configuration) when the tRPC service is registered. It intentionally
 * contains no measured/live state — the goal is an honest reflection of the
 * running configuration, not a health probe. Live state (e.g. whether a
 * remote worker is currently connected) is threaded through the tRPC context
 * separately; see {@link ./appRouter}.
 */
import type { AppServerConfig } from "../app/AppServerConfig";
import type { AppConfig } from "../utils/config";
import { LEGACY_SSE_PATH, MCP_ENDPOINT_PATH } from "./mcpService";

/** Which top-level services this process was started with. */
export interface SystemInfoServices {
  web: boolean;
  mcp: boolean;
  api: boolean;
  worker: boolean;
}

/**
 * How the pipeline worker is wired: embedded in this process, or delegated
 * to a remote worker reachable over HTTP/WebSocket.
 */
export type SystemInfoWorker =
  | { mode: "embedded"; maxConcurrency: number }
  | { mode: "remote"; url: string };

/**
 * MCP protocol exposure. `endpoints` lists the paths the MCP server answers
 * on, relative to the public URL; `url` is the advertised MCP endpoint URL
 * clients connect to.
 */
export type SystemInfoMcp =
  | { enabled: true; endpoints: string[]; url: string }
  | { enabled: false; endpoints: string[] };

/** OAuth2/OIDC authentication configuration. */
export interface SystemInfoAuth {
  enabled: boolean;
  /** The OIDC issuer URL, present only when auth is enabled and configured. */
  issuer?: string;
}

/** Scrape limits used when a job leaves these options unspecified. */
export interface SystemInfoScraper {
  maxPages: number;
  maxDepth: number;
}

/**
 * Distilled, serializable snapshot of the server's startup configuration.
 * Safe to assemble a single time at service-registration and share across
 * every tRPC request (HTTP and WebSocket alike).
 */
export interface SystemInfo {
  version: string;
  readOnly: boolean;
  telemetryEnabled: boolean;
  services: SystemInfoServices;
  worker: SystemInfoWorker;
  mcp: SystemInfoMcp;
  auth: SystemInfoAuth;
  scraper: SystemInfoScraper;
}

/**
 * Assembles the {@link SystemInfo} snapshot from server + app configuration.
 * @param serverConfig - Service composition/runtime wiring for this process.
 * @param appConfig - Resolved application configuration (env/YAML/CLI merged).
 * @param mcpEndpointUrl - The advertised public URL of the MCP endpoint.
 * @param workerUrl - The remote worker's API URL; jobs run in this process without it.
 * @returns The distilled system info to thread through the tRPC context.
 */
export function buildSystemInfo(
  serverConfig: AppServerConfig,
  appConfig: AppConfig,
  mcpEndpointUrl: string,
  workerUrl: string | undefined,
): SystemInfo {
  const mcpEnabled = Boolean(serverConfig.enableMcpServer);
  const authEnabled = Boolean(appConfig.auth.enabled);

  return {
    version: __APP_VERSION__,
    readOnly: Boolean(appConfig.app.readOnly),
    telemetryEnabled: Boolean(appConfig.app.telemetryEnabled),
    services: {
      web: Boolean(serverConfig.enableWebInterface),
      mcp: mcpEnabled,
      api: Boolean(serverConfig.enableApiServer),
      worker: !workerUrl,
    },
    worker: workerUrl
      ? { mode: "remote", url: workerUrl }
      : { mode: "embedded", maxConcurrency: appConfig.scraper.maxConcurrency },
    // The deprecated SSE transport is served only while authentication is off.
    mcp: mcpEnabled
      ? {
          enabled: true,
          endpoints: authEnabled
            ? [MCP_ENDPOINT_PATH]
            : [MCP_ENDPOINT_PATH, LEGACY_SSE_PATH],
          url: mcpEndpointUrl,
        }
      : { enabled: false, endpoints: [] },
    auth: {
      enabled: authEnabled,
      issuer:
        authEnabled && appConfig.auth.issuerUrl ? appConfig.auth.issuerUrl : undefined,
    },
    scraper: {
      maxPages: appConfig.scraper.maxPages,
      maxDepth: appConfig.scraper.maxDepth,
    },
  };
}
