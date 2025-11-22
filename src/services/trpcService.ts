/**
 * Fastify service to register unified tRPC API at /api.
 * Merges pipeline, data store, and events routers under a single endpoint.
 * Also provides WebSocket support for subscriptions.
 */

import { initTRPC } from "@trpc/server";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import type { FastifyInstance } from "fastify";
import superjson from "superjson";
import type { WebSocketServer } from "ws";
import type { EventBusService } from "../events";
import { createEventsRouter, type EventsTrpcContext } from "../events/trpc/router";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import { createPipelineRouter, type PipelineTrpcContext } from "../pipeline/trpc/router";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { createDataRouter, type DataTrpcContext } from "../store/trpc/router";

type UnifiedContext = PipelineTrpcContext & DataTrpcContext & EventsTrpcContext;

export async function registerTrpcService(
  server: FastifyInstance,
  pipeline: IPipeline,
  docService: IDocumentManagement,
  eventBus: EventBusService,
): Promise<void> {
  const t = initTRPC.context<UnifiedContext>().create({
    transformer: superjson,
  });

  // Define a single root-level health check to avoid duplicate keys from feature routers
  const healthRouter = t.router({
    ping: t.procedure.query(async () => ({ status: "ok", ts: Date.now() })),
  });

  const router = t.router({
    ...healthRouter._def.procedures,
    ...createPipelineRouter(t)._def.procedures,
    ...createDataRouter(t)._def.procedures,
    events: createEventsRouter(t),
  });

  await server.register(fastifyTRPCPlugin, {
    prefix: "/api",
    trpcOptions: {
      router,
      createContext: async (): Promise<UnifiedContext> => ({
        pipeline,
        docService,
        eventBus,
      }),
    },
  });
}

/**
 * Apply WebSocket handler to a WebSocketServer for tRPC subscriptions.
 */
export function applyTrpcWebSocketHandler(
  wss: WebSocketServer,
  pipeline: IPipeline,
  docService: IDocumentManagement,
  eventBus: EventBusService,
) {
  const t = initTRPC.context<UnifiedContext>().create({
    transformer: superjson,
  });

  const healthRouter = t.router({
    ping: t.procedure.query(async () => ({ status: "ok", ts: Date.now() })),
  });

  const router = t.router({
    ...healthRouter._def.procedures,
    ...createPipelineRouter(t)._def.procedures,
    ...createDataRouter(t)._def.procedures,
    events: createEventsRouter(t),
  });

  const handler = applyWSSHandler({
    wss,
    router,
    createContext: (): UnifiedContext => ({
      pipeline,
      docService,
      eventBus,
    }),
  });

  return handler;
}
