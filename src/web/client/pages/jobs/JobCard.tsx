/**
 * A single row in the "Active & queued" live section: a running, cancelling,
 * or queued job. Matches the mockup's `.jobc` job card, reusing `Pill`,
 * `LibIcon`, `Chip`, `ProgressBar`, and `Icon` from the shared component
 * library — see `components/README.md`.
 */
import { PipelineJobStatus } from "../../../../pipeline/types";
import { Button } from "../../components/Button";
import { Chip } from "../../components/Chip";
import { Icon } from "../../components/Icon";
import { LibIcon } from "../../components/LibIcon";
import { Pill } from "../../components/Pill";
import { ProgressBar } from "../../components/ProgressBar";
import { displayUrl, formatElapsed, progressPercent } from "./format";
import type { Job } from "./types";

export interface JobCardProps {
  job: Job;
  /** 1-based position in the FIFO queue. Only meaningful for queued jobs. */
  position?: number;
  now: number;
  onCancel: (id: string) => void;
  /** True while this specific job's cancel request is in flight. */
  cancelPending?: boolean;
}

/** Renders the mockup's per-status meta line (URL for running, or the collapse note for cancelling). */
function StatsLine({ job }: { job: Job }) {
  const pages = job.progress?.pagesScraped ?? job.progressPages ?? 0;
  const maxPages = job.progress?.totalPages ?? job.progressMaxPages ?? 0;

  if (job.status === PipelineJobStatus.CANCELLING) {
    return (
      <div className="jobc__stats">
        <span>
          <b>{pages.toLocaleString()}</b> / {maxPages.toLocaleString()} pages
        </span>
        <span>stops once the in-flight page finishes</span>
      </div>
    );
  }

  if (job.status === PipelineJobStatus.RUNNING) {
    return (
      <div className="jobc__stats">
        <span>
          <b>{pages.toLocaleString()}</b> / {maxPages.toLocaleString()} pages
        </span>
        {job.progress ? (
          <span>
            <b>{job.progress.totalDiscovered.toLocaleString()}</b> discovered
          </span>
        ) : null}
        {job.progress ? (
          <span>
            depth <b>{job.progress.depth}</b> / {job.progress.maxDepth}
          </span>
        ) : null}
        <span>{job.scraperOptions?.scrapeMode ?? "auto"}</span>
        <span>scope {job.scraperOptions?.scope ?? "subpages"}</span>
      </div>
    );
  }

  // Queued
  return (
    <div className="jobc__stats">
      {job.sourceUrl ? <span>{displayUrl(job.sourceUrl)}</span> : null}
      <span>{job.scraperOptions?.scrapeMode ?? "auto"}</span>
      <span>scope {job.scraperOptions?.scope ?? "subpages"}</span>
      {job.scraperOptions?.maxPages ? (
        <span>max {job.scraperOptions.maxPages.toLocaleString()} pages</span>
      ) : null}
    </div>
  );
}

/**
 * @example <JobCard job={job} now={Date.now()} onCancel={(id) => cancelJob.mutate({ id })} />
 */
export function JobCard({
  job,
  position,
  now,
  onCancel,
  cancelPending = false,
}: JobCardProps) {
  const isRunning = job.status === PipelineJobStatus.RUNNING;
  const isCancelling = job.status === PipelineJobStatus.CANCELLING;
  const isQueued = job.status === PipelineJobStatus.QUEUED;

  const pages = job.progress?.pagesScraped ?? job.progressPages ?? 0;
  const maxPages = job.progress?.totalPages ?? job.progressMaxPages ?? 0;
  const pct = progressPercent(pages, maxPages);

  const modifierClass = isRunning
    ? "jobc--running"
    : isCancelling
      ? "jobc--cancelling"
      : "jobc--queued";

  return (
    <div className={`jobc ${modifierClass}`}>
      <div className="jobc__head">
        {isRunning ? (
          <Pill variant="run" pulse>
            running
          </Pill>
        ) : isCancelling ? (
          <Pill variant="idle">cancelling</Pill>
        ) : (
          <Pill variant="queued">queued</Pill>
        )}
        {isQueued && position != null ? <span className="qpos">#{position}</span> : null}
        <LibIcon name={job.library} url={job.sourceUrl} />
        <span className="jobc__title">{job.library}</span>
        <Chip>{job.version || "unversioned"}</Chip>
        <span className="jobc__id">{job.id}</span>
        <div className="jobc__right">
          {isRunning ? (
            <span className="jobc__elapsed">
              <Icon name="i-clock" size="xs" style={{ color: "var(--text-faint)" }} />
              {job.startedAt ? formatElapsed(now - job.startedAt.getTime()) : "—"}
            </span>
          ) : isCancelling ? (
            <span className="jobc__elapsed">finishing current page…</span>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={isCancelling || cancelPending}
            onClick={() => onCancel(job.id)}
          >
            Cancel
          </Button>
        </div>
      </div>

      {isRunning && job.progress?.currentUrl ? (
        <div className="jobc__url">
          <Icon name="i-globe" size="xs" style={{ color: "var(--text-faint)" }} />
          Processing <span className="u">{job.progress.currentUrl}</span>
        </div>
      ) : null}

      {isRunning || isCancelling ? (
        <div className="jobc__prog">
          <ProgressBar value={pct} />
          <span className="pct">{pct}%</span>
        </div>
      ) : null}

      <StatsLine job={job} />
    </div>
  );
}
