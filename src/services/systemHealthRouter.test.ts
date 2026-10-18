import { describe, expect, it, vi } from "vitest";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { type SystemHealthTrpcContext, systemHealthRouter } from "./systemHealthRouter";
import type { SystemInfo } from "./systemInfo";

/** Baseline SystemInfo fixture; individual tests override only what they need. */
function baseSystemInfo(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return {
    version: "1.2.3",
    readOnly: false,
    telemetryEnabled: true,
    services: { web: true, mcp: true, api: true, worker: true },
    worker: { mode: "embedded", maxConcurrency: 3 },
    mcp: { enabled: true, endpoints: ["/mcp", "/sse"], url: "http://127.0.0.1:6280/mcp" },
    auth: { enabled: false },
    scraper: { maxPages: 1000, maxDepth: 3 },
    ...overrides,
  };
}

function buildContext(overrides: Partial<SystemHealthTrpcContext> = {}) {
  const docService: Partial<IDocumentManagement> = {
    getEmbeddingConfigInfo: vi.fn().mockResolvedValue(null),
  };

  return {
    systemInfo: baseSystemInfo(),
    docService: docService as IDocumentManagement,
    ...overrides,
  } satisfies SystemHealthTrpcContext;
}

describe("systemHealthRouter.getSystemHealth", () => {
  it("reports the startup snapshot, the embedded worker and the active embeddings", async () => {
    const systemInfo = baseSystemInfo({
      version: "9.9.9",
      readOnly: true,
      telemetryEnabled: false,
      services: { web: false, mcp: true, api: true, worker: true },
      mcp: {
        enabled: true,
        endpoints: ["/mcp", "/sse"],
        url: "http://127.0.0.1:6280/mcp",
      },
      auth: { enabled: true, issuer: "https://auth.example.com" },
      scraper: { maxPages: 250, maxDepth: 0 },
    });
    const ctx = buildContext({ systemInfo });
    vi.mocked(ctx.docService.getEmbeddingConfigInfo).mockResolvedValue({
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
    });
    const caller = systemHealthRouter.createCaller(ctx);

    const health = await caller.getSystemHealth();

    expect(health).toEqual({
      version: "9.9.9",
      readOnly: true,
      telemetryEnabled: false,
      services: { web: false, mcp: true, api: true, worker: true },
      // No url or connected fields for a worker in this process
      worker: { mode: "embedded", maxConcurrency: 3 },
      embeddings: {
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 1536,
      },
      mcp: {
        enabled: true,
        endpoints: ["/mcp", "/sse"],
        url: "http://127.0.0.1:6280/mcp",
      },
      auth: { enabled: true, issuer: "https://auth.example.com" },
      scraper: { maxPages: 250, maxDepth: 0 },
    });
  });

  it("still reports a remote worker as disconnected when it cannot be asked for its embeddings", async () => {
    const ctx = buildContext({
      systemInfo: baseSystemInfo({
        worker: { mode: "remote", url: "http://worker.example.com" },
      }),
      isWorkerConnected: vi.fn().mockReturnValue(false),
    });
    vi.mocked(ctx.docService.getEmbeddingConfigInfo).mockRejectedValue(
      new Error("fetch failed"),
    );
    const caller = systemHealthRouter.createCaller(ctx);

    const health = await caller.getSystemHealth();

    expect(health.worker).toMatchObject({ mode: "remote", connected: false });
    expect(health.embeddings).toBeNull();
  });
});
