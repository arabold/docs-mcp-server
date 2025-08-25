/**
 * Session context interface for user interaction sessions.
 * Application-level context (version, platform, AI config) is now handled by global context.
 */
export interface SessionContext {
  startTime: Date;
  sessionId: string;

  // Interface type for this session
  appInterface: "mcp" | "cli" | "web" | "pipeline";

  // Interface-specific context
  cliCommand?: string; // CLI: command name
  mcpProtocol?: "stdio" | "http"; // MCP: protocol type
  mcpTransport?: "sse" | "streamable"; // MCP: transport mode
  webRoute?: string; // Web: current route
}
