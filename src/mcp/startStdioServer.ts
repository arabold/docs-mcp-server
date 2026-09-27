import { type StdioServerHandle, serveStdio } from "@modelcontextprotocol/server/stdio";
import type { AppConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { createMcpServerInstance } from "./mcpServer";
import type { McpServerTools } from "./tools";

/**
 * Starts the MCP server on the process's stdio.
 *
 * Serves clients on the current protocol revision as well as clients that open
 * with an earlier revision's `initialize` handshake. Each connection gets a
 * server instance from the shared factory.
 *
 * @param tools The shared tool instances.
 * @param config The application configuration.
 * @returns The handle that closes the stdio connection on shutdown.
 */
export async function startStdioServer(
  tools: McpServerTools,
  config: AppConfig,
): Promise<StdioServerHandle> {
  const handle = serveStdio(() => createMcpServerInstance(tools, config), {
    legacy: "serve",
    onerror: (error) => logger.error(`❌ MCP stdio transport error: ${error.message}`),
  });
  logger.info("🤖 MCP server listening on stdio");
  return handle;
}
