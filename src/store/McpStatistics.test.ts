import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBusService } from "../events";
import { loadConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { DocumentManagementService } from "./DocumentManagementService";
import { pruneMcpCalls, readMcpOverview, readMcpRecent } from "./McpStatistics";

function migration(name: string): string {
  return readFileSync(new URL(`../../db/migrations/${name}`, import.meta.url), "utf8");
}

describe("MCP tokens and compact statistics", () => {
  let service: DocumentManagementService;

  beforeEach(async () => {
    vi.spyOn(logger, "info");
    const config = loadConfig();
    config.app.storePath = ":memory:";
    config.app.embeddingModel = "";
    service = new DocumentManagementService(new EventBusService(), config);
    await service.initialize();
  });

  afterEach(async () => {
    await service.shutdown();
    vi.restoreAllMocks();
  });

  it("does not write the initial client token to the log", async () => {
    // arrange
    const [token] = await service.listMcpTokens();

    // act
    const log = vi
      .mocked(logger.info)
      .mock.calls.map(([message]) => message)
      .join("\n");

    // assert
    expect(log).not.toContain(token.token);
  });

  it("creates a token that authenticates its caller", async () => {
    // arrange
    const token = await service.createMcpToken("Alice");

    // act
    const authenticated = await service.validateMcpToken(token.token);

    // assert
    expect(authenticated?.id).toBe(token.id);
    expect(authenticated?.comment).toBe("Alice");
  });

  it("rejects a revoked token", async () => {
    // arrange
    const token = await service.createMcpToken("Alice");
    await service.deleteMcpToken(token.id);

    // act
    const authenticated = await service.validateMcpToken(token.token);

    // assert
    expect(authenticated).toBeNull();
  });

  it("keeps historical totals when recent metadata is pruned", async () => {
    // arrange
    for (let i = 0; i < 15; i++) {
      await service.recordMcpToolCall({
        tool: "search_docs",
        library: "react",
        success: i !== 0,
        durationMs: 10,
      });
    }

    // act
    await service.pruneOldMcpStats(30, 5);

    // assert
    expect(await service.getMcpRecentCalls()).toHaveLength(5);
    const overview = await service.getMcpStatsOverview();
    expect(overview.totalCalls).toBe(15);
    expect(overview.failedCalls).toBe(1);
    expect(overview.activityHistory.reduce((sum, day) => sum + day.calls, 0)).toBe(15);
  });

  it("filters the chart and breakdowns by the same caller, tool and library", async () => {
    // arrange
    const alice = await service.createMcpToken("Alice");
    await service.recordMcpToolCall({
      tokenId: alice.id,
      tokenComment: "Alice",
      tool: "search_docs",
      library: "react",
      success: true,
      durationMs: 20,
    });
    await service.recordMcpToolCall({
      tool: "search_docs",
      library: "react",
      success: false,
      durationMs: 100,
    });
    await service.recordMcpToolCall({
      tokenId: alice.id,
      tokenComment: "Alice",
      tool: "read_page",
      library: "vue",
      success: false,
      durationMs: 90,
    });

    // act
    const overview = await service.getMcpStatsOverview({
      days: 1,
      tokenId: alice.id,
      tool: "search_docs",
      library: "react",
    });

    // assert
    expect(overview.totalCalls).toBe(1);
    expect(overview.activityHistory).toEqual([
      { date: new Date().toISOString().slice(0, 10), calls: 1, errors: 0 },
    ]);
    expect(overview.byTool.map((row) => row.tool)).toEqual(["search_docs"]);
    expect(overview.byLibrary.map((row) => row.library)).toEqual(["react"]);
    expect(overview.avgDurationMs).toBe(20);
  });

  it("retains caller attribution after a token is revoked", async () => {
    // arrange
    const alice = await service.createMcpToken("Alice");
    await service.recordMcpToolCall({
      tokenId: alice.id,
      tokenComment: "Alice",
      tool: "read_page",
      success: true,
      durationMs: 1,
    });
    await service.deleteMcpToken(alice.id);

    // act
    const overview = await service.getMcpStatsOverview({ tokenId: alice.id });

    // assert
    expect(overview.byToken[0]).toMatchObject({
      tokenId: alice.id,
      comment: "Alice",
      count: 1,
    });
  });

  it("discards payloads and URL credentials while retaining the document target", async () => {
    // arrange
    const call = {
      tool: "read_page",
      library: "react",
      version: "19",
      success: true,
      durationMs: 3,
      target: "https://user:password@example.com/guide?token=SECRET#SECRET",
      query: "SECRET".repeat(100000),
      detail: "SECRET",
      errorMessage: "SECRET",
      response: "SECRET",
    };

    // act
    await service.recordMcpToolCall(call);
    const [recent] = await service.getMcpRecentCalls();

    // assert
    expect(recent).toMatchObject({ target: "https://example.com/guide", version: "19" });
    expect(recent).not.toHaveProperty("query");
    expect(recent).not.toHaveProperty("errorMessage");
    expect(JSON.stringify(recent)).not.toContain("SECRET");
    expect(recent.createdAt).toMatch(/Z$/);
  });
});

describe("MCP statistics migration", () => {
  it("preserves old daily counters and removes payload columns", () => {
    // arrange
    const db = new Database(":memory:");
    try {
      db.exec(migration("020-add-mcp-tokens-and-stats.sql"));
      db.prepare(`INSERT INTO mcp_stats(tool, library, query, detail, error_message, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        "search_docs",
        "react",
        "SECRET".repeat(1000),
        "SECRET",
        "SECRET",
        40,
        "2020-01-01 12:00:00",
      );

      // act
      db.exec(migration("021-compact-mcp-statistics.sql"));
      pruneMcpCalls(db);
      const overview = readMcpOverview(db);
      const recent = readMcpRecent(db);

      // assert
      expect(overview.totalCalls).toBe(1);
      expect(overview.activityHistory[0]).toEqual({
        date: "2020-01-01",
        calls: 1,
        errors: 0,
      });
      expect(recent).toEqual([]);
      const columns = db.prepare("PRAGMA table_info(mcp_stats)").all() as {
        name: string;
      }[];
      for (const removed of ["query", "detail", "error_message"]) {
        expect(columns.map((column) => column.name)).not.toContain(removed);
      }
    } finally {
      db.close();
    }
  });
});
