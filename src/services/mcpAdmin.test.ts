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

const ADMIN_KEY = "test-operator-key-with-at-least-32-characters";

describe("MCP administrative API", () => {
  let server: FastifyInstance;
  let service: DocumentManagementService;
  let url: string;

  beforeEach(async () => {
    const config = loadConfig();
    config.app.storePath = ":memory:";
    config.app.embeddingModel = "";
    const bus = new EventBusService();
    service = new DocumentManagementService(bus, config);
    await service.initialize();
    server = Fastify();
    await registerTrpcService(
      server,
      {} as IPipeline,
      service,
      bus,
      {} as SystemInfo,
      undefined,
      ADMIN_KEY,
    );
    url = `${await server.listen({ host: "127.0.0.1", port: 0 })}/api`;
  });

  afterEach(async () => {
    await server.close();
    await service.shutdown();
  });

  it("does not disclose access tokens to anonymous clients", async () => {
    // arrange
    const { api } = createApiClient(url, { subscriptions: false });

    // act
    const request = api.listMcpTokens.query();

    // assert
    await expect(request).rejects.toMatchObject({ data: { httpStatus: 401 } });
  });

  it("does not grant administrative access to a friend's MCP token", async () => {
    // arrange
    const token = await service.createMcpToken("Alice");
    const { api } = createApiClient(url, {
      subscriptions: false,
      headers: () => ({ authorization: `Bearer ${token.token}` }),
    });

    // act
    const request = api.createMcpToken.mutate({ comment: "Intruder" });

    // assert
    await expect(request).rejects.toMatchObject({ data: { httpStatus: 401 } });
  });

  it("rejects forged usage records from anonymous clients", async () => {
    // arrange
    const { api } = createApiClient(url, { subscriptions: false });

    // act
    const request = api.recordMcpToolCall.mutate({
      tool: "fake",
      success: true,
      durationMs: 0,
    });

    // assert
    await expect(request).rejects.toMatchObject({ data: { httpStatus: 401 } });
  });

  it("protects usage statistics with the operator key", async () => {
    // arrange
    const { api } = createApiClient(url, { subscriptions: false });

    // act
    const request = api.getMcpStatsOverview.query();

    // assert
    await expect(request).rejects.toMatchObject({ data: { httpStatus: 401 } });
  });

  it("fails closed when no operator key is configured", async () => {
    // arrange
    const unconfigured = Fastify();
    await registerTrpcService(
      unconfigured,
      {} as IPipeline,
      service,
      new EventBusService(),
      {} as SystemInfo,
    );
    try {
      // act
      const response = await unconfigured.inject({
        method: "GET",
        url: "/api/listMcpTokens",
      });

      // assert
      expect(response.statusCode).toBe(403);
    } finally {
      await unconfigured.close();
    }
  });

  it("supports authenticated coordinator operations over the remote document client", async () => {
    // arrange
    const { api } = createApiClient(url, {
      subscriptions: false,
      headers: () => ({ authorization: `Bearer ${ADMIN_KEY}` }),
    });
    const remote = new DocumentManagementClient(api);
    const token = await remote.createMcpToken("Alice");

    // act
    const validated = await remote.validateMcpToken(token.token);
    await remote.recordMcpToolCall({
      tokenId: token.id,
      tokenComment: token.comment,
      tool: "read_page",
      target: "/guide",
      success: true,
      durationMs: 4,
    });

    // assert
    expect(validated?.id).toBe(token.id);
    expect((await remote.getMcpStatsOverview()).totalCalls).toBe(1);
  });
});
