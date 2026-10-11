import type { ScraperOptions } from "../../scraper/types";
import type { ExistingTargetPolicy } from "../../store/types";
import type { PipelineJob, PipelineJobStatus, PipelineManagerCallbacks } from "../types";

/**
 * The tRPC codes the pipeline router gives enqueue errors a caller can act on:
 * an existing target (409), an invalid library name (400) and an unknown
 * refresh target (404). `PipelineClient` relays exactly these from a remote
 * worker; any other failure keeps its generic wrapping.
 */
export const RELAYED_ENQUEUE_ERROR_CODES = [
  "CONFLICT",
  "BAD_REQUEST",
  "NOT_FOUND",
] as const;

/** One of {@link RELAYED_ENQUEUE_ERROR_CODES}. */
export type RelayedEnqueueErrorCode = (typeof RELAYED_ENQUEUE_ERROR_CODES)[number];

/**
 * Per-request options for enqueueing a scrape job. Deliberately separate from
 * `ScraperOptions`, which is persisted and replayed: an intent stored there would
 * leak into re-index forms and recovery.
 */
export interface EnqueueScrapeOptions {
  /** What to do when the target library or version already exists. Defaults to `"reject-version"`. */
  onExisting?: ExistingTargetPolicy;
}

/**
 * Common interface that both PipelineManager and PipelineClient implement.
 * Uses public PipelineJob interface for API consistency across implementations.
 * Starting and stopping belongs to whoever created the pipeline (see `openBackend`).
 */
export interface IPipeline {
  /**
   * Enqueues a scrape job.
   * @throws {LibraryAlreadyExistsError | VersionAlreadyExistsError} When the target exists and
   *   the policy rejects it (a `TRPCError` with code `CONFLICT` through `PipelineClient`).
   * @throws {InvalidLibraryNameError} When a new library's name fails validation (`BAD_REQUEST`).
   */
  enqueueScrapeJob(
    library: string,
    version: string | undefined | null,
    options: ScraperOptions,
    enqueue?: EnqueueScrapeOptions,
  ): Promise<string>;
  enqueueRefreshJob(
    library: string,
    version: string | undefined | null,
    options?: Pick<ScraperOptions, "preserveHashes">,
  ): Promise<string>;
  getJob(jobId: string): Promise<PipelineJob | undefined>;
  getJobs(status?: PipelineJobStatus): Promise<PipelineJob[]>;
  cancelJob(jobId: string): Promise<void>;
  clearCompletedJobs(): Promise<number>;
  waitForJobCompletion(jobId: string): Promise<void>;
  /**
   * Removes a library version: cancels a queued or running job for it, waits
   * until that job has ended, then removes the version, and the library with its
   * last version. A job enqueued for the same version meanwhile is registered
   * only after the removal is done, so it cannot slip in between.
   */
  removeVersion(library: string, version: string | undefined | null): Promise<void>;
  setCallbacks(callbacks: PipelineManagerCallbacks): void;
}
