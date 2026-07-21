/**
 * Canonical tRPC router builder for the merged application API.
 * Combines the health check, pipeline, data store, and events routers into a
 * single router shape. Both the Fastify HTTP mount point and the WebSocket
 * subscription handler in {@link ./trpcService} import from this module so the
 * two transports always expose identical procedures and typing.
 */

import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { EventBusService } from "../events";
import { createEventsRouter, type EventsTrpcContext } from "../events/trpc/router";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import { createPipelineRouter, type PipelineTrpcContext } from "../pipeline/trpc/router";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { createDataRouter, type DataTrpcContext } from "../store/trpc/router";
import {
  createSystemHealthRouter,
  type SystemHealthTrpcContext,
} from "./systemHealthRouter";
import type { SystemInfo } from "./systemInfo";

/**
 * Combined tRPC context required by the merged application router.
 * Satisfied by the unified server (pipeline + document store + event bus all
 * available in a single process) as well as any future adapter that can supply
 * the same dependencies.
 */
export type AppRouterContext = PipelineTrpcContext &
  DataTrpcContext &
  EventsTrpcContext &
  SystemHealthTrpcContext;

/** Shape of the values a caller must provide to create a request context. */
export interface AppRouterContextDeps {
  pipeline: IPipeline;
  docService: IDocumentManagement;
  eventBus: EventBusService;
  /** Distilled, serializable snapshot of the server's startup configuration. */
  systemInfo: SystemInfo;
  /** Cheap, synchronous check for remote worker connectivity (remote worker mode only). */
  isWorkerConnected?: () => boolean;
}

const t = initTRPC.context<AppRouterContext>().create({
  transformer: superjson,
});

/**
 * Builds the merged application tRPC router (health + pipeline + data + events).
 * Kept as a factory (rather than only exporting a singleton) so future
 * transports can construct a fresh router instance if ever needed, while the
 * `appRouter` singleton below remains the single instance shared by the
 * current HTTP and WebSocket mount points.
 * @returns The merged tRPC router.
 */
export function buildAppRouter() {
  // Define a single root-level health check to avoid duplicate keys from feature routers
  const healthRouter = t.router({
    ping: t.procedure.query(async () => ({ status: "ok", ts: Date.now() })),
  });

  return t.router({
    ...healthRouter._def.procedures,
    ...createPipelineRouter(t)._def.procedures,
    ...createDataRouter(t)._def.procedures,
    ...createSystemHealthRouter(t)._def.procedures,
    events: createEventsRouter(t),
  });
}

/** The canonical merged application router instance, shared by all transports. */
export const appRouter = buildAppRouter();

/** Type of the merged application router, used for end-to-end client typing. */
export type AppRouter = typeof appRouter;

/**
 * Creates the request context shared by both the HTTP and WebSocket transports.
 * @param deps - The pipeline, document store, event bus, and system info backing this request.
 * @returns The context object passed to every procedure resolver.
 */
export function createAppRouterContext(deps: AppRouterContextDeps): AppRouterContext {
  return {
    pipeline: deps.pipeline,
    docService: deps.docService,
    eventBus: deps.eventBus,
    systemInfo: deps.systemInfo,
    isWorkerConnected: deps.isWorkerConnected,
  };
}
