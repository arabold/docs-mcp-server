/**
 * PipelineManager orchestrates a queue of scraping/indexing jobs.
 * - Controls concurrency, recovery, and job lifecycle
 * - Bridges in-memory job state with the persistent store
 * - Delegates execution to PipelineWorker and emits callbacks
 * Note: completionPromise has an attached no-op catch to avoid unhandled
 * promise rejection warnings when a job fails before a consumer awaits it.
 */

import { v4 as uuidv4 } from "uuid";
import type { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import { ScraperRegistry, ScraperService } from "../scraper";
import type { ScraperOptions, ScraperProgressEvent } from "../scraper/types";
import type { DocumentManagementService } from "../store";
import { VersionStatus } from "../store/types";
import { DEFAULT_MAX_CONCURRENCY } from "../utils/config";
import { logger } from "../utils/logger";
import { CancellationError, PipelineStateError } from "./errors";
import { PipelineWorker } from "./PipelineWorker"; // Import the worker
import type { IPipeline } from "./trpc/interfaces";
import type { InternalPipelineJob, PipelineJob } from "./types";
import { PipelineJobStatus } from "./types";

/**
 * Manages a queue of document processing jobs, controlling concurrency and tracking progress.
 */
export class PipelineManager implements IPipeline {
  private jobMap: Map<string, InternalPipelineJob> = new Map();
  private jobQueue: string[] = [];
  private activeWorkers: Set<string> = new Set();
  private isRunning = false;
  private concurrency: number;
  private store: DocumentManagementService;
  private scraperService: ScraperService;
  private shouldRecoverJobs: boolean;
  private eventBus: EventBusService;

  constructor(
    store: DocumentManagementService,
    eventBus: EventBusService,
    concurrency: number = DEFAULT_MAX_CONCURRENCY,
    options: { recoverJobs?: boolean } = {},
  ) {
    this.store = store;
    this.eventBus = eventBus;
    this.concurrency = concurrency;
    this.shouldRecoverJobs = options.recoverJobs ?? true; // Default to true for backward compatibility
    // ScraperService needs a registry. We create one internally for the manager.
    const registry = new ScraperRegistry();
    this.scraperService = new ScraperService(registry);
  }

  /**
   * No-op method for backward compatibility with IPipeline interface.
   * Events are now emitted directly to EventBusService.
   */
  setCallbacks(_callbacks: unknown): void {
    // No-op: callbacks are no longer used
  }

  /**
   * Converts internal job representation to public job interface.
   */
  private toPublicJob(job: InternalPipelineJob): PipelineJob {
    return {
      id: job.id,
      library: job.library,
      version: job.version || null, // Convert empty string to null for public API
      status: job.status,
      progress: job.progress,
      error: job.error ? { message: job.error.message } : null,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      versionId: job.versionId,
      versionStatus: job.versionStatus,
      progressPages: job.progressPages,
      progressMaxPages: job.progressMaxPages,
      errorMessage: job.errorMessage,
      updatedAt: job.updatedAt,
      sourceUrl: job.sourceUrl,
      scraperOptions: job.scraperOptions,
    };
  }

  /**
   * Starts the pipeline manager's worker processing.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("⚠️  PipelineManager is already running.");
      return;
    }
    this.isRunning = true;
    logger.debug(
      `PipelineManager started with concurrency ${this.concurrency}, recoverJobs: ${this.shouldRecoverJobs}.`,
    );

    // Recover pending jobs from database on startup only if enabled
    if (this.shouldRecoverJobs) {
      await this.recoverPendingJobs();
    } else {
      logger.debug("Job recovery disabled for this PipelineManager instance");
    }

    this._processQueue().catch((error) => {
      logger.error(`❌ Error in processQueue during start: ${error}`);
    }); // Start processing any existing jobs
  }

  /**
   * Recovers pending jobs from the database after server restart.
   * Finds versions with RUNNING status and resets them to QUEUED for re-processing.
   * Also loads all QUEUED versions back into the pipeline queue.
   */
  async recoverPendingJobs(): Promise<void> {
    try {
      // Reset RUNNING jobs to QUEUED (they were interrupted by server restart)
      const runningVersions = await this.store.getVersionsByStatus([
        VersionStatus.RUNNING,
      ]);
      for (const version of runningVersions) {
        await this.store.updateVersionStatus(version.id, VersionStatus.QUEUED);
        logger.info(
          `🔄 Reset interrupted job to QUEUED: ${version.library_name}@${version.name || "unversioned"}`,
        );
      }

      // Load all QUEUED versions back into pipeline
      const queuedVersions = await this.store.getVersionsByStatus([VersionStatus.QUEUED]);
      for (const version of queuedVersions) {
        // Create complete job with all database state restored
        const jobId = uuidv4();
        const abortController = new AbortController();
        let resolveCompletion!: () => void;
        let rejectCompletion!: (reason?: unknown) => void;

        const completionPromise = new Promise<void>((resolve, reject) => {
          resolveCompletion = resolve;
          rejectCompletion = reject;
        });
        // Prevent unhandled rejection warnings if rejection occurs before consumers attach handlers
        completionPromise.catch(() => {});

        // Parse stored scraper options
        let parsedScraperOptions = null;
        if (version.scraper_options) {
          try {
            parsedScraperOptions = JSON.parse(version.scraper_options);
          } catch (error) {
            logger.warn(
              `⚠️ Failed to parse scraper options for ${version.library_name}@${version.name || "unversioned"}: ${error}`,
            );
          }
        }

        const job: InternalPipelineJob = {
          id: jobId,
          library: version.library_name,
          version: version.name || "",
          status: PipelineJobStatus.QUEUED,
          progress: null,
          error: null,
          createdAt: new Date(version.created_at),
          // For recovered QUEUED jobs, startedAt must be null to reflect queued state.
          startedAt: null,
          finishedAt: null,
          abortController,
          completionPromise,
          resolveCompletion,
          rejectCompletion,

          // Database fields (single source of truth)
          versionId: version.id,
          versionStatus: version.status,
          progressPages: version.progress_pages,
          progressMaxPages: version.progress_max_pages,
          errorMessage: version.error_message,
          updatedAt: new Date(version.updated_at),
          sourceUrl: version.source_url,
          scraperOptions: parsedScraperOptions,
        };

        this.jobMap.set(jobId, job);
        this.jobQueue.push(jobId);
      }

      if (queuedVersions.length > 0) {
        logger.info(`📥 Recovered ${queuedVersions.length} pending job(s) from database`);
      } else {
        logger.debug("No pending jobs to recover from database");
      }
    } catch (error) {
      logger.error(`❌ Failed to recover pending jobs: ${error}`);
    }
  }

  /**
   * Stops the pipeline manager and attempts to gracefully shut down workers.
   * Currently, it just stops processing new jobs. Cancellation of active jobs
   * needs explicit `cancelJob` calls.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn("⚠️  PipelineManager is not running.");
      return;
    }
    this.isRunning = false;
    logger.debug("PipelineManager stopping. No new jobs will be started.");

    // Cleanup scraper service to prevent resource leaks
    await this.scraperService.cleanup();

    // Note: Does not automatically cancel active jobs.
  }

  /**
   * Enqueues a new document processing job, aborting any existing QUEUED/RUNNING job for the same library+version (including unversioned).
   */
  async enqueueScrapeJob(
    library: string,
    version: string | undefined | null,
    options: ScraperOptions,
  ): Promise<string> {
    // Normalize version: treat undefined/null as "" (unversioned)
    const normalizedVersion = version ?? "";

    // Abort any existing QUEUED or RUNNING job for the same library+version
    const allJobs = await this.getJobs();
    const duplicateJobs = allJobs.filter(
      (job) =>
        job.library === library &&
        (job.version ?? "") === normalizedVersion && // Normalize null to empty string for comparison
        [PipelineJobStatus.QUEUED, PipelineJobStatus.RUNNING].includes(job.status),
    );
    for (const job of duplicateJobs) {
      logger.info(
        `🚫 Aborting duplicate job for ${library}@${normalizedVersion}: ${job.id}`,
      );
      await this.cancelJob(job.id);
    }

    const jobId = uuidv4();
    const abortController = new AbortController();
    let resolveCompletion!: () => void;
    let rejectCompletion!: (reason?: unknown) => void;

    const completionPromise = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    // Prevent unhandled rejection warnings if rejection occurs before consumers attach handlers
    completionPromise.catch(() => {});

    const job: InternalPipelineJob = {
      id: jobId,
      library,
      version: normalizedVersion,
      status: PipelineJobStatus.QUEUED,
      progress: null,
      error: null,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
      abortController,
      completionPromise,
      resolveCompletion,
      rejectCompletion,
      // Database fields (single source of truth)
      // Will be populated by updateJobStatus
      progressPages: 0,
      progressMaxPages: 0,
      errorMessage: null,
      updatedAt: new Date(),
      sourceUrl: options.url,
      scraperOptions: options,
    };

    this.jobMap.set(jobId, job);
    this.jobQueue.push(jobId);
    logger.info(
      `📝 Job enqueued: ${jobId} for ${library}${normalizedVersion ? `@${normalizedVersion}` : " (unversioned)"}`,
    );

    // Update database status to QUEUED
    await this.updateJobStatus(job, PipelineJobStatus.QUEUED);

    // Trigger processing if manager is running
    if (this.isRunning) {
      this._processQueue().catch((error) => {
        logger.error(`❌ Error in processQueue during enqueue: ${error}`);
      });
    }

    return jobId;
  }

  /**
   * Enqueues a refresh job for an existing library version by re-scraping all pages
   * and using ETag comparison to skip unchanged content.
   *
   * If the version was never completed (interrupted or failed scrape), performs a
   * full re-scrape from scratch instead of a refresh to ensure completeness.
   */
  async enqueueRefreshJob(
    library: string,
    version: string | undefined | null,
  ): Promise<string> {
    // Normalize version: treat undefined/null as "" (unversioned)
    const normalizedVersion = version ?? "";

    try {
      // First, check if the library version exists
      const versionId = await this.store.ensureVersion({
        library,
        version: normalizedVersion,
      });

      // Check the version's status to detect incomplete scrapes
      const versionInfo = await this.store.getVersionById(versionId);
      if (!versionInfo) {
        throw new Error(`Version ID ${versionId} not found`);
      }

      // Get library information
      const libraryInfo = await this.store.getLibraryById(versionInfo.library_id);
      if (!libraryInfo) {
        throw new Error(`Library ID ${versionInfo.library_id} not found`);
      }

      // If the version is not completed, it means the previous scrape was interrupted
      // or failed. In this case, perform a full re-scrape instead of a refresh.
      if (versionInfo && versionInfo.status !== VersionStatus.COMPLETED) {
        logger.info(
          `⚠️  Version ${library}@${normalizedVersion || "unversioned"} has status "${versionInfo.status}". Performing full re-scrape instead of refresh.`,
        );
        return this.enqueueJobWithStoredOptions(library, normalizedVersion);
      }

      // Get all pages for this version with their ETags and depths
      const pages = await this.store.getPagesByVersionId(versionId);

      // Debug: Log first page to see what data we're getting
      if (pages.length > 0) {
        logger.debug(
          `Sample page data: url=${pages[0].url}, etag=${pages[0].etag}, depth=${pages[0].depth}`,
        );
      }

      if (pages.length === 0) {
        throw new Error(
          `No pages found for ${library}@${normalizedVersion || "unversioned"}. Use scrape_docs to index it first.`,
        );
      }

      logger.info(
        `🔄 Preparing refresh job for ${library}@${normalizedVersion || "unversioned"} with ${pages.length} page(s)`,
      );

      // Build initialQueue from pages with original depth values
      const initialQueue = pages.map((page) => ({
        url: page.url,
        depth: page.depth ?? 0, // Use original depth, fallback to 0 for old data
        pageId: page.id,
        etag: page.etag,
      }));

      // Get stored scraper options to retrieve the source URL and other options
      const storedOptions = await this.store.getScraperOptions(versionId);

      // Build scraper options with initialQueue and isRefresh flag
      const scraperOptions = {
        url: storedOptions?.sourceUrl || pages[0].url, // Required but not used when initialQueue is set
        library,
        version: normalizedVersion,
        ...(storedOptions?.options || {}), // Include stored options if available (spread first)
        // Override with refresh-specific options (these must come after the spread)
        initialQueue, // Pre-populated queue with existing pages
        isRefresh: true, // Mark this as a refresh operation
      };

      // Enqueue as a standard scrape job with the initialQueue
      logger.info(
        `📝 Enqueueing refresh job for ${library}@${normalizedVersion || "unversioned"}`,
      );
      return this.enqueueScrapeJob(library, normalizedVersion, scraperOptions);
    } catch (error) {
      logger.error(`❌ Failed to enqueue refresh job: ${error}`);
      throw error;
    }
  }

  /**
   * Enqueues a job using stored scraper options from a previous indexing run.
   * If no stored options are found, throws an error.
   */
  async enqueueJobWithStoredOptions(
    library: string,
    version: string | undefined | null,
  ): Promise<string> {
    const normalizedVersion = version ?? "";

    try {
      // Get the version ID to retrieve stored options
      const versionId = await this.store.ensureVersion({
        library,
        version: normalizedVersion,
      });
      const stored = await this.store.getScraperOptions(versionId);

      if (!stored) {
        throw new Error(
          `No stored scraper options found for ${library}@${normalizedVersion || "unversioned"}`,
        );
      }

      const storedOptions = stored.options;

      // Reconstruct complete scraper options
      const completeOptions: ScraperOptions = {
        url: stored.sourceUrl,
        library,
        version: normalizedVersion,
        ...storedOptions,
      };

      logger.info(
        `🔄 Re-indexing ${library}@${normalizedVersion || "unversioned"} with stored options from ${stored.sourceUrl}`,
      );

      return this.enqueueScrapeJob(library, normalizedVersion, completeOptions);
    } catch (error) {
      logger.error(`❌ Failed to enqueue job with stored options: ${error}`);
      throw error;
    }
  }

  /**
   * Retrieves the current state of a specific job.
   */
  async getJob(jobId: string): Promise<PipelineJob | undefined> {
    const internalJob = this.jobMap.get(jobId);
    return internalJob ? this.toPublicJob(internalJob) : undefined;
  }

  /**
   * Retrieves the current state of all jobs (or a subset based on status).
   */
  async getJobs(status?: PipelineJobStatus): Promise<PipelineJob[]> {
    const allJobs = Array.from(this.jobMap.values());
    const filteredJobs = status
      ? allJobs.filter((job) => job.status === status)
      : allJobs;
    return filteredJobs.map((job) => this.toPublicJob(job));
  }

  /**
   * Returns a promise that resolves when the specified job completes, fails, or is cancelled.
   * For cancelled jobs, this resolves successfully rather than rejecting.
   */
  async waitForJobCompletion(jobId: string): Promise<void> {
    const job = this.jobMap.get(jobId);
    if (!job) {
      throw new PipelineStateError(`Job not found: ${jobId}`);
    }

    try {
      await job.completionPromise;
    } catch (error) {
      // If the job was cancelled, treat it as successful completion
      if (
        error instanceof CancellationError ||
        job.status === PipelineJobStatus.CANCELLED
      ) {
        return; // Resolve successfully for cancelled jobs
      }
      // Re-throw other errors (failed jobs)
      throw error;
    }
  }

  /**
   * Attempts to cancel a queued or running job.
   */
  async cancelJob(jobId: string): Promise<void> {
    const job = this.jobMap.get(jobId);
    if (!job) {
      logger.warn(`❓ Attempted to cancel non-existent job: ${jobId}`);
      return;
    }

    switch (job.status) {
      case PipelineJobStatus.QUEUED:
        // Remove from queue and mark as cancelled
        this.jobQueue = this.jobQueue.filter((id) => id !== jobId);
        await this.updateJobStatus(job, PipelineJobStatus.CANCELLED);
        job.finishedAt = new Date();
        logger.info(`🚫 Job cancelled (was queued): ${jobId}`);
        job.rejectCompletion(new PipelineStateError("Job cancelled before starting"));
        break;

      case PipelineJobStatus.RUNNING:
        // Signal cancellation via AbortController
        await this.updateJobStatus(job, PipelineJobStatus.CANCELLING);
        job.abortController.abort();
        logger.info(`🚫 Signalling cancellation for running job: ${jobId}`);
        // The worker is responsible for transitioning to CANCELLED and rejecting
        break;

      case PipelineJobStatus.COMPLETED:
      case PipelineJobStatus.FAILED:
      case PipelineJobStatus.CANCELLED:
      case PipelineJobStatus.CANCELLING:
        logger.warn(
          `⚠️  Job ${jobId} cannot be cancelled in its current state: ${job.status}`,
        );
        break;

      default:
        logger.error(`❌ Unhandled job status for cancellation: ${job.status}`);
        break;
    }
  }

  /**
   * Removes all jobs that are in a final state (completed, cancelled, or failed).
   * Only removes jobs that are not currently in the queue or actively running.
   * @returns The number of jobs that were cleared.
   */
  async clearCompletedJobs(): Promise<number> {
    const completedStatuses = [
      PipelineJobStatus.COMPLETED,
      PipelineJobStatus.CANCELLED,
      PipelineJobStatus.FAILED,
    ];

    let clearedCount = 0;
    const jobsToRemove: string[] = [];

    // Find all jobs that can be cleared
    for (const [jobId, job] of this.jobMap.entries()) {
      if (completedStatuses.includes(job.status)) {
        jobsToRemove.push(jobId);
        clearedCount++;
      }
    }

    // Remove the jobs from the map
    for (const jobId of jobsToRemove) {
      this.jobMap.delete(jobId);
    }

    if (clearedCount > 0) {
      logger.info(`🧹 Cleared ${clearedCount} completed job(s) from the queue`);
    } else {
      logger.debug("No completed jobs to clear");
    }

    return clearedCount;
  }

  // --- Private Methods ---

  /**
   * Processes the job queue, starting new workers if capacity allows.
   */
  private async _processQueue(): Promise<void> {
    if (!this.isRunning) return;

    while (this.activeWorkers.size < this.concurrency && this.jobQueue.length > 0) {
      const jobId = this.jobQueue.shift();
      if (!jobId) continue; // Should not happen, but safety check

      const job = this.jobMap.get(jobId);
      if (!job || job.status !== PipelineJobStatus.QUEUED) {
        logger.warn(`⏭️ Skipping job ${jobId} in queue (not found or not queued).`);
        continue;
      }

      this.activeWorkers.add(jobId);
      await this.updateJobStatus(job, PipelineJobStatus.RUNNING);
      job.startedAt = new Date();

      // Start the actual job execution asynchronously
      this._runJob(job).catch(async (error) => {
        // Catch unexpected errors during job setup/execution not handled by _runJob itself
        logger.error(`❌ Unhandled error during job ${jobId} execution: ${error}`);
        if (
          job.status !== PipelineJobStatus.FAILED &&
          job.status !== PipelineJobStatus.CANCELLED
        ) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await this.updateJobStatus(job, PipelineJobStatus.FAILED, errorMessage);
          job.error = error instanceof Error ? error : new Error(String(error));
          job.finishedAt = new Date();
          job.rejectCompletion(job.error);
        }
        this.activeWorkers.delete(jobId);
        this._processQueue().catch((error) => {
          logger.error(`❌ Error in processQueue after job completion: ${error}`);
        }); // Check if another job can start
      });
    }
  }

  /**
   * Executes a single pipeline job by delegating to a PipelineWorker.
   * Handles final status updates and promise resolution/rejection.
   */
  private async _runJob(job: InternalPipelineJob): Promise<void> {
    const { id: jobId, abortController } = job;
    const signal = abortController.signal; // Get signal for error checking

    // Instantiate a worker for this job.
    // Dependencies (store, scraperService) are held by the manager.
    const worker = new PipelineWorker(this.store, this.scraperService);

    try {
      // Delegate the actual work to the worker
      // The worker works with InternalPipelineJob, we convert to public when needed
      await worker.executeJob(job, {
        onJobProgress: async (internalJob, progress) => {
          await this.updateJobProgress(internalJob, progress);
        },
        onJobError: async (internalJob, error, document) => {
          // Log job errors
          logger.warn(
            `⚠️ Job ${internalJob.id} error ${document ? `on document ${document.url}` : ""}: ${error.message}`,
          );
        },
      });

      // If executeJob completes without throwing, and we weren't cancelled meanwhile...
      if (signal.aborted) {
        // Check signal again in case cancellation happened *during* the very last await in executeJob
        throw new CancellationError("Job cancelled just before completion");
      }

      // Mark as completed
      await this.updateJobStatus(job, PipelineJobStatus.COMPLETED);
      job.finishedAt = new Date();
      job.resolveCompletion();

      logger.info(`✅ Job completed: ${jobId}`);
    } catch (error) {
      // Handle errors thrown by the worker, including CancellationError
      if (error instanceof CancellationError || signal.aborted) {
        // Explicitly check for CancellationError or if the signal was aborted
        await this.updateJobStatus(job, PipelineJobStatus.CANCELLED);
        job.finishedAt = new Date();
        // Don't set job.error for cancellations - cancellation is not an error condition
        const cancellationError =
          error instanceof CancellationError
            ? error
            : new CancellationError("Job cancelled by signal");
        logger.info(`🚫 Job execution cancelled: ${jobId}: ${cancellationError.message}`);
        job.rejectCompletion(cancellationError);
      } else {
        // Handle other errors
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.updateJobStatus(job, PipelineJobStatus.FAILED, errorMessage);
        job.error = error instanceof Error ? error : new Error(String(error));
        job.finishedAt = new Date();
        logger.error(`❌ Job failed: ${jobId}: ${job.error}`);
        job.rejectCompletion(job.error);
      }
    } finally {
      // Ensure worker slot is freed and queue processing continues
      this.activeWorkers.delete(jobId);
      this._processQueue().catch((error) => {
        logger.error(`❌ Error in processQueue after job cleanup: ${error}`);
      });
    }
  }

  /**
   * Maps PipelineJobStatus to VersionStatus for database storage.
   */
  private mapJobStatusToVersionStatus(jobStatus: PipelineJobStatus): VersionStatus {
    switch (jobStatus) {
      case PipelineJobStatus.QUEUED:
        return VersionStatus.QUEUED;
      case PipelineJobStatus.RUNNING:
        return VersionStatus.RUNNING;
      case PipelineJobStatus.COMPLETED:
        return VersionStatus.COMPLETED;
      case PipelineJobStatus.FAILED:
        return VersionStatus.FAILED;
      case PipelineJobStatus.CANCELLED:
        return VersionStatus.CANCELLED;
      case PipelineJobStatus.CANCELLING:
        return VersionStatus.RUNNING; // Keep as running in DB until actually cancelled
      default:
        return VersionStatus.NOT_INDEXED;
    }
  }

  /**
   * Updates both in-memory job status and database version status (write-through).
   */
  private async updateJobStatus(
    job: InternalPipelineJob,
    newStatus: PipelineJobStatus,
    errorMessage?: string,
  ): Promise<void> {
    // Update in-memory status
    job.status = newStatus;
    if (errorMessage) {
      job.errorMessage = errorMessage;
    }
    job.updatedAt = new Date();

    // Update database status
    try {
      // Ensure the library and version exist and get the version ID
      const versionId = await this.store.ensureLibraryAndVersion(
        job.library,
        job.version,
      );

      // Update job object with database fields (single source of truth)
      job.versionId = versionId;
      job.versionStatus = this.mapJobStatusToVersionStatus(newStatus);

      const dbStatus = this.mapJobStatusToVersionStatus(newStatus);
      await this.store.updateVersionStatus(versionId, dbStatus, errorMessage);

      // Store scraper options when job is first queued
      if (newStatus === PipelineJobStatus.QUEUED && job.scraperOptions) {
        try {
          // Pass the complete scraper options (DocumentStore will filter runtime fields)
          await this.store.storeScraperOptions(versionId, job.scraperOptions);
          logger.debug(
            `Stored scraper options for ${job.library}@${job.version}: ${job.sourceUrl}`,
          );
        } catch (optionsError) {
          // Log warning but don't fail the job - options storage is not critical
          logger.warn(
            `⚠️ Failed to store scraper options for job ${job.id}: ${optionsError}`,
          );
        }
      }
    } catch (error) {
      logger.error(`❌ Failed to update database status for job ${job.id}: ${error}`);
      // Don't throw - we don't want to break the pipeline for database issues
    }

    // Emit events to EventBusService
    const publicJob = this.toPublicJob(job);

    this.eventBus.emit(EventType.JOB_STATUS_CHANGE, publicJob);
    this.eventBus.emit(EventType.LIBRARY_CHANGE, undefined);

    // Logging
    logger.debug(`Job ${job.id} status changed to: ${job.status}`);
  }

  /**
   * Updates both in-memory job progress and database progress (write-through).
   * Also emits progress events to the EventBusService.
   */
  async updateJobProgress(
    job: InternalPipelineJob,
    progress: ScraperProgressEvent,
  ): Promise<void> {
    // Update in-memory progress
    job.progress = progress;
    job.progressPages = progress.pagesScraped;
    job.progressMaxPages = progress.totalPages;
    job.updatedAt = new Date();

    // Update database progress if we have a version ID
    if (job.versionId) {
      try {
        await this.store.updateVersionProgress(
          job.versionId,
          progress.pagesScraped,
          progress.totalPages,
        );
      } catch (error) {
        logger.error(`❌ Failed to update database progress for job ${job.id}: ${error}`);
        // Don't throw - we don't want to break the pipeline for database issues
      }
    }

    // Emit progress event to EventBusService
    const publicJob = this.toPublicJob(job);

    this.eventBus.emit(EventType.JOB_PROGRESS, { job: publicJob, progress });

    // Logging
    logger.debug(
      `Job ${job.id} progress: ${progress.pagesScraped}/${progress.totalPages} pages`,
    );
  }
}
