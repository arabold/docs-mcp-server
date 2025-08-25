/**
 * Session management utilities for different interface types.
 * Creates appropriate session context for CLI, MCP, Web, and Pipeline interfaces.
 * Application-level context is now handled by global context in Analytics.
 */

import { randomUUID } from "node:crypto";
import type { SessionContext } from "./SessionContext";

/**
 * Create session context for CLI command execution
 */
export function createCliSession(command?: string): SessionContext {
  return {
    sessionId: randomUUID(),
    startTime: new Date(),
    appInterface: "cli" as const,
    cliCommand: command,
  };
}

/**
 * Create session context for MCP protocol sessions
 */
export function createMcpSession(options: {
  protocol?: "stdio" | "http";
  transport?: "sse" | "streamable";
}): SessionContext {
  return {
    sessionId: randomUUID(),
    appInterface: "mcp" as const,
    startTime: new Date(),
    mcpProtocol: options.protocol || "stdio",
    mcpTransport: options.transport,
  };
}

/**
 * Create session context for web interface sessions
 */
export function createWebSession(options: { route?: string }): SessionContext {
  return {
    sessionId: randomUUID(),
    appInterface: "web" as const,
    startTime: new Date(),
    mcpProtocol: "http" as const,
    webRoute: options.route,
  };
}

/**
 * Create session context for pipeline worker sessions
 */
export function createPipelineSession(): SessionContext {
  return {
    sessionId: randomUUID(),
    appInterface: "pipeline" as const,
    startTime: new Date(),
  };
}

/**
 * Get enabled services from configuration
 */
export function getEnabledServices(config?: {
  web?: boolean;
  mcp?: boolean;
  api?: boolean;
  worker?: boolean;
}): string[] {
  const services: string[] = [];

  if (config?.web) services.push("web");
  if (config?.mcp) services.push("mcp");
  if (config?.api) services.push("api");
  if (config?.worker) services.push("worker");

  return services.length > 0 ? services : ["worker"]; // Default to worker
}
