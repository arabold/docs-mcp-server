import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOriginPolicy } from "../app/originPolicy";
import { EventBusService } from "../events";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import { DocumentManagementClient } from "../store/DocumentManagementClient";
import { DocumentManagementService } from "../store/DocumentManagementService";
import { loadConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { createApiClient } from "./apiClient";
import { registerMcpService } from "./mcpService";
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
    const pipeline = {} as IPipeline;
    await registerTrpcService(server, pipeline, service, bus, {} as SystemInfo);
    await registerMcpService(server, {
      docService: service,
      pipeline,
      config,
      originPolicy: createOriginPolicy({ allowedOrigins: [] }),
      location: {
        configured: false,
        url: "http://localhost",
        origin: "http://localhost",
        basePath: "",
      },
    });
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
      tool: "fetch_url",
      protocol: "stdio" as const,
      tokenComment: "Local stdio",
      success: false,
      failureReason: "HTTP 404",
      durationMs: 4,
    };

    // act
    await remote.recordMcpToolCall(call);

    // assert
    expect(await service.getMcpRecentCalls()).toMatchObject([call]);
  });

  function callTool(
    headers: Record<string, string> = {},
    name = "list_libraries",
    args: Record<string, unknown> = {},
  ) {
    return server.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": name,
        ...headers,
      },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name,
          arguments: args,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      },
    });
  }

  it("reports the reason for a search of a missing library in recent calls", async () => {
    // arrange
    const args = { library: "missing-library", query: "Private search query" };

    // act
    const response = await callTool({}, "search_docs", args);
    const calls = await remote.getMcpRecentCalls();

    // assert
    expect(response.json()).toMatchObject({ result: { isError: true } });
    expect(calls).toMatchObject([
      { tool: "search_docs", success: false, failureReason: "Library not indexed" },
    ]);
    expect(JSON.stringify(calls)).not.toContain(args.query);
  });

  it("logs a failure reason without the search arguments", async () => {
    // arrange
    const args = { library: "private-library-name", query: "Private search query" };
    const logError = vi.spyOn(logger, "error");
    try {
      // act
      await callTool({}, "search_docs", args);

      // assert
      expect(logError).toHaveBeenCalledWith(
        expect.stringMatching(
          /^❌ MCP tool search_docs failed \(\d+ms\): Library not indexed$/,
        ),
      );
      expect(JSON.stringify(logError.mock.calls)).not.toContain(args.query);
      expect(JSON.stringify(logError.mock.calls)).not.toContain(args.library);
    } finally {
      logError.mockRestore();
    }
  });

  it("returns a safe reason with a remote store error", async () => {
    // arrange
    const library = "missing-library";

    // act
    const result = remote.resolveDocumentation(library);

    // assert
    await expect(result).rejects.toMatchObject({
      data: { mcpFailureReason: "Library not indexed" },
    });
  });

  it("attributes open MCP calls to the registered application", async () => {
    // arrange
    const cursor = await remote.createMcpAppToken("Cursor", "cursor-token-".repeat(4));
    const ide = await remote.createMcpAppToken("IDE");
    if (!cursor || !ide) throw new Error("Expected application tokens to be issued.");

    // act
    const bearer = await callTool({ authorization: `Bearer ${cursor.token}` });
    const apiKey = await callTool({ "x-api-key": ide.token });
    const anonymous = await callTool();
    const calls = await remote.getMcpRecentCalls();
    const tokens = await remote.listMcpAppTokens();

    // assert
    for (const response of [bearer, apiKey, anonymous]) {
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("No libraries indexed yet.");
    }
    expect(calls).toMatchObject([
      { tokenId: null, tokenComment: "Anonymous HTTP" },
      { tokenId: ide.id, tokenComment: "IDE" },
      { tokenId: cursor.id, tokenComment: "Cursor" },
    ]);
    expect(tokens).toMatchObject([
      { name: "Cursor", lastUsedAt: expect.any(String) },
      { name: "IDE", lastUsedAt: expect.any(String) },
    ]);
    expect(JSON.stringify(tokens)).not.toContain(cursor.token);
    expect(JSON.stringify(tokens)).not.toContain(ide.token);
  });

  it("counts calls with a revoked token as anonymous and keeps the app history", async () => {
    // arrange
    const token = await remote.createMcpAppToken("Cursor");
    if (!token) throw new Error("Expected an application token to be issued.");
    const headers = { authorization: `Bearer ${token.token}` };
    await callTool(headers);
    await remote.deleteMcpAppToken(token.id);

    // act
    const response = await callTool(headers);
    const overview = await remote.getMcpStatsOverview();

    // assert
    expect(response.body).toContain("No libraries indexed yet.");
    expect(await remote.listMcpAppTokens()).toEqual([]);
    expect(overview.byToken).toMatchObject([
      { tokenId: null, comment: "Anonymous HTTP", count: 1 },
      { tokenId: token.id, comment: "Cursor", count: 1 },
    ]);
  });
});
