import type { ScraperOptions, ScraperProgressEvent } from "../scraper/types";
import type { VersionStatus } from "../store/types";

/**
 * Represents the possible states of a pipeline job.
 */
export enum PipelineJobStatus {
  QUEUED = "queued",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLING = "cancelling",
  CANCELLED = "cancelled",
}

/**
 * What a pipeline does when it starts with versions that an earlier run left
 * RUNNING or QUEUED:
 * - `recover`: runs them again as refresh jobs.
 * - `fail`: marks them FAILED, so users can retry them.
 * - `leave`: changes nothing, for a command that runs only its own job while
 *   the process that hosts the store handles the rest.
 */
export type InterruptedJobs = "recover" | "fail" | "leave";

/**
 * Public interface for pipeline jobs exposed through API boundaries.
 * Contains only serializable fields suitable for JSON transport.
 */
export interface PipelineJob {
  /** Unique identifier for the job. */
  id: string;
  /** The library name associated with the job. */
  library: string;
  /** The library version associated with the job. */
  version: string | null;
  /** Current pipeline status of the job. */
  status: PipelineJobStatus;
  /** Detailed progress information. */
  progress: ScraperProgressEvent | null;
  /** Error information if the job failed. */
  error: { message: string } | null;
  /** Timestamp when the job was created. */
  createdAt: Date;
  /** Timestamp when the job started running. */
  startedAt: Date | null;
  /** Timestamp when the job finished (completed, failed, or cancelled). */
  finishedAt: Date | null;
  /** Database version ID for direct updates. */
  versionId?: number;
  /** Database version status (authoritative). */
  versionStatus?: VersionStatus;
  /** Items dequeued and given an outcome. */
  progressPages?: number;
  /**
   * Items this job expects to process — queued URLs clamped at the stopping
   * point. NOT the configured `maxPages` value, despite the name.
   */
  progressMaxPages?: number;
  /** Items that produced stored content. Null for jobs predating this counter. */
  progressPagesIndexed?: number | null;
  /** Database error message (more detailed than Error object). */
  errorMessage?: string | null;
  /** Last update timestamp from database. */
  updatedAt?: Date;
  /** Original scraping URL. */
  sourceUrl: string | null;
  /** Stored scraper options for reproducibility. */
  scraperOptions: ScraperOptions | null;
}

/**
 * Internal pipeline job representation used within PipelineManager.
 * Contains non-serializable fields for job management and control.
 *
 * Note: scraperOptions is required (non-nullable) for internal jobs as they
 * always have complete runtime configuration available.
 */
export interface InternalPipelineJob
  extends Omit<PipelineJob, "version" | "error" | "scraperOptions" | "versionId"> {
  /** The library version associated with the job (internal uses string). */
  version: string;
  /** Database version ID, claimed when the job is enqueued. */
  versionId: number;
  /** Error object if the job failed. */
  error: Error | null;
  /** Complete scraper options with runtime configuration. */
  scraperOptions: ScraperOptions;
  /** AbortController to signal cancellation. */
  abortController: AbortController;
  /** Promise that resolves/rejects when the job finishes. */
  completionPromise: Promise<void>;
  /** Resolver function for the completion promise. */
  resolveCompletion: () => void;
  /** Rejector function for the completion promise. */
  rejectCompletion: (reason?: unknown) => void;
}
