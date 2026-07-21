/**
 * tRPC router exposing a single `getSystemHealth` query that composes the
 * server's startup {@link SystemInfo} snapshot with the small amount of
 * cheaply-available live state (active embedding config, remote worker
 * connectivity). Powers the dashboard's system-health panel, sidebar status
 * footer, and Settings screen.
 */
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { SystemInfo } from "./systemInfo";

/**
 * Context required by the system-health router: the startup snapshot, the
 * document service (for the active embedding config), and an optional cheap
 * connectivity check — only meaningful (and only ever provided) when the
 * worker is remote.
 */
export interface SystemHealthTrpcContext {
  systemInfo: SystemInfo;
  docService: IDocumentManagement;
  /** Cheap, synchronous check for whether the remote worker is currently connected. */
  isWorkerConnected?: () => boolean;
}

const t = initTRPC.context<SystemHealthTrpcContext>().create({
  transformer: superjson,
});

/** Worker wiring as reported by `getSystemHealth`. */
export type SystemHealthWorker =
  | { mode: "embedded"; maxConcurrency: number }
  | { mode: "remote"; url: string; connected: boolean };

/** Active embedding configuration, or `null` when running in full-text-search-only mode. */
export interface SystemHealthEmbeddings {
  provider: string;
  model: string;
  /** `null` when the model's vector dimension isn't known (never fabricated). */
  dimensions: number | null;
}

/** Shape returned by the `getSystemHealth` query. */
export interface SystemHealth {
  version: string;
  readOnly: boolean;
  telemetryEnabled: boolean;
  services: SystemInfo["services"];
  worker: SystemHealthWorker;
  embeddings: SystemHealthEmbeddings | null;
  mcp: SystemInfo["mcp"];
  auth: SystemInfo["auth"];
}

/**
 * Factory to create the system-health router from any `t` instance whose
 * context satisfies {@link SystemHealthTrpcContext}.
 */
export function createSystemHealthRouter(trpc: unknown) {
  const tt = trpc as typeof t;

  return tt.router({
    /**
     * Returns an honest snapshot of the running server's configuration:
     * which services were started, how the worker is wired, the active
     * embedding provider (if any), MCP/auth exposure, and app version.
     * Derived from startup config, not measured — nothing here is fabricated.
     */
    getSystemHealth: tt.procedure.query(
      ({ ctx }: { ctx: SystemHealthTrpcContext }): SystemHealth => {
        const { systemInfo } = ctx;

        const worker: SystemHealthWorker =
          systemInfo.worker.mode === "remote"
            ? {
                mode: "remote",
                url: systemInfo.worker.url,
                connected: ctx.isWorkerConnected?.() ?? false,
              }
            : { mode: "embedded", maxConcurrency: systemInfo.worker.maxConcurrency };

        const embeddingConfig = ctx.docService.getActiveEmbeddingConfig();
        const embeddings: SystemHealthEmbeddings | null = embeddingConfig
          ? {
              provider: embeddingConfig.provider,
              model: embeddingConfig.model,
              dimensions: embeddingConfig.dimensions,
            }
          : null;

        return {
          version: systemInfo.version,
          readOnly: systemInfo.readOnly,
          telemetryEnabled: systemInfo.telemetryEnabled,
          services: systemInfo.services,
          worker,
          embeddings,
          mcp: systemInfo.mcp,
          auth: systemInfo.auth,
        };
      },
    ),
  });
}

// Default router for standalone usage
export const systemHealthRouter = createSystemHealthRouter(t);
export type SystemHealthRouter = typeof systemHealthRouter;
