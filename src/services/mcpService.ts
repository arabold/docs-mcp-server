/**
 * MCP service: registers the Streamable HTTP MCP endpoint on the application's
 * Fastify instance. It serves protocol revision 2026-07-28, and serves clients
 * on earlier, handshake-based revisions statelessly: each request is answered
 * by a fresh server instance, without a session, as the endpoint always has.
 *
 * Every request passes the same checks in a fixed order, and the first that
 * fails answers:
 *
 * 1. `Origin` (403), required by the transport spec to stop DNS rebinding;
 * 2. a CORS preflight, answered here and never authenticated, because
 *    browsers send no credentials with it;
 * 3. the HTTP method (405 with `Allow: POST`);
 * 4. authentication, when enabled (401 with a discovery challenge);
 * 5. MCP processing, by the SDK's per-request handler.
 *
 * While authentication is off, it also serves the deprecated HTTP+SSE
 * transport (`GET /sse`, `POST /messages`) for handshake-era clients.
 */

import type { IncomingMessage } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  type AuthInfo,
  bearerAuthChallengeResponse,
  createMcpHandler,
  type OAuthTokenVerifier,
  verifyBearerToken,
} from "@modelcontextprotocol/server";
import { SSEServerTransport } from "@modelcontextprotocol/server-legacy/sse";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  type OriginPolicy,
  setCorsPreflightHeaders,
  setCorsResponseHeaders,
} from "../app/originPolicy";
import { missingTokenChallenge } from "../auth/protectedResourceMetadata";
import { createMcpServerInstance } from "../mcp/mcpServer";
import { initializeTools } from "../mcp/tools";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { AppConfig } from "../utils/config";
import { logger } from "../utils/logger";
import type { PublicLocation } from "../utils/serverOrigin";

/** Path of the MCP endpoint, relative to the public URL. */
export const MCP_ENDPOINT_PATH = "/mcp";

/** Authentication for the MCP endpoint. */
export interface McpEndpointAuth {
  /** Verifies bearer tokens; throws `OAuthError` for any rejection. */
  verifier: OAuthTokenVerifier;
  /** Metadata URL advertised in every challenge. */
  resourceMetadataUrl: string;
}

/** Everything the MCP endpoint needs from the application. */
export interface McpServiceDeps {
  docService: IDocumentManagement;
  pipeline: IPipeline;
  config: AppConfig;
  originPolicy: OriginPolicy;
  /** Where clients reach the server; the SSE message URL carries its base path. */
  location: PublicLocation;
}

/** Legacy SSE streams open at once; more connections get 503. */
export const LEGACY_SSE_MAX_SESSIONS = 100;

const ALL_METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function jsonRpcError(message: string) {
  return { jsonrpc: "2.0", error: { code: -32000, message }, id: null };
}

/**
 * Checks that run before the body is parsed: origin, preflight, method.
 * Answering from `onRequest` keeps the order independent of Fastify's body
 * parsing, which would otherwise reject some requests first.
 */
function createPreflightChecks(originPolicy: OriginPolicy) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = headerValue(request.headers.origin);
    const verdict = originPolicy.check(origin);
    if (verdict === "denied") {
      return reply.code(403).send(jsonRpcError("Forbidden: origin not allowed."));
    }

    const allowedOrigin = verdict === "allowed" ? origin : undefined;
    if (
      request.method === "OPTIONS" &&
      allowedOrigin !== undefined &&
      request.headers["access-control-request-method"] !== undefined
    ) {
      setCorsPreflightHeaders(
        reply.raw,
        allowedOrigin,
        headerValue(request.headers["access-control-request-headers"]),
      );
      return reply.code(204).send();
    }

    if (allowedOrigin !== undefined) {
      setCorsResponseHeaders(reply.raw, allowedOrigin);
    }

    if (request.method !== "POST") {
      return reply
        .code(405)
        .header("Allow", "POST")
        .send(jsonRpcError("Method not allowed."));
    }
  };
}

/** Answers 403 for a denied origin, and sets CORS headers for an allowed one. */
function createOriginCheck(originPolicy: OriginPolicy) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = headerValue(request.headers.origin);
    const verdict = originPolicy.check(origin);
    if (verdict === "denied") {
      return reply.code(403).send(jsonRpcError("Forbidden: origin not allowed."));
    }
    if (verdict === "allowed" && origin !== undefined) {
      setCorsResponseHeaders(reply.raw, origin);
    }
  };
}

/** Copy a web-standard `Response` produced by the SDK onto the Fastify reply. */
async function sendWebResponse(reply: FastifyReply, response: Response) {
  reply.code(response.status);
  response.headers.forEach((value, name) => {
    reply.header(name, value);
  });
  return reply.send(await response.text());
}

/**
 * Register the MCP endpoint on a Fastify server.
 *
 * @param server - The Fastify instance.
 * @param deps - Services and policy the endpoint needs.
 * @param auth - Authentication for the endpoint; omit to serve it without authentication.
 */
