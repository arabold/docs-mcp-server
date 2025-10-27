import type { ScraperService } from "../scraper";
import type { ScraperProgressEvent } from "../scraper/types";
import type { DocumentManagementService } from "../store";
import { logger } from "../utils/logger";
import { CancellationError } from "./errors";
import type { InternalPipelineJob, PipelineManagerCallbacks } from "./types";

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
   * @param callbacks - Callbacks provided by the manager for reporting.
   */
  async executeJob(
    job: InternalPipelineJob,
    callbacks: PipelineManagerCallbacks,
  ): Promise<void> {
    const { id: jobId, library, version, scraperOptions, abortController } = job;
    const signal = abortController.signal;

    logger.debug(`[${jobId}] Worker starting job for ${library}@${version}`);

    try {
      // Clear existing documents for this library/version before scraping
      // Skip this step for refresh operations to preserve existing data
      if (!scraperOptions.isRefresh) {
        await this.store.removeAllDocuments(library, version);
        logger.info(
          `💾 Cleared store for ${library}@${version || "[no version]"} before scraping.`,
        );
      } else {
        logger.info(
          `🔄 Refresh operation - preserving existing data for ${library}@${version || "[no version]"}.`,
        );
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

          // Handle deletion events (404 during refresh or broken links)
          if (progress.deleted && progress.pageId) {
            try {
              await this.store.removeDocumentsByPageId(progress.pageId);
              logger.debug(
                `[${jobId}] Deleted documents for page ${progress.pageId}: ${progress.currentUrl}`,
              );
            } catch (docError) {
              logger.error(
                `❌ [${jobId}] Failed to delete documents for page ${progress.pageId}: ${docError}`,
              );

              // Report the error and fail the job to ensure data integrity
              const error =
                docError instanceof Error ? docError : new Error(String(docError));
              await callbacks.onJobError?.(job, error);
              // Re-throw to fail the job - deletion failures indicate serious database issues
              // and leaving orphaned documents would compromise index accuracy
              throw error;
            }
          }
          // Handle successful content processing
          else if (progress.result) {
            try {
              // For refresh operations, delete old documents before adding new ones
              if (progress.pageId) {
                await this.store.removeDocumentsByPageId(progress.pageId);
                logger.debug(
                  `[${jobId}] Refreshing documents for page ${progress.pageId}: ${progress.currentUrl}`,
                );
              }

              // Add the processed content to the store
              await this.store.addScrapeResult(
                library,
                version,
                progress.depth,
                progress.result,
              );
              logger.debug(`[${jobId}] Stored processed content: ${progress.currentUrl}`);
            } catch (docError) {
              logger.error(
                `❌ [${jobId}] Failed to process content ${progress.currentUrl}: ${docError}`,
              );
              // Report document-specific errors via manager's callback
              await callbacks.onJobError?.(
                job,
                docError instanceof Error ? docError : new Error(String(docError)),
                progress.result,
              );
              // Decide if a single document error should fail the whole job
              // For now, we log and continue. To fail, re-throw here.
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
}
