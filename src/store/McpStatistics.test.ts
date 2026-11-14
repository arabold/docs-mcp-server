import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBusService } from "../events";
import { loadConfig } from "../utils/config";
import { DocumentManagementService } from "./DocumentManagementService";
import { pruneMcpCalls, readMcpOverview, readMcpRecent } from "./McpStatistics";
import { openDatabase } from "./openDatabase";

function migration(name: string): string {
  return readFileSync(new URL(`../../db/migrations/${name}`, import.meta.url), "utf8");
}

describe("Compact MCP statistics", () => {
  let service: DocumentManagementService;

  beforeEach(async () => {
    const config = loadConfig();
    config.app.storePath = ":memory:";
    config.app.embeddingModel = "";
    service = new DocumentManagementService(new EventBusService(), config);
    await service.initialize();
  });

  afterEach(async () => {
    await service.shutdown();
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
    expect(overview.byTool[0]).toMatchObject({ successCalls: 14, failedCalls: 1 });
    expect(overview.activityHistory.reduce((sum, day) => sum + day.calls, 0)).toBe(15);
  });

  it("filters the chart and breakdowns by the same caller, tool and library", async () => {
    // arrange
    await service.recordMcpToolCall({
      tokenComment: "Anonymous SSE",
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
      tokenComment: "Anonymous SSE",
      tool: "read_page",
      library: "vue",
      success: false,
      durationMs: 90,
    });

    // act
    const overview = await service.getMcpStatsOverview({
      days: 1,
      caller: "Anonymous SSE",
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
  it("preserves historical caller statistics when removing legacy credentials", () => {
    // arrange
    const db = openDatabase(":memory:");
    try {
      db.pragma("foreign_keys = ON");
      db.exec(migration("020-add-mcp-tokens-and-stats.sql"));
      db.exec(
        "INSERT INTO mcp_tokens (id, token, comment) VALUES (1, 'legacy-secret', 'Alice')",
      );
      db.prepare(`INSERT INTO mcp_stats(token_id, token_comment, tool, library, query, detail, error_message, duration_ms, created_at)
        VALUES (1, 'Alice', ?, ?, ?, ?, ?, ?, ?)`).run(
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
      db.exec(migration("022-drop-mcp-access-tokens.sql"));
      pruneMcpCalls(db);
      const overview = readMcpOverview(db);
      const recent = readMcpRecent(db);

      // assert
      expect(overview.totalCalls).toBe(1);
      expect(overview.byToken[0]).toMatchObject({ tokenId: 1, comment: "Alice", count: 1 });
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'mcp_tokens'").get(),
      ).toBeUndefined();
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