export async function registerMcpService(
  server: FastifyInstance,
  deps: McpServiceDeps,
  auth?: McpEndpointAuth,
): Promise<void> {
  const tools = await initializeTools(deps.docService, deps.pipeline, deps.config);
  const createServer = () => createMcpServerInstance(tools, deps.config);
  const handleMcpRequest = toNodeHandler(
    createMcpHandler(createServer, { legacy: "stateless" }),
  );

  server.route({
    method: ALL_METHODS,
    url: MCP_ENDPOINT_PATH,
    onRequest: createPreflightChecks(deps.originPolicy),
    handler: async (request, reply) => {
      let authInfo: AuthInfo | undefined;
      if (auth) {
        const authorization = headerValue(request.headers.authorization);
        if (!authorization || !/^Bearer\s+\S/i.test(authorization)) {
          return reply
            .code(401)
            .header("WWW-Authenticate", missingTokenChallenge(auth.resourceMetadataUrl))
            .send({ error_description: "A bearer token is required." });
        }
        try {
          authInfo = await verifyBearerToken(authorization, {
            verifier: auth.verifier,
            resourceMetadataUrl: auth.resourceMetadataUrl,
          });
        } catch (error) {
          logger.debug(`MCP request rejected by token verification: ${error}`);
          return sendWebResponse(
            reply,
            bearerAuthChallengeResponse(error, {
              resourceMetadataUrl: auth.resourceMetadataUrl,
            }),
          );
        }
      }

      reply.hijack();
      const raw = request.raw as IncomingMessage & { auth?: AuthInfo };
      if (authInfo) {
        raw.auth = authInfo;
      }
      try {
        await handleMcpRequest(raw, reply.raw, request.body);
      } catch (error) {
        logger.error(`❌ Error in MCP endpoint: ${error}`);
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { "Content-Type": "application/json" });
          reply.raw.end(JSON.stringify(jsonRpcError("Internal server error.")));
        }
      }
    },
  });

  if (!auth) {
    registerLegacySseTransport(server, deps, createServer);
  }
}

/**
 * Register the deprecated HTTP+SSE transport: `GET /sse` opens an event stream
 * whose `endpoint` event names `<basePath>/messages?sessionId=…`, and clients
 * POST their messages there. Each stream gets its own MCP server instance.
 * Only registered while authentication is off: the transport has no way to
 * carry the challenge flow, and `/messages` would bypass it.
 */
function registerLegacySseTransport(
  server: FastifyInstance,
  deps: McpServiceDeps,
  createServer: () => ReturnType<typeof createMcpServerInstance>,
): void {
  const sessions = new Map<string, SSEServerTransport>();
  const messagesPath = `${deps.location.basePath}/messages`;
  let warned = false;
  let capWarned = false;

  server.get(
    "/sse",
    { onRequest: createOriginCheck(deps.originPolicy) },
    async (request, reply) => {
      // Each stream holds an MCP server instance until the client leaves, so
      // cap them rather than let one client exhaust the process.
      if (sessions.size >= LEGACY_SSE_MAX_SESSIONS) {
        if (!capWarned) {
          capWarned = true;
          logger.warn(
            `⚠️  Refusing legacy SSE connections: ${LEGACY_SSE_MAX_SESSIONS} streams are already open.`,
          );
        }
        return reply
          .code(503)
          .header("Retry-After", "30")
          .send(jsonRpcError("Too many open SSE streams."));
      }
      if (!warned) {
        warned = true;
        logger.warn(
          `⚠️  A client connected over the deprecated HTTP+SSE transport (/sse). It will be removed in a future major release; connect clients to ${deps.location.url}${MCP_ENDPOINT_PATH} instead.`,
        );
      }

      reply.hijack();
      const res = reply.raw;
      res.setHeader("X-Accel-Buffering", "no");
      const transport = new SSEServerTransport(messagesPath, res);
      const mcpServer = createServer();
      sessions.set(transport.sessionId, transport);

      const keepAlive = setInterval(() => {
        if (!res.writableEnded) {
          res.write(": keepalive\n\n");
        }
      }, deps.config.server.heartbeatMs);
      res.on("close", () => {
        clearInterval(keepAlive);
        sessions.delete(transport.sessionId);
        mcpServer.close().catch((error) => {
          logger.debug(`Closing legacy SSE session failed: ${error}`);
        });
      });

      try {
        await mcpServer.connect(transport);
        logger.debug(`Legacy SSE session opened: ${transport.sessionId} (${request.ip})`);
      } catch (error) {
        logger.error(`❌ Error opening legacy SSE stream: ${error}`);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
        }
        res.end();
      }
    },
  );

  server.route({
    method: ["POST", "OPTIONS"],
    url: "/messages",
    onRequest: createPreflightChecks(deps.originPolicy),
    handler: async (request, reply) => {
      const { sessionId } = request.query as { sessionId?: string };
      const transport = sessionId ? sessions.get(sessionId) : undefined;
      if (!transport) {
        return reply.code(404).send(jsonRpcError("Unknown session."));
      }
      reply.hijack();
      try {
        await transport.handlePostMessage(request.raw, reply.raw, request.body);
      } catch (error) {
        logger.error(`❌ Error in legacy SSE message endpoint: ${error}`);
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { "Content-Type": "application/json" });
          reply.raw.end(JSON.stringify(jsonRpcError("Internal server error.")));
        }
      }
    },
  });

  // Open streams never finish on their own, so end them before Fastify waits
  // for in-flight requests on shutdown.
  server.addHook("preClose", async () => {
    await Promise.all([...sessions.values()].map((transport) => transport.close()));
  });
}
