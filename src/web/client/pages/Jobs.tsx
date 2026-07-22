/**
 * Jobs & Queue page — live pipeline state and error recovery.
 *
 * Shows summary stats, a "needs attention" list of failed jobs with retry
 * actions, the live "active & queued" list (running/cancelling/queued jobs
 * with progress), and a history table of recently finished jobs. Updates in
 * real time via `useEventsSubscription` — no manual refresh required.
 *
 * See `components/README.md` for the shared component catalogue and
 * `pages/Libraries.tsx` for the reference composition pattern this page
 * follows (Table/Card/Pill/Chip/EmptyState + `useConfirm`/`useToast` +
 * `trpc.useUtils()` cache invalidation after mutations).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EventType } from "../../../events/types";
import { PipelineJobStatus } from "../../../pipeline/types";
import {
  useCancelJob,
  useClearCompletedJobs,
  useEnqueueScrapeJob,
  useEventsSubscription,
  useGetJobs,
  useSystemHealth,
} from "../api/hooks";
import { trpc } from "../api/trpc";
import { useDocumentationDrawer } from "../components/AddEditDocumentationDrawer";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { Pill } from "../components/Pill";
import { Loading } from "../components/Spinner";
import { StatusDot } from "../components/StatusDot";
import { Table, TableBody, TableHead, Td, Th } from "../components/Table";
import { useToast } from "../components/Toast";
import { FailedJobCard } from "./jobs/FailedJobCard";
import { formatDuration, formatRelative } from "./jobs/format";
import { JobCard } from "./jobs/JobCard";
import type { Job } from "./jobs/types";

/** Stable subscription filter — module-level so the object identity never changes across renders. */
const JOB_EVENTS_INPUT = {
  events: [
    EventType.JOB_STATUS_CHANGE,
    EventType.JOB_PROGRESS,
    EventType.JOB_LIST_CHANGE,
  ],
};

const FINISHED_STATUSES: ReadonlySet<PipelineJobStatus> = new Set([
  PipelineJobStatus.COMPLETED,
  PipelineJobStatus.CANCELLED,
  PipelineJobStatus.FAILED,
]);

const HISTORY_LIMIT = 25;

function statusPill(status: PipelineJobStatus) {
  if (status === PipelineJobStatus.COMPLETED) {
    return <Pill variant="ok">completed</Pill>;
  }
  if (status === PipelineJobStatus.FAILED) {
    return <Pill variant="err">failed</Pill>;
  }
  return <Pill variant="idle">cancelled</Pill>;
}

