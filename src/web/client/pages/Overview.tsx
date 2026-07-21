/**
 * Overview (dashboard) page: KPI totals derived from the library index, an
 * honest empty-state placeholder for indexing activity (no time-series data
 * is available yet — see backlog note below), the system-health snapshot,
 * and a compact glance at currently active (running/queued) pipeline jobs.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { type PipelineJob, PipelineJobStatus } from "../../../pipeline/types";
import type { SystemHealth } from "../../../services/systemHealthRouter";
import { useGetJobs, useListLibraries, useSystemHealth } from "../api/hooks";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { Icon, type IconName } from "../components/Icon";
import { Pill } from "../components/Pill";
import { ProgressBar } from "../components/ProgressBar";
import { Loading } from "../components/Spinner";
import { StatusDot, type StatusVariant } from "../components/StatusDot";
import { displayUrl } from "../utils/format";

/** Formats a `Date` (or `null`) as a short relative-time string, e.g. "2m ago". */
function formatRelativeTime(date: Date | null): string {
  if (!date) return "just now";
  const diffMin = Math.round((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

/** One tile in the top KPI row. No deltas/sparklines are shown — there is no historical data to back them. */
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

/** Renders the worker-mode row of the system-health panel. */
function WorkerRow({ worker }: { worker: SystemHealth["worker"] }) {
  const isRemote = worker.mode === "remote";
  const variant: StatusVariant = isRemote ? (worker.connected ? "ok" : "err") : "ok";
  const meta = isRemote
    ? `${worker.url} · ${worker.connected ? "connected" : "disconnected"}`
    : "embedded";
  return (
    <div className="health__row">
      <StatusDot variant={variant} pulse={isRemote && worker.connected} />
      <span className="name">Worker</span>
      <span className="meta">{meta}</span>
    </div>
  );
}

/** Renders the embeddings row: provider/model/dims, or an honest full-text-only message. */
function EmbeddingsRow({ embeddings }: { embeddings: SystemHealth["embeddings"] }) {
  const meta = embeddings
    ? `${embeddings.provider} · ${embeddings.model}${embeddings.dimensions != null ? ` · ${embeddings.dimensions}d` : ""}`
    : "Full-text search only";
  return (
    <div className="health__row">
      <Icon name="i-bolt" size="sm" style={{ color: "var(--text-faint)" }} />
      <span className="name">Embeddings</span>
      <span className="meta">{meta}</span>
    </div>
  );
}

/** Renders the MCP endpoints row — only rendered by the caller when MCP is enabled. */
function McpRow({ endpoints }: { endpoints: string[] }) {
  return (
    <div className="health__row">
      <Icon name="i-globe" size="sm" style={{ color: "var(--text-faint)" }} />
      <span className="name">
        {endpoints.length > 1 ? "MCP endpoints" : "MCP endpoint"}
      </span>
      <span className="meta">{endpoints.join(" · ")}</span>
    </div>
  );
}

/** Renders the auth row: an enabled/disabled Pill plus the OIDC issuer when configured. */
function AuthRow({ auth }: { auth: SystemHealth["auth"] }) {
  return (
    <div className="health__row">
      <Icon name="i-settings" size="sm" style={{ color: "var(--text-faint)" }} />
      <span className="name">Auth</span>
      <span className="meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {auth.issuer ? <span>{auth.issuer}</span> : null}
        <Pill variant={auth.enabled ? "ok" : "idle"} withDot={false}>
          {auth.enabled ? "enabled" : "disabled"}
        </Pill>
      </span>
    </div>
  );
}

/** Renders the read-only row as a Pill. */
function ReadOnlyRow({ readOnly }: { readOnly: boolean }) {
  return (
    <div className="health__row">
      <Icon name="i-db" size="sm" style={{ color: "var(--text-faint)" }} />
      <span className="name">Read-only</span>
      <span className="meta">
        <Pill variant={readOnly ? "queued" : "idle"} withDot={false}>
          {readOnly ? "read-only" : "read-write"}
        </Pill>
      </span>
    </div>
  );
}

/** The system-health card: an honest snapshot of the running server's configuration. */
function SystemHealthCard() {
  const { data, isLoading, isError, error } = useSystemHealth();

  return (
    <Card className="panel">
      <div className="panel__head">
        <h3>System health</h3>
      </div>
      {isLoading ? (
        <Loading label="Loading system health…" />
      ) : isError || !data ? (
        <div style={{ color: "var(--err)", fontSize: 12.5 }}>
          Failed to load system health{error ? `: ${error.message}` : ""}
        </div>
      ) : (
        <div className="health">
          <WorkerRow worker={data.worker} />
          <EmbeddingsRow embeddings={data.embeddings} />
          {data.mcp.enabled ? <McpRow endpoints={data.mcp.endpoints} /> : null}
          <AuthRow auth={data.auth} />
          <ReadOnlyRow readOnly={data.readOnly} />
        </div>
      )}
    </Card>
  );
}

/**
 * "Pages processed" activity card. There is no time-series/history endpoint
 * yet, so this renders an honest empty state instead of a fabricated chart.
 * Backlog: wire up once a history API exists.
 */
function ActivityCard() {
  return (
    <Card className="panel chart-wrap">
      <div className="panel__head">
        <div>
          <span className="eyebrow">Indexing activity</span>
          <h3 style={{ marginTop: 2 }}>Pages processed</h3>
        </div>
      </div>
      <EmptyState
        icon="i-file"
        title="Activity history isn't available yet"
        description="Per-day indexing throughput isn't tracked yet, so there's nothing to chart."
      />
    </Card>
  );
}

/** A single compact row in the active-jobs list. */
function JobRow({
  library,
  version,
  status,
  sourceUrl,
  startedAt,
  progressPages,
  progressMaxPages,
  queuePosition,
}: {
  library: string;
  version: string | null;
  status: PipelineJobStatus.RUNNING | PipelineJobStatus.QUEUED;
  sourceUrl: string | null;
  startedAt: Date | null;
  progressPages?: number;
  progressMaxPages?: number;
  queuePosition: number;
}): ReactNode {
  const isRunning = status === PipelineJobStatus.RUNNING;
  const pct =
    isRunning && progressMaxPages && progressMaxPages > 0
      ? Math.round(((progressPages ?? 0) / progressMaxPages) * 100)
      : 0;

  return (
    <div className="job">
      <div className="job__top">
        <Pill variant={isRunning ? "run" : "queued"} pulse={isRunning}>
          {isRunning ? "running" : "queued"}
        </Pill>
        <span className="job__title">{library}</span>
        {version ? <Chip>{version}</Chip> : <Chip className="muted">unversioned</Chip>}
      </div>
      <div className="job__meta">
        {sourceUrl ? (
          <span className="m">
            <Icon name="i-globe" size="xs" />
            {displayUrl(sourceUrl)}
          </span>
        ) : null}
        {isRunning ? (
          <span className="m">
            <Icon name="i-clock" size="xs" />
            started {formatRelativeTime(startedAt)}
          </span>
        ) : (
          <span className="m">position {queuePosition} in queue</span>
        )}
      </div>
      <div className="job__prog">
        <ProgressBar value={pct} variant={isRunning ? "run" : "queued"} />
        <span className="pct">{pct}%</span>
      </div>
    </div>
  );
}

/** Narrows a job to the running/queued subset the active-jobs card renders. */
function isActiveJob(
  job: PipelineJob,
): job is PipelineJob & { status: PipelineJobStatus.RUNNING | PipelineJobStatus.QUEUED } {
  return (
    job.status === PipelineJobStatus.RUNNING || job.status === PipelineJobStatus.QUEUED
  );
}

/** Pairs each active job with its 1-based position among the queued-only subset. */
function withQueuePositions<T extends PipelineJob>(
  jobs: T[],
): Array<{ job: T; queuePosition: number }> {
  let queuedSeen = 0;
  return jobs.map((job) => {
    if (job.status === PipelineJobStatus.QUEUED) queuedSeen += 1;
    return { job, queuePosition: queuedSeen };
  });
}

/** The active-jobs card: running + queued pipeline jobs, or an empty state. */
function ActiveJobsCard() {
  const { data, isLoading, isError, error } = useGetJobs();

  const activeJobs = withQueuePositions((data?.jobs ?? []).filter(isActiveJob));

  return (
    <Card>
      {isLoading ? (
        <Loading label="Loading jobs…" />
      ) : isError ? (
        <div style={{ color: "var(--err)", padding: 16, fontSize: 12.5 }}>
          Failed to load jobs{error ? `: ${error.message}` : ""}
        </div>
      ) : activeJobs.length === 0 ? (
        <EmptyState
          icon="i-queue"
          title="No active jobs"
          description="Nothing is running or queued right now."
        />
      ) : (
        activeJobs.map(({ job, queuePosition }) => (
          <JobRow
            key={job.id}
            library={job.library}
            version={job.version}
            status={job.status}
            sourceUrl={job.sourceUrl}
            startedAt={job.startedAt}
            progressPages={job.progressPages}
            progressMaxPages={job.progressMaxPages}
            queuePosition={queuePosition}
          />
        ))
      )}
    </Card>
  );
}

/** Overview (dashboard) page — KPI totals, indexing activity, system health, and active jobs. */
export default function Overview() {
  const { data: libraries, isLoading, isError, error } = useListLibraries();

  if (isLoading) {
    return <Loading label="Loading overview…" />;
  }

  if (isError) {
    return (
      <Card className="panel" style={{ color: "var(--err)" }}>
        Failed to load overview: {error.message}
      </Card>
    );
  }

  const libs = libraries ?? [];
  const versionCount = libs.reduce((sum, lib) => sum + lib.versions.length, 0);
  const pageCount = libs.reduce(
    (sum, lib) => sum + lib.versions.reduce((s, v) => s + v.counts.uniqueUrls, 0),
    0,
  );
  const chunkCount = libs.reduce(
    (sum, lib) => sum + lib.versions.reduce((s, v) => s + v.counts.documents, 0),
    0,
  );

  return (
    <div>
      <div className="kpis">
        <Kpi icon="i-books" label="Libraries" value={libs.length.toLocaleString()} />
        <Kpi
          icon="i-layers"
          label="Versions indexed"
          value={versionCount.toLocaleString()}
        />
        <Kpi icon="i-file" label="Pages indexed" value={pageCount.toLocaleString()} />
        <Kpi
          icon="i-db"
          label="Knowledge base"
          value={chunkCount.toLocaleString()}
          suffix="chunks"
        />
      </div>

      <div className="grid-2" style={{ marginTop: 14 }}>
        <ActivityCard />
        <SystemHealthCard />
      </div>

      <div className="section-head">
        <div>
          <span className="eyebrow">Live</span>
          <h2>Active jobs</h2>
        </div>
        <Link className="link" to="/jobs">
          Open queue
          <Icon name="i-ext" size="xs" />
        </Link>
      </div>
      <ActiveJobsCard />
    </div>
  );
}
