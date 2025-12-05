/**
 * MCP service that registers MCP protocol routes for AI tool integration.
 * Provides modular server composition for MCP endpoints.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ProxyAuthManager } from "../auth";
import { createAuthMiddleware } from "../auth/middleware";
import { createMcpServerInstance } from "../mcp/mcpServer";
import { initializeTools } from "../mcp/tools";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { telemetry } from "../telemetry";
import { logger } from "../utils/logger";

/**
 * Register MCP protocol routes on a Fastify server instance.
 * This includes SSE endpoints for persistent connections and HTTP endpoints for stateless requests.
 *
 * @param server The Fastify server instance
 * @param docService The document management service
 * @param pipeline The pipeline instance
 * @param readOnly Whether to run in read-only mode
 * @returns The McpServer instance for cleanup
 */
export async function registerMcpService(
  server: FastifyInstance,
  docService: IDocumentManagement,
  pipeline: IPipeline,
  readOnly = false,
  authManager?: ProxyAuthManager,
): Promise<McpServer> {
  // Initialize MCP server and tools
  const mcpTools = await initializeTools(docService, pipeline);
  const mcpServer = createMcpServerInstance(mcpTools, readOnly);

  // Setup auth middleware if auth manager is provided
  const authMiddleware = authManager ? createAuthMiddleware(authManager) : null;

  // Track SSE transports for cleanup
  const sseTransports: Record<string, SSEServerTransport> = {};

  // Track heartbeat intervals for cleanup
  const heartbeatIntervals: Record<string, NodeJS.Timeout> = {};

  // Heartbeat interval in milliseconds (30 seconds)
  const HEARTBEAT_INTERVAL_MS = 30_000;

  // SSE endpoint for MCP connections
  server.route({
    method: "GET",
    url: "/sse",
    preHandler: authMiddleware ? [authMiddleware] : undefined,
    handler: async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Handle SSE connection using raw response
        const transport = new SSEServerTransport("/messages", reply.raw);
        sseTransports[transport.sessionId] = transport;

        // Log client connection (simple connection tracking without sessions)
        if (telemetry.isEnabled()) {
          logger.info(`🔗 MCP client connected: ${transport.sessionId}`);
        }

        // Start heartbeat to keep connection alive and prevent client timeouts
        // SSE comments (lines starting with ':') are ignored by clients but keep the connection active
        const heartbeatInterval = setInterval(() => {
          try {
            reply.raw.write(": heartbeat\n\n");
          } catch {
            // Connection likely closed, cleanup will happen in close handler
            clearInterval(heartbeatInterval);
            delete heartbeatIntervals[transport.sessionId];
          }
        }, HEARTBEAT_INTERVAL_MS);
        heartbeatIntervals[transport.sessionId] = heartbeatInterval;

        // Cleanup function to handle both close and error scenarios
        const cleanupConnection = () => {
          const interval = heartbeatIntervals[transport.sessionId];
          if (interval) {
            clearInterval(interval);
            delete heartbeatIntervals[transport.sessionId];
          }

          delete sseTransports[transport.sessionId];
          transport.close();

          // Log client disconnection
          if (telemetry.isEnabled()) {
            logger.info(`🔗 MCP client disconnected: ${transport.sessionId}`);
          }
        };

        reply.raw.on("close", cleanupConnection);

        // Handle stream errors (e.g., client disconnects abruptly)
        reply.raw.on("error", (error) => {
          logger.debug(`SSE connection error: ${error}`);
          cleanupConnection();
        });

        await mcpServer.connect(transport);
      } catch (error) {
        logger.error(`❌ Error in SSE endpoint: ${error}`);
        reply.code(500).send({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // SSE message handling endpoint
  server.route({
    method: "POST",
    url: "/messages",
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const sessionId = url.searchParams.get("sessionId");
        const transport = sessionId ? sseTransports[sessionId] : undefined;

        if (transport) {
          await transport.handlePostMessage(request.raw, reply.raw, request.body);
        } else {
          reply.code(400).send({ error: "No transport found for sessionId" });
        }
      } catch (error) {
        logger.error(`❌ Error in messages endpoint: ${error}`);
        reply.code(500).send({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // Streamable HTTP endpoint for stateless MCP requests
  server.route({
    method: "POST",
    url: "/mcp",
    preHandler: authMiddleware ? [authMiddleware] : undefined,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // In stateless mode, create a new instance of server and transport for each request
        const requestServer = createMcpServerInstance(mcpTools, readOnly);
        const requestTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        const cleanupRequest = () => {
          logger.debug("Streamable HTTP request closed");
          requestTransport.close();
          requestServer.close(); // Close the per-request server instance
        };

        reply.raw.on("close", cleanupRequest);
        reply.raw.on("error", (error) => {
          logger.debug(`Streamable HTTP connection error: ${error}`);
          cleanupRequest();
        });

        await requestServer.connect(requestTransport);
        await requestTransport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error) {
        logger.error(`❌ Error in MCP endpoint: ${error}`);
        reply.code(500).send({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // Store reference to SSE transports on the server instance for cleanup
  (
    mcpServer as unknown as {
      _sseTransports: Record<string, SSEServerTransport>;
      _heartbeatIntervals: Record<string, NodeJS.Timeout>;
    }
  )._sseTransports = sseTransports;
  (
    mcpServer as unknown as {
      _heartbeatIntervals: Record<string, NodeJS.Timeout>;
    }
  )._heartbeatIntervals = heartbeatIntervals;

  return mcpServer;
}

/**
 * Clean up MCP service resources including SSE transports.
 */
export async function cleanupMcpService(mcpServer: McpServer): Promise<void> {
  try {
    // Clear all heartbeat intervals
    const heartbeatIntervals = (
      mcpServer as unknown as {
        _heartbeatIntervals: Record<string, NodeJS.Timeout>;
      }
    )._heartbeatIntervals;
    if (heartbeatIntervals) {
      for (const interval of Object.values(heartbeatIntervals)) {
        clearInterval(interval);
      }
    }

    // Close all SSE transports
    const sseTransports = (
      mcpServer as unknown as {
        _sseTransports: Record<string, SSEServerTransport>;
      }
    )._sseTransports;
    if (sseTransports) {
      for (const transport of Object.values(sseTransports)) {
        await transport.close();
      }
    }

    // Close MCP server
    await mcpServer.close();
    logger.debug("MCP service cleaned up");
  } catch (error) {
    logger.error(`❌ Failed to cleanup MCP service: ${error}`);
    throw error;
  }
}
