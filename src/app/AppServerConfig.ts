/**
 * Configuration interface for the AppServer.
 * Defines which services should be enabled and their configuration options.
 */

import type { AuthConfig } from "../auth/types";

export interface AppServerConfig {
  /** Enable web interface routes and static file serving */
  enableWebInterface: boolean;

  /** Enable MCP protocol routes for AI tool integration */
  enableMcpServer: boolean;

  /** Enable API server (tRPC at /api) for programmatic access */
  enableApiServer: boolean;

  /** Enable embedded worker for job processing */
  enableWorker: boolean;

  /** Port to run the server on */
  port: number;

  /** Host to bind the server to */
  host: string;

  /** URL of external worker server (if using external worker instead of embedded) */
  externalWorkerUrl?: string;

  /** Whether to run MCP server in read-only mode */
  readOnly?: boolean;

  /** Optional OAuth2/OIDC authentication configuration for MCP endpoints */
  auth?: AuthConfig;

  /** Enable telemetry tracking for usage analytics and performance monitoring */
  telemetry?: boolean;

  /** Startup context for telemetry (optional) */
  startupContext?: {
    /** CLI command that started the server (if applicable) */
    cliCommand?: string;
    /** MCP protocol configuration (if MCP service enabled) */
    mcpProtocol?: "stdio" | "http";
    /** MCP transport configuration (if MCP service enabled) */
    mcpTransport?: "sse" | "streamable";
  };
}
