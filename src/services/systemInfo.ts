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

/** MCP protocol exposure, when enabled. */
export interface SystemInfoMcp {
  enabled: boolean;
  /** Relative endpoint paths the MCP server answers on (empty when disabled). */
  endpoints: string[];
}

/** OAuth2/OIDC authentication configuration. */
export interface SystemInfoAuth {
  enabled: boolean;
  /** The OIDC issuer URL, present only when auth is enabled and configured. */
  issuer?: string;
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
}

/**
 * Assembles the {@link SystemInfo} snapshot from server + app configuration.
 * @param serverConfig - Service composition/runtime wiring for this process.
 * @param appConfig - Resolved application configuration (env/YAML/CLI merged).
 * @returns The distilled system info to thread through the tRPC context.
 */
export function buildSystemInfo(
  serverConfig: AppServerConfig,
  appConfig: AppConfig,
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
      worker: Boolean(serverConfig.enableWorker),
    },
    worker: serverConfig.externalWorkerUrl
      ? { mode: "remote", url: serverConfig.externalWorkerUrl }
      : { mode: "embedded", maxConcurrency: appConfig.scraper.maxConcurrency },
    mcp: {
      enabled: mcpEnabled,
      endpoints: mcpEnabled ? ["/mcp", "/sse"] : [],
    },
    auth: {
      enabled: authEnabled,
      issuer:
        authEnabled && appConfig.auth.issuerUrl ? appConfig.auth.issuerUrl : undefined,
    },
  };
}
