import type {
  ScrapeResult,
  ScraperOptions,
  ScraperProgressEvent,
} from "../scraper/types";
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

/** Classification of a finished scrape job's usefulness, beyond raw success/failure. */
export enum ScrapeOutcome {
  INDEXED = "indexed",
  EMPTY = "empty",
  THIN = "thin",
  DEGENERATE = "degenerate",
  FAILED = "failed",
}

/** Machine-readable reason a job failed a quality gate, with caller remediation. */
export enum ScrapeErrorCode {
  EMPTY_RESULT = "EMPTY_RESULT",
  THIN_RESULT = "THIN_RESULT",
  OFF_TOPIC = "OFF_TOPIC",
  SCOPE_DRIFT = "SCOPE_DRIFT",
  LOCALE_REDIRECT_LOOP = "LOCALE_REDIRECT_LOOP",
  GITHUB_SUBPATH_NOT_FOUND = "GITHUB_SUBPATH_NOT_FOUND",
}

/** Counters collected when a job finishes, fed into the quality gate. */
export interface JobOutcomeMetrics {
  /** Number of stored chunks for the (library, version). */
  documentCount: number;
  /** Number of distinct indexed URLs. */
  distinctUrls: number;
  /** Pages the scraper reported processing. */
  pagesScraped: number;
  /** Fraction (0..1) of indexed URLs under the requested root path. undefined if not computed. */
  inScopeUrlRatio?: number;
  /** Whether sampled chunks matched `expectTerms`. undefined when no expectTerms given. */
  expectTermsMatched?: boolean;
}

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
  /** Current number of pages processed. */
  progressPages?: number;
  /** Maximum number of pages to process. */
  progressMaxPages?: number;
  /** Database error message (more detailed than Error object). */
  errorMessage?: string | null;
  /** Last update timestamp from database. */
  updatedAt?: Date;
  /** Original scraping URL. */
  sourceUrl: string | null;
  /** Stored scraper options for reproducibility. */
  scraperOptions: ScraperOptions | null;
  /** Quality classification of the finished job (undefined while running). */
  outcome?: ScrapeOutcome;
  /** Typed reason when the job failed a quality gate. */
  errorCode?: ScrapeErrorCode;
}

/**
 * Internal pipeline job representation used within PipelineManager.
 * Contains non-serializable fields for job management and control.
 *
 * Note: scraperOptions is required (non-nullable) for internal jobs as they
 * always have complete runtime configuration available.
 */
export interface InternalPipelineJob
  extends Omit<PipelineJob, "version" | "error" | "scraperOptions"> {
  /** The library version associated with the job (internal uses string). */
  version: string;
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

/**
 * Defines the structure for callback functions used with the PipelineManager.
 * Allows external components to hook into job lifecycle events.
 * All callbacks receive the public PipelineJob representation to maintain
 * clean separation between internal implementation and external API.
 */
export interface PipelineManagerCallbacks {
  /** Callback triggered when a job's status changes. */
  onJobStatusChange?: (job: PipelineJob) => Promise<void>;
  /** Callback triggered when a job makes progress. */
  onJobProgress?: (job: PipelineJob, progress: ScraperProgressEvent) => Promise<void>;
  /** Callback triggered when a job encounters an error during processing (e.g., storing a doc). */
  onJobError?: (job: PipelineJob, error: Error, page?: ScrapeResult) => Promise<void>;
}
