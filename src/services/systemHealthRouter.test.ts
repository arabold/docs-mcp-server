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
    mcp: { enabled: true, endpoints: ["/mcp", "/sse"] },
    auth: { enabled: false },
    ...overrides,
  };
}

function buildContext(overrides: Partial<SystemHealthTrpcContext> = {}) {
  const docService: Partial<IDocumentManagement> = {
    getActiveEmbeddingConfig: vi.fn().mockReturnValue(null),
  };

  return {
    systemInfo: baseSystemInfo(),
    docService: docService as IDocumentManagement,
    ...overrides,
  } satisfies SystemHealthTrpcContext;
}

describe("systemHealthRouter.getSystemHealth", () => {
  it("returns embedded worker mode without url/connected fields", async () => {
    const ctx = buildContext({
      systemInfo: baseSystemInfo({ worker: { mode: "embedded", maxConcurrency: 3 } }),
    });
    const caller = systemHealthRouter.createCaller(ctx);

    const health = await caller.getSystemHealth();

    expect(health.worker).toEqual({ mode: "embedded", maxConcurrency: 3 });
    expect(health.worker).not.toHaveProperty("url");
    expect(health.worker).not.toHaveProperty("connected");
  });

  it("returns remote worker mode with url and connected populated from the connectivity check", async () => {
    const ctx = buildContext({
      systemInfo: baseSystemInfo({
        worker: { mode: "remote", url: "http://worker.example.com" },
      }),
      isWorkerConnected: vi.fn().mockReturnValue(true),
    });
    const caller = systemHealthRouter.createCaller(ctx);

    const health = await caller.getSystemHealth();

    expect(health.worker).toEqual({
      mode: "remote",
      url: "http://worker.example.com",
      connected: true,
    });
  });

  it("reports connected: false for a remote worker that hasn't connected yet", async () => {
    const ctx = buildContext({
      systemInfo: baseSystemInfo({
        worker: { mode: "remote", url: "http://worker.example.com" },
      }),
      isWorkerConnected: vi.fn().mockReturnValue(false),
    });
    const caller = systemHealthRouter.createCaller(ctx);

    const health = await caller.getSystemHealth();

    expect(health.worker).toEqual({
      mode: "remote",
      url: "http://worker.example.com",
      connected: false,
    });
  });

  it("returns embeddings: null when running in full-text-search-only mode", async () => {
    const ctx = buildContext();
    const caller = systemHealthRouter.createCaller(ctx);

    const health = await caller.getSystemHealth();

    expect(health.embeddings).toBeNull();
  });

  it("returns the active embedding provider/model/dimensions when embeddings are configured", async () => {
    const ctx = buildContext();
    (ctx.docService.getActiveEmbeddingConfig as ReturnType<typeof vi.fn>).mockReturnValue(
      {
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 1536,
        modelSpec: "openai:text-embedding-3-small",
      },
    );
    const caller = systemHealthRouter.createCaller(ctx);

    const health = await caller.getSystemHealth();

    expect(health.embeddings).toEqual({
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
    });
  });

  it("does not fabricate dimensions for a model with unknown vector size", async () => {
    const ctx = buildContext();
    (ctx.docService.getActiveEmbeddingConfig as ReturnType<typeof vi.fn>).mockReturnValue(
      {
        provider: "openai",
        model: "some-custom-model",
        dimensions: null,
        modelSpec: "openai:some-custom-model",
      },
    );
    const caller = systemHealthRouter.createCaller(ctx);

    const health = await caller.getSystemHealth();

    expect(health.embeddings).toEqual({
      provider: "openai",
      model: "some-custom-model",
      dimensions: null,
    });
  });

  it("passes through version, readOnly, telemetryEnabled, services, mcp, and auth unchanged", async () => {
    const systemInfo = baseSystemInfo({
      version: "9.9.9",
      readOnly: true,
      telemetryEnabled: false,
      services: { web: false, mcp: true, api: true, worker: false },
      mcp: { enabled: true, endpoints: ["/mcp", "/sse"] },
      auth: { enabled: true, issuer: "https://auth.example.com" },
    });
    const ctx = buildContext({ systemInfo });
    const caller = systemHealthRouter.createCaller(ctx);

    const health = await caller.getSystemHealth();

    expect(health.version).toBe("9.9.9");
    expect(health.readOnly).toBe(true);
    expect(health.telemetryEnabled).toBe(false);
    expect(health.services).toEqual({ web: false, mcp: true, api: true, worker: false });
    expect(health.mcp).toEqual({ enabled: true, endpoints: ["/mcp", "/sse"] });
    expect(health.auth).toEqual({ enabled: true, issuer: "https://auth.example.com" });
  });
});
