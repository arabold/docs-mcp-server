import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBusService } from "../events";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import { DocumentManagementClient } from "../store/DocumentManagementClient";
import { DocumentManagementService } from "../store/DocumentManagementService";
import { loadConfig } from "../utils/config";
import { createApiClient } from "./apiClient";
import type { SystemInfo } from "./systemInfo";
import { registerTrpcService } from "./trpcService";

describe("MCP statistics API", () => {
  let server: FastifyInstance;
  let service: DocumentManagementService;
  let remote: DocumentManagementClient;

  beforeEach(async () => {
    const config = loadConfig();
    config.app.storePath = ":memory:";
    config.app.embeddingModel = "";
    const bus = new EventBusService();
    service = new DocumentManagementService(bus, config);
    await service.initialize();
    server = Fastify();
    await registerTrpcService(server, {} as IPipeline, service, bus, {} as SystemInfo);
    const baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
    const { api } = createApiClient(`${baseUrl}/api`, { subscriptions: false });
    remote = new DocumentManagementClient(api);
  });

  afterEach(async () => {
    await server.close();
    await service.shutdown();
  });

  it("serves statistics to callers without credentials", async () => {
    // arrange
    await service.recordMcpToolCall({
      tool: "read_page",
      tokenComment: "Anonymous HTTP",
      target: "/guide",
      success: true,
      durationMs: 4,
    });

    // act
    const overview = await remote.getMcpStatsOverview({ caller: "Anonymous HTTP" });
    const recent = await remote.getMcpRecentCalls({ caller: "Anonymous HTTP" });

    // assert
    expect(overview.totalCalls).toBe(1);
    expect(recent).toMatchObject([{ tool: "read_page", target: "/guide" }]);
  });

  it("accepts tool statistics from a remote coordinator without a key", async () => {
    // arrange
    const call = {
      tool: "list_libraries",
      protocol: "stdio" as const,
      tokenComment: "Local stdio",
      success: true,
      durationMs: 4,
    };

    // act
    await remote.recordMcpToolCall(call);

    // assert
    expect(await service.getMcpRecentCalls()).toMatchObject([call]);
  });
});
