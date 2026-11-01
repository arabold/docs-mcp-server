import type { Database } from "better-sqlite3";
import { compactMcpCall } from "./mcpStats";
import type {
  McpRecentCallsOptions,
  McpStatsFilterOptions,
  McpStatsOverview,
  McpToolCallInput,
  McpToolCallRecord,
} from "./types";

function filters(options: McpStatsFilterOptions, daily: boolean) {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (options.days !== undefined) {
    conditions.push(
      `${daily ? "day" : "created_at"} >= date('now', '-' || ? || ' days')`,
    );
    params.push(Math.max(0, options.days - 1));
  }
  for (const [column, value] of [
    ["token_id", options.tokenId],
    ["tool", options.tool],
    ["library", options.library],
  ] as const) {
    if (value !== undefined && value !== "") {
      conditions.push(`${column} = ?`);
      params.push(value);
    }
  }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

function iso(value: string): string {
  return value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
}

/**
 * Writes compact recent calls and durable counters in a single transaction.
 * @param db - The open application database.
 * @param input - The tool invocation's metadata.
 * @returns Nothing after both statistics tables are updated.
 */
export function recordMcpCall(db: Database, input: McpToolCallInput): void {
  const call = compactMcpCall(input);
  const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  db.transaction(() => {
    db.prepare(`INSERT INTO mcp_stats
      (token_id, token_comment, tool, library, version, target, protocol, success, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      call.tokenId ?? null,
      call.tokenComment ?? null,
      call.tool,
      call.library ?? null,
      call.version ?? null,
      call.target ?? null,
      call.protocol ?? "http",
      call.success ? 1 : 0,
      call.durationMs,
      createdAt,
    );
    db.prepare(`INSERT INTO mcp_stats_daily
      (day, token_id, token_comment, tool, library, version, protocol, calls,
       success_calls, total_duration_ms, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(day, token_id, token_comment, tool, library, version, protocol) DO UPDATE SET
        calls = calls + 1,
        success_calls = success_calls + excluded.success_calls,
        total_duration_ms = total_duration_ms + excluded.total_duration_ms,
        last_used_at = excluded.last_used_at`).run(
      createdAt.slice(0, 10),
      call.tokenId ?? 0,
      call.tokenComment ?? "",
      call.tool,
      call.library ?? "",
      call.version ?? "",
      call.protocol ?? "http",
      call.success ? 1 : 0,
      call.durationMs,
      createdAt,
    );
  })();
}

/**
 * Removes recent invocation metadata while preserving daily history.
 * @param db - The open application database.
 * @param retentionDays - Number of days of recent calls to keep.
 * @param maxRows - Maximum number of recent calls to keep.
 * @returns Nothing after pruning the recent table.
 */
export function pruneMcpCalls(db: Database, retentionDays = 30, maxRows = 20000): void {
  db.transaction(() => {
    db.prepare(
      "DELETE FROM mcp_stats WHERE created_at < datetime('now', '-' || ? || ' days')",
    ).run(retentionDays);
    db.prepare(`DELETE FROM mcp_stats WHERE id IN (
      SELECT id FROM mcp_stats ORDER BY id DESC LIMIT -1 OFFSET ?
    )`).run(maxRows);
  })();
}

/**
 * Reads historical usage exclusively from daily counters with consistent filters.
 * @param db - The open application database.
 * @param options - UTC calendar period and caller, tool or library filters.
 * @returns Totals, breakdowns and the filtered daily activity series.
 */
export function readMcpOverview(
  db: Database,
  options: McpStatsFilterOptions = {},
): McpStatsOverview {
  const { where, params } = filters(options, true);
  const totals = db
    .prepare(`SELECT COALESCE(SUM(calls), 0) AS total,
    COALESCE(SUM(success_calls), 0) AS successes,
    COALESCE(SUM(total_duration_ms), 0) AS duration, MIN(day) AS firstDay
    FROM mcp_stats_daily ${where}`)
    .get(...params) as {
    total: number;
    successes: number;
    duration: number;
    firstDay: string | null;
  };
  const percent = (count: number) =>
    totals.total ? Math.round((count / totals.total) * 100) : 0;
  const byTool = (
    db
      .prepare(`SELECT tool, SUM(calls) AS count, SUM(success_calls) AS successes,
    ROUND(SUM(total_duration_ms) * 1.0 / SUM(calls), 1) AS avgDurationMs
    FROM mcp_stats_daily ${where} GROUP BY tool ORDER BY count DESC, tool`)
      .all(...params) as Array<{
      tool: string;
      count: number;
      successes: number;
      avgDurationMs: number;
    }>
  ).map(({ successes, ...row }) => ({
    ...row,
    percentage: percent(row.count),
    successRate: Math.round((successes / row.count) * 100),
  }));
  const byToken = (
    db
      .prepare(`SELECT token_id AS tokenId,
    COALESCE(NULLIF(token_comment, ''), 'Anonymous') AS comment,
    SUM(calls) AS count, MAX(last_used_at) AS lastUsedAt
    FROM mcp_stats_daily ${where} GROUP BY token_id, token_comment
    ORDER BY count DESC, token_id, token_comment`)
      .all(...params) as Array<{
      tokenId: number;
      comment: string;
      count: number;
      lastUsedAt: string;
    }>
  ).map((row) => ({
    ...row,
    tokenId: row.tokenId || null,
    percentage: percent(row.count),
    lastUsedAt: iso(row.lastUsedAt),
  }));
  const byLibrary = (
    db
      .prepare(`SELECT library, SUM(calls) AS count FROM mcp_stats_daily
    ${where ? `${where} AND` : "WHERE"} library != '' GROUP BY library
    ORDER BY count DESC, library LIMIT 15`)
      .all(...params) as Array<{
      library: string;
      count: number;
    }>
  ).map((row) => ({ ...row, percentage: percent(row.count) }));
  const history = db
    .prepare(`SELECT day AS date, SUM(calls) AS calls,
    SUM(calls - success_calls) AS errors FROM mcp_stats_daily ${where}
    GROUP BY day ORDER BY day`)
    .all(...params) as Array<{ date: string; calls: number; errors: number }>;
  const byDay = new Map(history.map((row) => [row.date, row]));
  const today = new Date().toISOString().slice(0, 10);
  const start =
    options.days !== undefined
      ? new Date(`${today}T00:00:00Z`).getTime() - (options.days - 1) * 86400000
      : new Date(`${totals.firstDay ?? today}T00:00:00Z`).getTime();
  const activityHistory = [];
  for (
    let day = start;
    day <= new Date(`${today}T00:00:00Z`).getTime();
    day += 86400000
  ) {
    const date = new Date(day).toISOString().slice(0, 10);
    activityHistory.push(byDay.get(date) ?? { date, calls: 0, errors: 0 });
  }
  const active = db.prepare("SELECT COUNT(*) AS count FROM mcp_tokens").get() as {
    count: number;
  };
  return {
    firstDay: totals.firstDay,
    totalCalls: totals.total,
    successCalls: totals.successes,
    failedCalls: totals.total - totals.successes,
    successRate: totals.total ? Math.round((totals.successes / totals.total) * 100) : 100,
    avgDurationMs: totals.total
      ? Math.round((totals.duration / totals.total) * 10) / 10
      : 0,
    activeTokensCount: active.count,
    topTool: byTool[0]?.tool ?? null,
    topLibrary: byLibrary[0]?.library ?? null,
    byTool,
    byToken,
    byLibrary,
    activityHistory,
  };
}

/**
 * Reads bounded recent invocation metadata without any request or response text.
 * @param db - The open application database.
 * @param options - UTC calendar period, filters and pagination.
 * @returns Recent invocations with explicit UTC timestamps.
 */
export function readMcpRecent(
  db: Database,
  options: McpRecentCallsOptions = {},
): McpToolCallRecord[] {
  const { where, params } = filters(options, false);
  const rows = db
    .prepare(`SELECT id, token_id AS tokenId, token_comment AS tokenComment,
    tool, library, version, target, protocol, success, duration_ms AS durationMs,
    created_at AS createdAt FROM mcp_stats ${where}
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(
      ...params,
      Math.min(200, Math.max(1, options.limit ?? 50)),
      Math.max(0, options.offset ?? 0),
    ) as Array<Omit<McpToolCallRecord, "success"> & { success: number }>;
  return rows.map((row) => ({
    ...row,
    success: Boolean(row.success),
    createdAt: iso(row.createdAt),
  }));
}