export default function Jobs() {
  const { data, isLoading, isError, error } = useGetJobs();
  const { data: health } = useSystemHealth();
  const cancelJob = useCancelJob();
  const clearCompletedJobs = useClearCompletedJobs();
  const enqueueScrapeJob = useEnqueueScrapeJob();
  const confirm = useConfirm();
  const toast = useToast();
  const drawer = useDocumentationDrawer();
  const utils = trpc.useUtils();

  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Ticks once a second so elapsed/relative timestamps stay live between
  // server events (e.g. a long-running page fetch with no progress tick yet).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Real-time updates: any job status/progress/list change invalidates the
  // `getJobs` query so this page reflects live pipeline state without a
  // manual refresh. Debounced slightly since JOB_PROGRESS fires once per
  // page scraped and could otherwise trigger a refetch per page.
  const invalidateTimer = useRef<number | null>(null);
  const scheduleInvalidate = useCallback(() => {
    if (invalidateTimer.current != null) return;
    invalidateTimer.current = window.setTimeout(() => {
      invalidateTimer.current = null;
      utils.getJobs.invalidate();
    }, 250);
  }, [utils]);
  useEffect(
    () => () => {
      if (invalidateTimer.current != null) window.clearTimeout(invalidateTimer.current);
    },
    [],
  );
  useEventsSubscription(JOB_EVENTS_INPUT, scheduleInvalidate);

  // Only an embedded worker has a fixed pool of slots to report; a remote
  // worker's concurrency isn't ours to know, and while health is still
  // loading we don't want to claim a slot count we haven't confirmed yet.
  const maxConcurrency =
    health?.worker.mode === "embedded" ? health.worker.maxConcurrency : null;

  const jobs = useMemo(() => data?.jobs ?? [], [data]);

  const runningJobs = useMemo(
    () => jobs.filter((j) => j.status === PipelineJobStatus.RUNNING),
    [jobs],
  );
  const cancellingJobs = useMemo(
    () => jobs.filter((j) => j.status === PipelineJobStatus.CANCELLING),
    [jobs],
  );
  const queuedJobs = useMemo(
    () =>
      jobs
        .filter((j) => j.status === PipelineJobStatus.QUEUED)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    [jobs],
  );
  const failedJobs = useMemo(
    () =>
      jobs
        .filter((j) => j.status === PipelineJobStatus.FAILED)
        .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0)),
    [jobs],
  );
  const completedCount = useMemo(
    () => jobs.filter((j) => j.status === PipelineJobStatus.COMPLETED).length,
    [jobs],
  );
  const finishedJobs = useMemo(
    () =>
      jobs
        .filter((j) => FINISHED_STATUSES.has(j.status))
        .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))
        .slice(0, HISTORY_LIMIT),
    [jobs],
  );

  const activeAndQueued = useMemo(
    () => [...runningJobs, ...cancellingJobs, ...queuedJobs],
    [runningJobs, cancellingJobs, queuedJobs],
  );

  const finishedTotalCount =
    jobs.length - runningJobs.length - cancellingJobs.length - queuedJobs.length;

  if (isLoading) {
    return <Loading label="Loading jobs…" />;
  }

  if (isError) {
    return (
      <Card className="panel" style={{ color: "var(--err)" }}>
        Failed to load jobs: {error.message}
      </Card>
    );
  }

  async function handleCancel(id: string) {
    setCancellingId(id);
    try {
      await cancelJob.mutateAsync({ id });
      await utils.getJobs.invalidate();
    } catch (err) {
      toast.error(
        "Failed to cancel job",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setCancellingId(null);
    }
  }

  async function handleRetry(job: Job) {
    if (!job.scraperOptions) {
      toast.error(
        "Can't retry automatically",
        "This job has no stored scraper options — use Edit & retry instead.",
      );
      return;
    }
    setRetryingId(job.id);
    try {
      // Failed jobs never finished indexing, so re-run a full scrape (not an
      // incremental refresh, which assumes previously-indexed content).
      await enqueueScrapeJob.mutateAsync({
        library: job.library,
        version: job.version || undefined,
        options: {
          ...job.scraperOptions,
          url: job.sourceUrl ?? job.scraperOptions.url,
          library: job.library,
          version: job.version ?? "",
        },
      });
      await utils.getJobs.invalidate();
      toast.success(`Retrying ${job.library}${job.version ? ` ${job.version}` : ""}`);
    } catch (err) {
      toast.error(
        "Failed to retry job",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setRetryingId(null);
    }
  }

  function handleEditAndRetry(job: Job) {
    drawer.open({
      mode: "edit",
      library: job.library,
      version: job.version ?? undefined,
    });
  }

  async function handleClearCompleted() {
    const ok = await confirm({
      title: "Clear finished jobs",
      description: (
        <>
          This clears every finished job — <b>completed</b>, <b>cancelled</b>, and{" "}
          <b>failed</b> — from the job list. Active and queued jobs aren&rsquo;t affected.
          This can&rsquo;t be undone.
        </>
      ),
      confirmLabel: "Clear",
    });
    if (!ok) return;
    try {
      const result = await clearCompletedJobs.mutateAsync();
      await utils.getJobs.invalidate();
      toast.success(
        `Cleared ${result.count} finished job${result.count === 1 ? "" : "s"}`,
      );
    } catch (err) {
      toast.error(
        "Failed to clear finished jobs",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return (
    <div>
      <div className="section-head" style={{ marginTop: 4 }}>
        <div>
          <span className="eyebrow">Pipeline</span>
          <h2>Jobs &amp; Queue</h2>
          <p>
            Queue runs first-in, first-out
            {maxConcurrency != null ? ` · ${maxConcurrency} worker slots.` : "."}
          </p>
        </div>
      </div>

      <div className="qstats">
        <Card className="qstat">
          <div className="l">
            <StatusDot variant="run" pulse />
            Running
          </div>
          <div className="n run">{runningJobs.length}</div>
          <div className="sub">
            {maxConcurrency != null ? `of ${maxConcurrency} worker slots` : "active now"}
          </div>
        </Card>
        <Card className="qstat">
          <div className="l">
            <StatusDot variant="queued" />
            Queued
          </div>
          <div className="n">{queuedJobs.length}</div>
          <div className="sub">waiting · FIFO</div>
        </Card>
        <Card className="qstat">
          <div className="l">
            <StatusDot variant="err" />
            Failed
          </div>
          <div className="n err">{failedJobs.length}</div>
          <div className="sub">needs attention</div>
        </Card>
        <Card className="qstat">
          <div className="l">
            <Icon name="i-check" />
            Completed
          </div>
          <div className="n ok">{completedCount}</div>
          <div className="sub">finished jobs</div>
        </Card>
      </div>

      {failedJobs.length > 0 ? (
        <>
          <div className="section-head">
            <div>
              <span className="eyebrow">Needs attention</span>
              <h2>Failed jobs</h2>
            </div>
          </div>
          <Card>
            {failedJobs.map((job) => (
              <FailedJobCard
                key={job.id}
                job={job}
                now={now}
                onRetry={handleRetry}
                onEditAndRetry={handleEditAndRetry}
                retryPending={retryingId === job.id}
              />
            ))}
          </Card>
        </>
      ) : null}

      <div className="section-head">
        <div>
          <span className="eyebrow">Live</span>
          <h2>Active &amp; queued</h2>
        </div>
      </div>
      {activeAndQueued.length === 0 ? (
        <Card>
          <EmptyState
            icon="i-queue"
            title="Nothing running or queued"
            description="Jobs will appear here as soon as they start."
          />
        </Card>
      ) : (
        <Card>
          {runningJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              now={now}
              onCancel={handleCancel}
              cancelPending={cancellingId === job.id}
            />
          ))}
          {cancellingJobs.map((job) => (
            <JobCard key={job.id} job={job} now={now} onCancel={handleCancel} />
          ))}
          {queuedJobs.map((job, index) => (
            <JobCard
              key={job.id}
              job={job}
              position={index + 1}
              now={now}
              onCancel={handleCancel}
              cancelPending={cancellingId === job.id}
            />
          ))}
        </Card>
      )}

      <div className="section-head">
        <div>
          <span className="eyebrow">History</span>
          <h2>Recently finished</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={finishedTotalCount === 0}
          onClick={handleClearCompleted}
        >
          <Icon name="i-trash" size="sm" />
          Clear completed
        </Button>
      </div>
      {finishedJobs.length === 0 ? (
        <Card>
          <EmptyState icon="i-clock" title="No finished jobs yet" />
        </Card>
      ) : (
        <Table>
          <TableHead>
            <tr>
              <Th>Job</Th>
              <Th>Library</Th>
              <Th>Status</Th>
              <Th num>Pages</Th>
              <Th>Duration</Th>
              <Th>Finished</Th>
            </tr>
          </TableHead>
          <TableBody>
            {finishedJobs.map((job) => {
              const pages = job.progressPages ?? job.progress?.pagesScraped ?? 0;
              return (
                <tr key={job.id}>
                  <Td className="mono muted">{job.id}</Td>
                  <Td>
                    <span className="lib-name">{job.library}</span>{" "}
                    <Chip>{job.version || "unversioned"}</Chip>
                  </Td>
                  <Td>{statusPill(job.status)}</Td>
                  <Td num>{pages.toLocaleString()}</Td>
                  <Td className="mono muted">
                    {formatDuration(job.startedAt, job.finishedAt)}
                  </Td>
                  <Td className="muted">{formatRelative(now, job.finishedAt)}</Td>
                </tr>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
