import type { ScraperService } from "../scraper";
import {
  PageOutcome,
  type ScrapeResult,
  type ScraperProgressEvent as ScraperProgress,
  type ScraperProgressEvent,
} from "../scraper/types";
import type { DocumentManagementService } from "../store";
import { logger } from "../utils/logger";
import { CancellationError } from "./errors";
import type { InternalPipelineJob } from "./types";

/**
 * Internal callbacks used by PipelineWorker.
 * These work with InternalPipelineJob before conversion to public interface.
 */
interface WorkerCallbacks {
  onJobProgress?: (job: InternalPipelineJob, progress: ScraperProgress) => Promise<void>;
  onJobError?: (
    job: InternalPipelineJob,
    error: Error,
    page?: ScrapeResult,
  ) => Promise<void>;
  onJobStatusChange?: (job: InternalPipelineJob) => Promise<void>;
}

/**
 * Executes a single document processing job.
 * Handles scraping, storing documents, and reporting progress/errors via callbacks.
 */
export class PipelineWorker {
  // Dependencies are passed in, making the worker stateless regarding specific jobs
  private readonly store: DocumentManagementService;
  private readonly scraperService: ScraperService;

  // Constructor accepts dependencies needed for execution
  constructor(store: DocumentManagementService, scraperService: ScraperService) {
    this.store = store;
    this.scraperService = scraperService;
  }

  /**
   * Executes the given pipeline job.
   * @param job - The job to execute.
   * @param callbacks - Internal callbacks provided by the manager for reporting.
   */
  async executeJob(job: InternalPipelineJob, callbacks: WorkerCallbacks): Promise<void> {
    const { id: jobId, library, version, scraperOptions, abortController } = job;
    const signal = abortController.signal;

    logger.debug(`[${jobId}] Worker starting job for ${library}@${version}`);

    try {
      // Clear existing documents for this library/version before scraping
      // Skip this step for refresh operations or if clean is explicitly false
      if (!scraperOptions.isRefresh && scraperOptions.clean !== false) {
        await this.store.removeAllDocuments(library, version);
        logger.info(
          `💾 Cleared store for ${library}@${version || "latest"} before scraping.`,
        );
      } else {
        const message = scraperOptions.isRefresh
          ? `🔄 Refresh operation - preserving existing data for ${library}@${version || "latest"}.`
          : `💾 Appending to store for ${library}@${version || "latest"} (clean=false).`;
        logger.info(message);
      }

      // --- Core Job Logic ---
      await this.scraperService.scrape(
        scraperOptions,
        async (progress: ScraperProgressEvent) => {
          // Check for cancellation signal before processing each document
          if (signal.aborted) {
            throw new CancellationError("Job cancelled during scraping progress");
          }

          // Update job object directly (manager holds the reference)
          // Report progress via manager's callback (single source of truth)
          await callbacks.onJobProgress?.(job, progress);

          // Branch on the reported outcome rather than inferring one from a null
          // result: `Unchanged` and `Empty` both arrive without content but mean
          // opposite things — one says keep what is stored, the other says the
          // page is now empty. The switch is exhaustive, so adding an outcome
          // becomes a compile error here rather than a silent no-op.
          switch (progress.outcome) {
            case PageOutcome.Empty:
              await this.recordEmptyPage(job, callbacks, library, version, progress);
              break;
            case PageOutcome.Absent:
              await this.removeDeletedPage(job, callbacks, progress);
              break;
            case PageOutcome.Stored:
              await this.storeResult(job, callbacks, library, version, progress);
              break;
            // Nothing to persist: unchanged content stays, a skipped resource was
            // never downloaded, and a failure has already been reported. Listed
            // explicitly so this reads as a decision rather than an omission.
            case PageOutcome.Unchanged:
            case PageOutcome.Skipped:
            case PageOutcome.Failed:
              break;
            default: {
              const unhandled: never = progress.outcome;
              logger.error(`❌ [${job.id}] Unhandled page outcome: ${unhandled}`);
            }
          }
        },
        signal, // Pass signal to scraper service
      );
      // --- End Core Job Logic ---

      // Check signal one last time after scrape finishes
      if (signal.aborted) {
        throw new CancellationError("Job cancelled");
      }

      // If successful and not cancelled, the manager will handle status update
      logger.debug(`[${jobId}] Worker finished job successfully.`);
    } catch (error) {
      // Re-throw error to be caught by the manager in _runJob
      logger.warn(`⚠️  [${jobId}] Worker encountered error: ${error}`);
      throw error;
    }
    // Note: The manager (_runJob) is responsible for updating final job status (COMPLETED/FAILED/CANCELLED)
    // and resolving/rejecting the completion promise based on the outcome here.
  }

