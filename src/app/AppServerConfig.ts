/**
 * Runtime configuration interface for the AppServer.
 *
 * AppServerConfig only controls service composition and runtime wiring.
 * Environment / YAML / default-based settings are sourced from AppConfig.
 */

export interface AppServerConfig {
  /** Enable web interface routes and static file serving */
  enableWebInterface: boolean;

  /** Enable MCP protocol routes for AI tool integration */
  enableMcpServer: boolean;

  /** Enable API server (tRPC at /api) for programmatic access */
  enableApiServer: boolean;

  /** Enable embedded worker for job processing */
  enableWorker: boolean;

  /**
   * Port to run the server on.
   *
   * AppConfig contains multiple ports; AppServerConfig selects which one to bind.
   */
  port: number;

  /** URL of external worker server (if using external worker instead of embedded) */
  externalWorkerUrl?: string;

  /** Show ASCII art logo on startup (default: true) */
  showLogo?: boolean;

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
