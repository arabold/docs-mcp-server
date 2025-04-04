import * as semver from "semver";
import type { PipelineManager } from "../pipeline/PipelineManager";
import type { DocumentManagementService } from "../store/DocumentManagementService";
import type { ProgressResponse } from "../types"; // Keep for options interface, though onProgress is removed from internal logic
import { logger } from "../utils/logger";

export interface ScrapeToolOptions {
  library: string;
  version?: string | null; // Make version optional
  url: string;
  /** @deprecated Progress reporting should be handled via job status polling or external callbacks. */
  onProgress?: (response: ProgressResponse) => void; // Keep for interface compatibility, but mark deprecated
  options?: {
    maxPages?: number;
    maxDepth?: number;
    subpagesOnly?: boolean;
    maxConcurrency?: number; // Note: Concurrency is now set when PipelineManager is created
    ignoreErrors?: boolean;
  };
  /** If false, returns jobId immediately without waiting. Defaults to true. */
  waitForCompletion?: boolean;
}

export interface ScrapeResult {
  /** Indicates the number of pages scraped if waitForCompletion was true and the job succeeded. May be 0 or inaccurate if job failed or waitForCompletion was false. */
  pagesScraped: number;
}

/** Return type for ScrapeTool.execute */
export type ScrapeExecuteResult = ScrapeResult | { jobId: string };

/**
 * Tool for enqueuing documentation scraping jobs via the PipelineManager.
 */
export class ScrapeTool {
  private docService: DocumentManagementService;
  private manager: PipelineManager; // Add manager property

  constructor(docService: DocumentManagementService, manager: PipelineManager) {
    // Add manager to constructor
    this.docService = docService;
    this.manager = manager; // Store manager instance
  }

  async execute(options: ScrapeToolOptions): Promise<ScrapeExecuteResult> {
    const {
      library,
      version,
      url,
      // onProgress is no longer used internally
      options: scraperOptions,
      waitForCompletion = true,
    } = options;

    // Store initialization and manager start should happen externally

    let internalVersion: string;
    const partialVersionRegex = /^\d+(\.\d+)?$/; // Matches '1' or '1.2'

    if (version === null || version === undefined) {
      internalVersion = "";
    } else {
      const validFullVersion = semver.valid(version);
      if (validFullVersion) {
        internalVersion = validFullVersion;
      } else if (partialVersionRegex.test(version)) {
        const coercedVersion = semver.coerce(version);
        if (coercedVersion) {
          internalVersion = coercedVersion.version;
        } else {
          throw new Error(
            `Invalid version format for scraping: '${version}'. Use 'X.Y.Z', 'X.Y.Z-prerelease', 'X.Y', 'X', or omit.`,
          );
        }
      } else {
        throw new Error(
          `Invalid version format for scraping: '${version}'. Use 'X.Y.Z', 'X.Y.Z-prerelease', 'X.Y', 'X', or omit.`,
        );
      }
    }

    internalVersion = internalVersion.toLowerCase();

    // Remove any existing documents for this library/version
    await this.docService.removeAllDocuments(library, internalVersion);
    logger.info(
      `💾 Cleared store for ${library}@${internalVersion || "[no version]"} before scraping.`,
    );

    // Use the injected manager instance
    const manager = this.manager;

    // Remove internal progress tracking and callbacks
    // let pagesScraped = 0;
    // let lastReportedPages = 0;
    // const reportProgress = ...
    // manager.setCallbacks(...)

    // Enqueue the job using the injected manager
    const jobId = await manager.enqueueJob(library, internalVersion, {
      url: url,
      library: library,
      version: internalVersion,
      subpagesOnly: scraperOptions?.subpagesOnly ?? true,
      maxPages: scraperOptions?.maxPages ?? 100,
      maxDepth: scraperOptions?.maxDepth ?? 3,
      // maxConcurrency is handled by the manager itself now
      ignoreErrors: scraperOptions?.ignoreErrors ?? true,
    });

    logger.info(`🚀 Job ${jobId} enqueued for scraping.`);
    // Report enqueueing via onProgress if provided (for backward compatibility, though deprecated)
    options.onProgress?.({
      content: [{ type: "text", text: `🚀 Job ${jobId} enqueued for scraping.` }],
    });

    // Conditionally wait for completion
    if (waitForCompletion) {
      try {
        await manager.waitForJobCompletion(jobId);
        // Fetch final job state to get status and potentially final page count
        const finalJob = await manager.getJob(jobId);
        const finalPagesScraped = finalJob?.progress?.pagesScraped ?? 0; // Get count from final job state
        logger.info(
          `Job ${jobId} finished with status ${finalJob?.status}. Pages scraped: ${finalPagesScraped}`,
        );
        // Report completion via onProgress if provided
        options.onProgress?.({
          content: [
            {
              type: "text",
              text: `✅ Job ${jobId} completed. Pages scraped: ${finalPagesScraped}`,
            },
          ],
        });
        return {
          pagesScraped: finalPagesScraped,
        };
      } catch (error) {
        logger.error(`Job ${jobId} failed or was cancelled: ${error}`);
        // Report failure via onProgress if provided
        options.onProgress?.({
          content: [
            {
              type: "text",
              text: `❌ Job ${jobId} failed or cancelled: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        });
        throw error; // Re-throw so the caller knows it failed
      }
      // No finally block needed to stop manager, as it's managed externally
    }

    // If not waiting, return the job ID immediately
    return { jobId };
  }
}
