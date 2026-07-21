/**
 * App shell sidebar: brand wordmark, primary nav (with active-state left-rail
 * indicator + live counts), a System section, and a status footer. Ported
 * from the mockup's `.sidebar`.
 */
import { NavLink } from "react-router-dom";
import { PipelineJobStatus } from "../../../pipeline/types";
import { useGetJobs, useListLibraries, useSystemHealth } from "../api/hooks";
import { useUpdateCheck } from "../hooks/useUpdateCheck";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

const ACTIVE_JOB_STATUSES: ReadonlySet<PipelineJobStatus> = new Set([
  PipelineJobStatus.QUEUED,
  PipelineJobStatus.RUNNING,
]);

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? "nav-item is-active" : "nav-item";
}

/** The primary app sidebar, rendered once by `Shell`. */
export function Sidebar() {
  const { data: libraries } = useListLibraries();
  const { data: jobsResult } = useGetJobs();
  const { data: health } = useSystemHealth();
  const { hasUpdate, latestLabel, releaseUrl } = useUpdateCheck(health?.version);

  const libraryCount = libraries?.length ?? 0;
  const liveJobCount =
    jobsResult?.jobs.filter((job) => ACTIVE_JOB_STATUSES.has(job.status)).length ?? 0;

  // Worker reads healthy unless it's a remote worker we've lost the connection to.
  const workerVariant = !health
    ? "idle"
    : health.worker.mode === "remote" && !health.worker.connected
      ? "err"
      : "run";

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand__mark">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <use href="#i-layers" />
          </svg>
        </div>
        <div>
          <span className="brand__name">
            <b>grounded</b>
            <span className="dot">.</span>docs
          </span>
          <span className="brand__sub">docs-mcp-server</span>
        </div>
      </div>

      <div className="nav-label">Workspace</div>
      <NavLink to="/" end className={navClass}>
        <Icon name="i-grid" size="sm" />
        Overview
      </NavLink>
      <NavLink to="/libraries" className={navClass}>
        <Icon name="i-books" size="sm" />
        Libraries
        {libraries ? <span className="count">{libraryCount}</span> : null}
      </NavLink>
      <NavLink to="/jobs" className={navClass}>
        <Icon name="i-queue" size="sm" />
        Jobs &amp; Queue
        {liveJobCount > 0 ? (
          <span className="count count--live">{liveJobCount}</span>
        ) : null}
      </NavLink>
      <NavLink to="/search" className={navClass}>
        <Icon name="i-search" size="sm" />
        Search Playground
      </NavLink>

      <div className="nav-label">System</div>
      <NavLink to="/settings" className={navClass}>
        <Icon name="i-settings" size="sm" />
        Settings
      </NavLink>

      <div className="sidebar__spacer" />

      <div className="side-card">
        <div className="side-row">
          <StatusDot variant={workerVariant} pulse={workerVariant === "run"} />
          <span className="k">Worker</span>
          <span className="v">{health?.worker.mode ?? "—"}</span>
        </div>
        <div className="side-row">
          <Icon name="i-bolt" size="xs" style={{ color: "var(--text-faint)" }} />
          <span className="k">Embeddings</span>
          <span className="v">
            {health ? (health.embeddings?.model ?? "FTS only") : "—"}
          </span>
        </div>
        <div className="side-row">
          <Icon name="i-db" size="xs" style={{ color: "var(--text-faint)" }} />
          <span className="k">Version</span>
          <span className="v">{health ? `v${health.version}` : "—"}</span>
        </div>
      </div>

      {hasUpdate ? (
        <a
          className="update-pill"
          href={releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="i-up" size="sm" />
          Update available · {latestLabel}
        </a>
      ) : null}
    </aside>
  );
}
