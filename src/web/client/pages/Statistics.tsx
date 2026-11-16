import { useMemo, useState } from "react";
import type { McpToolStatItem } from "../../../store/types";
import { useListLibraries, useMcpRecentCalls, useMcpStatsOverview } from "../api/hooks";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { Icon, type IconName } from "../components/Icon";
import { McpRequestVolumeChart } from "../components/McpRequestVolumeChart";
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

function ToolPopularityRow({
  tool,
  totalCalls,
}: {
  tool: McpToolStatItem;
  totalCalls: number;
}) {
  const share = (tool.count / totalCalls) * 100;
  const successShare = (tool.successCalls / tool.count) * 100;
  const outcomes = `${tool.successCalls.toLocaleString()} succeeded · ${tool.failedCalls.toLocaleString()} failed`;

  return (
    <div className="tool-popularity">
      <div className="tool-popularity__summary">
        <span className="tool-popularity__name">{tool.tool}</span>
        <span>
          <b>{tool.count.toLocaleString()}</b> calls ({tool.percentage}%) ·{" "}
          {tool.avgDurationMs}ms
        </span>
      </div>
      <div className="bar" aria-hidden="true">
        <div
          className="bar__fill"
          style={{
            width: `${share}%`,
            background: `linear-gradient(to right, var(--ok) ${successShare}%, var(--err) ${successShare}%)`,
          }}
        />
      </div>
      <div>{outcomes}</div>
    </div>
  );
}

/** Shows MCP usage history and filters across callers, tools and libraries. */
export default function Statistics() {
  const [period, setPeriod] = useState<PeriodOption>("7");
  const [selectedCaller, setSelectedCaller] = useState<string | undefined>(undefined);
  const [selectedTool, setSelectedTool] = useState<string | undefined>(undefined);
  const [selectedLibrary, setSelectedLibrary] = useState<string | undefined>(undefined);

  const daysParam = period === "all" ? undefined : Number.parseInt(period, 10);

  const statsFilter = useMemo(
    () => ({
      days: daysParam,
      caller: selectedCaller,
      tool: selectedTool,
      library: selectedLibrary,
    }),
    [daysParam, selectedCaller, selectedTool, selectedLibrary],
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
  const callers = new Set(overview?.byToken.map(({ comment }) => comment));
  const callerOptions = new Set(catalog?.byToken.map(({ comment }) => comment));

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
        <Kpi icon="i-globe" label="Callers" value={callers.size.toLocaleString()} />
        <Kpi
          icon="i-clock"
          label="Avg Latency"
          value={overview ? `${overview.avgDurationMs}` : "0"}
          suffix="ms"
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <McpRequestVolumeChart history={overview?.activityHistory} />
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
              {overview.byTool.map((tool) => (
                <ToolPopularityRow
                  key={tool.tool}
                  tool={tool}
                  totalCalls={overview.totalCalls}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No tool calls yet"
              description="Make requests via an MCP client."
            />
          )}
        </Card>

        {/* Usage by Caller */}
        <Card className="panel">
          <div className="panel__head" style={{ marginBottom: 12 }}>
            <Icon name="i-globe" size="sm" style={{ color: "var(--primary)" }} />
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
              description="MCP tool calls will appear here."
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
              aria-label="Caller"
              value={selectedCaller ?? ""}
              onChange={(e) => setSelectedCaller(e.target.value || undefined)}
            >
              <option value="">All Callers</option>
              {[...callerOptions].map((caller) => (
                <option key={caller} value={caller}>
                  {caller}
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
                        <>
                          <Pill variant="err" withDot>
                            error
                          </Pill>
                          <div className="muted">
                            <small>{call.failureReason ?? "Reason unavailable"}</small>
                          </div>
                        </>
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
