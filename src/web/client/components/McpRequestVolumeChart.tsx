import type { ReactNode } from "react";
import type { McpActivityPoint } from "../../../store/types";
import { AreaChart } from "./AreaChart";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Loading } from "./Spinner";

interface McpRequestVolumeChartProps {
  history?: McpActivityPoint[];
  isLoading?: boolean;
  error?: string;
  action?: ReactNode;
  description?: string;
}

/**
 * Displays daily MCP tool calls from the statistics API.
 * @param props - Daily totals, request status and an optional header action.
 * @returns The request volume panel.
 */
export function McpRequestVolumeChart({
  history = [],
  isLoading,
  error,
  action,
  description = "Daily MCP tool calls (UTC)",
}: McpRequestVolumeChartProps) {
  const values = history.map(({ calls }) => calls);
  const maxCalls = values.reduce((max, calls) => Math.max(max, calls), 0);
  const labelCount = Math.min(4, history.length);
  const xLabels = Array.from({ length: labelCount }, (_, index) => {
    const dayIndex = Math.round(
      (index * (history.length - 1)) / Math.max(1, labelCount - 1),
    );
    return history[dayIndex].date.slice(5);
  });
  const yLabels = [maxCalls, (maxCalls * 2) / 3, maxCalls / 3, 0].map((value) =>
    value.toLocaleString(undefined, { maximumFractionDigits: maxCalls < 3 ? 1 : 0 }),
  );

  return (
    <Card className="panel chart-wrap">
      <div className="panel__head">
        <div>
          <span className="eyebrow">MCP Statistics</span>
          <h3>Request Volume Over Time</h3>
          <small className="muted">{description}</small>
        </div>
        {action}
      </div>
      {isLoading ? (
        <Loading label="Loading MCP statistics…" />
      ) : error ? (
        <EmptyState title="Couldn't load MCP statistics" description={error} />
      ) : maxCalls > 0 ? (
        <AreaChart
          values={values}
          xLabels={xLabels}
          yLabels={yLabels}
          label={description}
          height={180}
        />
      ) : (
        <EmptyState icon="i-chart" title="No MCP calls in this period" />
      )}
    </Card>
  );
}
