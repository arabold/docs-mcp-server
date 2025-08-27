import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "../utils/logger";
import { createMcpServerInstance } from "./mcpServer";
import type { McpServerTools } from "./tools";

/**
 * Starts the MCP server using the Stdio transport.
 * @param tools The shared tool instances.
 * @param readOnly Whether to run in read-only mode.
 * @returns The created McpServer instance.
 */
export async function startStdioServer(
  tools: McpServerTools,
  readOnly = false,
): Promise<McpServer> {
  // Create a server instance using the factory and shared tools
  const server = createMcpServerInstance(tools, readOnly);

  // Start server with Stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("🤖 MCP server listening on stdio");

  // Return the server instance
  return server;
}
