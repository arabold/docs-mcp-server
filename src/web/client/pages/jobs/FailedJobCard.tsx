/**
 * A single row in the "Needs attention" section: a failed job with its error
 * message and recovery actions. Matches the mockup's `.jobc.jobc--failed`.
 *
 * There is no per-job "dismiss" procedure in the API (only `clearCompletedJobs`,
 * which clears every finished job at once) — see the page-level "Clear
 * completed" button for that. This card intentionally has no per-job dismiss
 * action rather than faking one.
 */
import { Button } from "../../components/Button";
import { Chip } from "../../components/Chip";
import { Icon } from "../../components/Icon";
import { LibIcon } from "../../components/LibIcon";
import { Pill } from "../../components/Pill";
import { formatRelative } from "./format";
import type { Job } from "./types";

export interface FailedJobCardProps {
  job: Job;
  now: number;
  onRetry: (job: Job) => void;
  onEditAndRetry: (job: Job) => void;
  retryPending?: boolean;
}

/**
 * @example
 * <FailedJobCard job={job} now={Date.now()} onRetry={retry} onEditAndRetry={editAndRetry} />
 */
export function FailedJobCard({
  job,
  now,
  onRetry,
  onEditAndRetry,
  retryPending = false,
}: FailedJobCardProps) {
  const pages = job.progress?.pagesScraped ?? job.progressPages ?? 0;
  const maxPages = job.progress?.totalPages ?? job.progressMaxPages ?? 0;
  const depth = job.progress?.depth;

  return (
    <div className="jobc jobc--failed">
      <div className="jobc__head">
        <Pill variant="err">failed</Pill>
        <LibIcon name={job.library} url={job.sourceUrl} />
        <span className="jobc__title">{job.library}</span>
        <Chip>{job.version || "unversioned"}</Chip>
        <span className="jobc__id">{job.id}</span>
        <div className="jobc__right">
          <span className="jobc__elapsed">{formatRelative(now, job.finishedAt)}</span>
          <Button
            variant="primary"
            size="sm"
            disabled={retryPending}
            onClick={() => onRetry(job)}
          >
            <Icon name="i-refresh" size="sm" />
            Retry
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onEditAndRetry(job)}>
            Edit &amp; retry
          </Button>
        </div>
      </div>
      <div className="jobc__error">
        <span className="t">Error</span> — {job.errorMessage ?? "Unknown error"}
        <span className="m">
          Failed at depth {depth ?? 0} · {pages.toLocaleString()} of{" "}
          {maxPages ? maxPages.toLocaleString() : "?"} pages indexed
        </span>
      </div>
    </div>
  );
}
