/**
 * Statistics page: detailed usage analytics across tools, callers/tokens, and
 * documentation libraries. Helps administrators understand which MCP tools are
 * popular, who is using the server, and what documentation is being accessed.
 */
import { useMemo, useState } from "react";
import { useListLibraries, useMcpRecentCalls, useMcpStatsOverview } from "../api/hooks";
import { AreaChart } from "../components/AreaChart";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { Icon, type IconName } from "../components/Icon";
import { McpAdminGate } from "../components/McpAdminGate";
import { Pill } from "../components/Pill";
import { ProgressBar } from "../components/ProgressBar";
import { SegmentedControl } from "../components/SegmentedControl";
import { Loading } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th } from "../components/Table";
import { formatRelativeShort } from "../utils/format";

type PeriodOption = "1" | "7" | "30" | "all";

const PERIOD_OPTIONS = [
  { value: "1", label: "Today (UTC)" },
  { value: "7", label: "7 Days" },
  { value: "30", label: "30 Days" },
  { value: "all", label: "All Time" },
];

function Kpi({
  icon,
  label,
  value,
  suffix,
}: {
  icon: IconName;
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <Card className="kpi">
      <div className="kpi__label">
        <Icon name={icon} />
        {label}
      </div>
      <div className="kpi__val">
        {value} {suffix ? <small>{suffix}</small> : null}
      </div>
    </Card>
  );
}