  // --- Old methods removed ---
  // process()
  // stop()
  // setCallbacks()
  // handleScrapingProgress()

  /**
   * Records a page that exists but holds no content, replacing what was stored.
   *
   * When the pipeline failed rather than genuinely finding nothing, the stored
   * content is left alone: we learned nothing about the page, and overwriting it
   * would discard good content on a transient fault.
   */
  private async recordEmptyPage(
    job: InternalPipelineJob,
    callbacks: WorkerCallbacks,
    library: string,
    version: string,
    progress: ScraperProgressEvent,
  ): Promise<void> {
    const { emptyPage } = progress;
    if (!emptyPage) return; // A container, not a page — nothing to record.

    if (emptyPage.pipelineFailed) {
      logger.debug(
        `[${job.id}] Extraction failed with no content, leaving stored page untouched: ${progress.currentUrl}`,
      );
      return;
    }

    try {
      // A redirect can move a refreshed page to a different URL, in which case
      // `pageId` names the old one and the by-URL cleanup would not reach it.
      // The store retires it as part of the same transaction that decides
      // whether this write lands: deleting it up front would erase a stronger
      // representation before anything could compare the two.
      await this.store.addEmptyPage(
        library,
        version,
        progress.depth,
        {
          url: emptyPage.url,
          contentUrl: emptyPage.contentUrl,
          title: emptyPage.title,
          sourceContentType: emptyPage.sourceContentType,
          contentType: emptyPage.contentType,
          etag: emptyPage.etag,
          lastModified: emptyPage.lastModified,
          isAdditionalRepresentation: emptyPage.isAdditionalRepresentation,
        },
        progress.pageId,
      );
      logger.debug(`[${job.id}] Stored empty page: ${progress.currentUrl}`);
    } catch (docError) {
      logger.error(
        `❌ [${job.id}] Failed to record empty page ${progress.currentUrl}: ${docError}`,
      );
      // Reported like the other persistence paths, so a job cannot complete
      // looking successful while its store write failed.
      await callbacks.onJobError?.(
        job,
        docError instanceof Error ? docError : new Error(String(docError)),
      );
    }
  }

  /**
   * Removes a page the source no longer serves.
   *
   * Only refresh items carry a `pageId`; a broken link found mid-crawl has
   * nothing stored to remove.
   */
  private async removeDeletedPage(
    job: InternalPipelineJob,
    callbacks: WorkerCallbacks,
    progress: ScraperProgressEvent,
  ): Promise<void> {
    if (!progress.deleted || !progress.pageId) return;

    try {
      await this.store.deletePage(progress.pageId);
      logger.debug(`[${job.id}] Deleted page ${progress.pageId}: ${progress.currentUrl}`);
    } catch (docError) {
      logger.error(
        `❌ [${job.id}] Failed to delete page ${progress.pageId}: ${docError}`,
      );
      const error = docError instanceof Error ? docError : new Error(String(docError));
      await callbacks.onJobError?.(job, error);
      // Deletion failures indicate serious database issues, and leaving orphaned
      // documents would compromise index accuracy.
      throw error;
    }
  }

  /**
   * Stores processed content, replacing the page's previous content on refresh.
   */
  private async storeResult(
    job: InternalPipelineJob,
    callbacks: WorkerCallbacks,
    library: string,
    version: string,
    progress: ScraperProgressEvent,
  ): Promise<void> {
    if (!progress.result) return;

    try {
      // The old row is retired inside the store's write transaction rather than
      // here. Deleting it first would hide it from the precedence check, so a
      // refresh that re-fetches both representations of one page would keep
      // whichever finished last instead of the better one.
      await this.store.addScrapeResult(
        library,
        version,
        progress.depth,
        progress.result,
        progress.pageId,
      );
      logger.debug(`[${job.id}] Stored processed content: ${progress.currentUrl}`);
    } catch (docError) {
      logger.error(
        `❌ [${job.id}] Failed to process content ${progress.currentUrl}: ${docError}`,
      );
      // A single document error is logged and the job continues.
      await callbacks.onJobError?.(
        job,
        docError instanceof Error ? docError : new Error(String(docError)),
        progress.result,
      );
    }
  }
}
