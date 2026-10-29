import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBusService } from "../src/events";
import { DocumentManagementService } from "../src/store/DocumentManagementService";
import type { AppConfig } from "../src/utils/config";
import { loadConfig } from "../src/utils/config";

describe("MCP Access Tokens and Stats", () => {
  let appConfig: AppConfig;
  let docService: DocumentManagementService;

  beforeEach(async () => {
    appConfig = loadConfig();
    appConfig.app.storePath = ":memory:";
    appConfig.app.embeddingModel = ""; // FTS-only: no external credentials required
    docService = new DocumentManagementService(new EventBusService(), appConfig);
    await docService.initialize();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await docService.shutdown();
  });

  it("initializes with a default admin token", async () => {
    const tokens = await docService.listMcpTokens();
    expect(tokens.length).toBe(1);
    expect(tokens[0].comment).toContain("Default Admin Token");
    expect(tokens[0].token.startsWith("dmcp_")).toBe(true);

    const valid = await docService.validateMcpToken(tokens[0].token);
    expect(valid).not.toBeNull();
    expect(valid?.comment).toBe(tokens[0].comment);
  });

  it("creates, validates, and touches tokens", async () => {
    const created = await docService.createMcpToken(
      "Friend Alice",
      "mcp_alice_secret_token_123",
    );

    expect(created.token).toBe("mcp_alice_secret_token_123");
    expect(created.comment).toBe("Friend Alice");

    const validated = await docService.validateMcpToken("mcp_alice_secret_token_123");
    expect(validated).not.toBeNull();
    expect(validated?.id).toBe(created.id);
    expect(validated?.comment).toBe("Friend Alice");

    // Touch token
    await docService.touchMcpToken(created.id);
    const updated = (await docService.listMcpTokens()).find((t) => t.id === created.id);
    expect(updated?.lastUsedAt).not.toBeNull();
  });

  it("fails to delete the last remaining token", async () => {
    const tokens = await docService.listMcpTokens();
    expect(tokens.length).toBe(1);

    await expect(docService.deleteMcpToken(tokens[0].id)).rejects.toThrow(
      "Cannot delete the last remaining MCP access token",
    );
  });

  it("deletes a token when multiple exist", async () => {
    const tokenB = await docService.createMcpToken("Bob");
    const all = await docService.listMcpTokens();
    expect(all.length).toBe(2);

    await docService.deleteMcpToken(tokenB.id);
    const afterDelete = await docService.listMcpTokens();
    expect(afterDelete.length).toBe(1);
    expect(afterDelete.some((t) => t.id === tokenB.id)).toBe(false);
  });

  it("records tool calls and computes statistics overview and recent calls", async () => {
    const tokens = await docService.listMcpTokens();
    const adminToken = tokens[0];

    const friendToken = await docService.createMcpToken("Alice");

    // Record some calls
    await docService.recordMcpToolCall({
      tokenId: adminToken.id,
      tokenComment: adminToken.comment,
      tool: "search_docs",
      library: "react",
      query: "useEffect cleanup",
      durationMs: 45,
      success: true,
    });

    await docService.recordMcpToolCall({
      tokenId: friendToken.id,
      tokenComment: friendToken.comment,
      tool: "read_page",
      library: "react",
      query: "react/hooks.md",
      durationMs: 12,
      success: true,
    });

    await docService.recordMcpToolCall({
      tokenId: friendToken.id,
      tokenComment: friendToken.comment,
      tool: "scrape_docs",
      library: "vue",
      query: "https://vuejs.org",
      durationMs: 120,
      success: false,
      errorMessage: "Connection timeout",
    });

    // Check stats overview
    const overview = await docService.getMcpStatsOverview();
    expect(overview.totalCalls).toBe(3);
    expect(overview.successCalls).toBe(2);
    expect(overview.failedCalls).toBe(1);
    expect(overview.activeTokensCount).toBe(2);

    // Tools breakdown
    expect(overview.byTool.length).toBe(3);
    const searchDocs = overview.byTool.find((t) => t.tool === "search_docs");
    expect(searchDocs?.count).toBe(1);
    expect(searchDocs?.successRate).toBe(100);

    // Callers breakdown
    expect(overview.byToken.length).toBe(2);
    const aliceCaller = overview.byToken.find((c) => c.comment === "Alice");
    expect(aliceCaller?.count).toBe(2);

    // Top libraries
    expect(overview.byLibrary.length).toBeGreaterThan(0);
    const reactLib = overview.byLibrary.find((l) => l.library === "react");
    expect(reactLib?.count).toBe(2);
    expect(reactLib?.topQueries.length).toBeGreaterThan(0);

    // Recent calls
    const recent = await docService.getMcpRecentCalls({ limit: 10 });
    expect(recent.length).toBe(3);
    expect(recent[0].tool).toBe("scrape_docs");
    expect(recent[0].success).toBe(false);
    expect(recent[0].errorMessage).toBe("Connection timeout");

    // Filter recent calls by tool
    const searchCalls = await docService.getMcpRecentCalls({ tool: "search_docs" });
    expect(searchCalls.length).toBe(1);
    expect(searchCalls[0].query).toBe("useEffect cleanup");
  });
});
