/**
 * Fastify service to register unified tRPC API at /api.
 * Merges pipeline, data store, and events routers under a single endpoint.
 * Also provides WebSocket support for subscriptions.
 * Both mount points delegate to the single canonical router built in
 * {@link ../services/appRouter}, keeping HTTP and WebSocket behavior identical.
 */

import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import type { FastifyInstance } from "fastify";
import type { WebSocketServer } from "ws";
import type { EventBusService } from "../events";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { appRouter, createAppRouterContext } from "./appRouter";
import type { SystemInfo } from "./systemInfo";

/**
 * Registers the merged tRPC router on a Fastify instance under the `/api` prefix.
 * @param server - The Fastify instance to register the plugin on.
 * @param pipeline - The pipeline instance backing pipeline procedures.
 * @param docService - The document management service backing data procedures.
 * @param eventBus - The event bus backing the events subscription router.
 * @param systemInfo - Distilled, serializable snapshot of the server's startup configuration.
 * @param isWorkerConnected - Cheap connectivity check, provided only when the worker is remote.
 */
export async function registerTrpcService(
  server: FastifyInstance,
  pipeline: IPipeline,
  docService: IDocumentManagement,
  eventBus: EventBusService,
  systemInfo: SystemInfo,
  isWorkerConnected?: () => boolean,
): Promise<void> {
  await server.register(fastifyTRPCPlugin, {
    prefix: "/api",
    trpcOptions: {
      router: appRouter,
      createContext: async () =>
        createAppRouterContext({
          pipeline,
          docService,
          eventBus,
          systemInfo,
          isWorkerConnected,
        }),
    },
  });
}

/**
 * Applies the tRPC WebSocket handler to a WebSocketServer for subscriptions.
 * @param wss - The WebSocket server to attach the tRPC handler to.
 * @param pipeline - The pipeline instance backing pipeline procedures.
 * @param docService - The document management service backing data procedures.
 * @param eventBus - The event bus backing the events subscription router.
 * @param systemInfo - Distilled, serializable snapshot of the server's startup configuration.
 * @param isWorkerConnected - Cheap connectivity check, provided only when the worker is remote.
 * @returns The tRPC WebSocket handler returned by `applyWSSHandler`.
 */
export function applyTrpcWebSocketHandler(
  wss: WebSocketServer,
  pipeline: IPipeline,
  docService: IDocumentManagement,
  eventBus: EventBusService,
  systemInfo: SystemInfo,
  isWorkerConnected?: () => boolean,
) {
  return applyWSSHandler({
    wss,
    router: appRouter,
    createContext: () =>
      createAppRouterContext({
        pipeline,
        docService,
        eventBus,
        systemInfo,
        isWorkerConnected,
      }),
  });
}