function StatisticsContent() {
  const [period, setPeriod] = useState<PeriodOption>("7");
  const [selectedTokenId, setSelectedTokenId] = useState<number | undefined>(undefined);
  const [selectedTool, setSelectedTool] = useState<string | undefined>(undefined);
  const [selectedLibrary, setSelectedLibrary] = useState<string | undefined>(undefined);

  const daysParam = period === "all" ? undefined : Number.parseInt(period, 10);

  const statsFilter = useMemo(
    () => ({
      days: daysParam,
      tokenId: selectedTokenId,
      tool: selectedTool,
      library: selectedLibrary,
    }),
    [daysParam, selectedTokenId, selectedTool, selectedLibrary],
  );

  const {
    data: overview,
    isLoading: overviewLoading,
    error: overviewError,
  } = useMcpStatsOverview(statsFilter);
  const { data: recentCalls, isLoading: callsLoading } = useMcpRecentCalls({
    ...statsFilter,
    limit: 50,
  });
  const { data: catalog } = useMcpStatsOverview();
  const { data: librariesList } = useListLibraries();

  const activityValues = useMemo(() => {
    if (!overview?.activityHistory || overview.activityHistory.length === 0) return [];
    return overview.activityHistory.map((d) => d.calls);
  }, [overview?.activityHistory]);

  const activityXLabels = useMemo(() => {
    if (!overview?.activityHistory || overview.activityHistory.length === 0) return [];
    const history = overview.activityHistory;
    if (history.length <= 4) return history.map((d) => d.date.slice(5));
    const step = Math.floor(history.length / 3);
    return [
      history[0].date.slice(5),
      history[step].date.slice(5),
      history[step * 2].date.slice(5),
      history[history.length - 1].date.slice(5),
    ];
  }, [overview?.activityHistory]);

  const maxCalls = Math.max(0, ...activityValues);
  const activityYLabels = [
    String(maxCalls),
    String(Math.round(maxCalls * 0.66)),
    String(Math.round(maxCalls * 0.33)),
    "0",
  ];

  if (overviewLoading && !overview) {
    return <Loading label="Loading MCP statistics…" />;
  }

  if (overviewError)
    return (
      <Card className="panel">Failed to load statistics: {overviewError.message}</Card>
    );

  return (
    <div>
      <div
        className="section-head"
        style={{
          marginTop: 4,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <span className="eyebrow">Analytics</span>
          <h2>MCP Statistics</h2>
          <span className="sub" style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Daily MCP usage counters in UTC. Historical totals survive recent-call
            cleanup.
          </span>
        </div>
        <div>
          <SegmentedControl
            options={PERIOD_OPTIONS}
            value={period}
            onChange={(val) => setPeriod(val as PeriodOption)}
          />
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="kpis" style={{ marginTop: 14 }}>
        <Kpi
          icon="i-queue"
          label="Total Invocations"
          value={overview ? overview.totalCalls.toLocaleString() : "0"}
        />
        <Kpi
          icon="i-check"
          label="Success Rate"
          value={overview ? `${overview.successRate}%` : "100%"}
          suffix={overview ? `${overview.failedCalls} errors` : undefined}
        />
        <Kpi
          icon="i-key"
          label="Active Tokens"
          value={overview ? String(overview.activeTokensCount) : "0"}
          suffix="configured"
        />
        <Kpi
          icon="i-clock"
          label="Avg Latency"
          value={overview ? `${overview.avgDurationMs}` : "0"}
          suffix="ms"
        />
      </div>

      {/* Activity Chart */}
      <div style={{ marginTop: 16 }}>
        <Card className="panel">
          <div className="panel__head" style={{ marginBottom: 12 }}>
            <div>
              <h3>Request Volume Over Time</h3>
              <span className="sub" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Daily requests made by MCP clients (UTC)
              </span>
            </div>
          </div>
          {activityValues.length > 1 ? (
            <AreaChart
              values={activityValues}
              xLabels={activityXLabels}
              yLabels={activityYLabels}
              label="Daily MCP requests"
              height={180}
            />
          ) : (
            <div
              style={{
                padding: "30px 0",
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              Not enough activity data in this time period yet.
            </div>
          )}
        </Card>
      </div>

      {/* Breakdowns Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 14,
          marginTop: 16,
        }}
      >
        {/* Tool Popularity */}
        <Card className="panel">
          <div className="panel__head" style={{ marginBottom: 12 }}>
            <Icon name="i-bolt" size="sm" style={{ color: "var(--primary)" }} />
            <h3 style={{ marginLeft: 6 }}>Tool Popularity</h3>
          </div>
          {overview && overview.byTool.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {overview.byTool.map((toolItem) => (
                <div key={toolItem.tool} style={{ fontSize: 12.5 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontFamily: "var(--mono)" }}>
                      {toolItem.tool}
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>
                      <b>{toolItem.count}</b> calls ({toolItem.percentage}%) ·{" "}
                      {toolItem.avgDurationMs}ms
                    </span>
                  </div>
                  <ProgressBar
                    value={toolItem.percentage}
                    variant={toolItem.successRate >= 95 ? "ok" : "err"}
                  />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No tool calls yet"
              description="Make requests via an MCP client."
            />
          )}
        </Card>

        {/* Usage by Caller/Friend */}
        <Card className="panel">
          <div className="panel__head" style={{ marginBottom: 12 }}>
            <Icon name="i-key" size="sm" style={{ color: "var(--primary)" }} />
            <h3 style={{ marginLeft: 6 }}>Usage by Caller</h3>
          </div>
          {overview && overview.byToken.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {overview.byToken.map((tokenItem) => (
                <div
                  key={`${tokenItem.tokenId ?? "anon"}-${tokenItem.comment}`}
                  style={{ fontSize: 12.5 }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      <Pill variant="ok" withDot={false}>
                        {tokenItem.comment}
                      </Pill>
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>
                      <b>{tokenItem.count}</b> calls ({tokenItem.percentage}%)
                      {tokenItem.lastUsedAt
                        ? ` · ${formatRelativeShort(new Date(tokenItem.lastUsedAt))}`
                        : null}
                    </span>
                  </div>
                  <ProgressBar value={tokenItem.percentage} variant="ok" />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No caller activity"
              description="Calls with valid tokens will appear here."
            />
          )}
        </Card>

        {/* Accessed Documentation */}
        <Card className="panel">
          <div className="panel__head" style={{ marginBottom: 12 }}>
            <Icon name="i-books" size="sm" style={{ color: "var(--primary)" }} />
            <h3 style={{ marginLeft: 6 }}>Accessed Documentation</h3>
          </div>
          {overview && overview.byLibrary.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {overview.byLibrary.map((libItem) => (
                <div key={libItem.library} style={{ fontSize: 12.5 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      <Chip>{libItem.library}</Chip>
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>
                      <b>{libItem.count}</b> lookups ({libItem.percentage}%)
                    </span>
                  </div>
                  <ProgressBar value={libItem.percentage} variant="run" />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No library lookups"
              description="Queries to indexed libraries will be highlighted here."
            />
          )}
        </Card>
      </div>

      {/* Filter and Recent Calls Log Table */}
      <div style={{ marginTop: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <div className="section-head" style={{ margin: 0 }}>
            <div>
              <span className="eyebrow">Recent Metadata</span>
              <h2>Recent Tool Invocations</h2>
            </div>
          </div>

          {/* Quick Filters */}
          <div
            style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
          >
            {/* Filter by Caller */}
            <select
              style={{
                background: "var(--surface-1)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-ctl)",
                padding: "4px 8px",
                fontSize: 12,
              }}
              value={selectedTokenId ?? ""}
              onChange={(e) =>
                setSelectedTokenId(
                  e.target.value ? Number.parseInt(e.target.value, 10) : undefined,
                )
              }
            >
              <option value="">All Callers</option>
              {catalog?.byToken
                .filter((t) => t.tokenId !== null)
                .map((t) => (
                  <option key={t.tokenId} value={t.tokenId ?? ""}>
                    {t.comment}
                  </option>
                ))}
            </select>

            {/* Filter by Tool */}
            <select
              style={{
                background: "var(--surface-1)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-ctl)",
                padding: "4px 8px",
                fontSize: 12,
              }}
              value={selectedTool ?? ""}
              onChange={(e) => setSelectedTool(e.target.value || undefined)}
            >
              <option value="">All Tools</option>
              {catalog?.byTool.map(({ tool }) => (
                <option key={tool} value={tool}>
                  {tool}
                </option>
              ))}
            </select>

            {/* Filter by Library */}
            <select
              style={{
                background: "var(--surface-1)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-ctl)",
                padding: "4px 8px",
                fontSize: 12,
              }}
              value={selectedLibrary ?? ""}
              onChange={(e) => setSelectedLibrary(e.target.value || undefined)}
            >
              <option value="">All Libraries</option>
              {Array.from(
                new Set([
                  ...(librariesList?.map((lib) => lib.library) ?? []),
                  ...(catalog?.byLibrary.map((lib) => lib.library) ?? []),
                ]),
              )
                .sort()
                .map((library) => (
                  <option key={library} value={library}>
                    {library}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <Card className="panel" style={{ padding: 0, overflow: "hidden" }}>
          {callsLoading ? (
            <Loading label="Loading recent invocations…" />
          ) : recentCalls && recentCalls.length > 0 ? (
            <Table>
              <TableHead>
                <tr>
                  <Th>Time</Th>
                  <Th>Caller</Th>
                  <Th>Tool</Th>
                  <Th>Library</Th>
                  <Th>Document / Transport</Th>
                  <Th num>Latency</Th>
                  <Th>Status</Th>
                </tr>
              </TableHead>
              <TableBody>
                {recentCalls.map((call) => (
                  <tr key={call.id}>
                    <Td
                      style={{
                        fontSize: 11.5,
                        color: "var(--text-muted)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatRelativeShort(new Date(call.createdAt))}
                    </Td>
                    <Td>
                      <Pill variant="ok" withDot={false}>
                        {call.tokenComment || "Anonymous"}
                      </Pill>
                    </Td>
                    <Td>
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: "var(--text)",
                        }}
                      >
                        {call.tool}
                      </span>
                    </Td>
                    <Td>
                      {call.library ? (
                        <Chip>
                          {call.library}
                          {call.version ? `@${call.version}` : ""}
                        </Chip>
                      ) : (
                        <span style={{ color: "var(--text-faint)", fontSize: 11 }}>
                          —
                        </span>
                      )}
                    </Td>
                    <Td
                      style={{
                        maxWidth: 320,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 11.5,
                      }}
                      title={call.target ?? ""}
                    >
                      {call.target ?? "—"} <small>({call.protocol})</small>
                    </Td>
                    <Td num style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                      {call.durationMs}ms
                    </Td>
                    <Td>
                      {call.success ? (
                        <Pill variant="ok" withDot>
                          ok
                        </Pill>
                      ) : (
                        <span title="Tool execution failed">
                          <Pill variant="err" withDot>
                            error
                          </Pill>
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div style={{ padding: "30px 20px" }}>
              <EmptyState
                title="No tool invocations recorded"
                description="Recent calls retain only bounded metadata for up to 30 days and approximately 20,000 calls. Daily totals remain available after cleanup."
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * Shows usage analytics to an authenticated operator.
 * @returns The administrative gate and statistics page.
 */
export default function Statistics() {
  return (
    <McpAdminGate>
      <StatisticsContent />
    </McpAdminGate>
  );
}
