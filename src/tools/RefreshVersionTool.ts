import * as semver from "semver";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import { logger } from "../utils/logger";
import { ValidationError } from "./errors";

export interface RefreshVersionToolOptions {
  library: string;
  version?: string | null; // Make version optional
  /** If false, returns jobId immediately without waiting. Defaults to true. */
  waitForCompletion?: boolean;
}

export interface RefreshResult {
  /** Indicates the number of pages refreshed if waitForCompletion was true and the job succeeded. May be 0 or inaccurate if job failed or waitForCompletion was false. */
  pagesRefreshed: number;
}

/** Return type for RefreshVersionTool.execute */
export type RefreshExecuteResult = RefreshResult | { jobId: string };

/**
 * Tool for refreshing an existing library version by re-scraping all pages
 * and using Etag comparison to skip unchanged content.
 */
export class RefreshVersionTool {
  private pipeline: IPipeline;

  constructor(pipeline: IPipeline) {
    this.pipeline = pipeline;
  }

  async execute(options: RefreshVersionToolOptions): Promise<RefreshExecuteResult> {
    const { library, version, waitForCompletion = true } = options;

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
          throw new ValidationError(
            `Invalid version format for refreshing: '${version}'. Use 'X.Y.Z', 'X.Y.Z-prerelease', 'X.Y', 'X', or omit.`,
            "RefreshVersionTool",
          );
        }
      } else {
        throw new ValidationError(
          `Invalid version format for refreshing: '${version}'. Use 'X.Y.Z', 'X.Y.Z-prerelease', 'X.Y', 'X', or omit.`,
          "RefreshVersionTool",
        );
      }
    }

    internalVersion = internalVersion.toLowerCase();

    // Use the injected pipeline instance
    const pipeline = this.pipeline;

    // Normalize pipeline version argument: use null for unversioned to be explicit cross-platform
    const refreshVersion: string | null = internalVersion === "" ? null : internalVersion;

    // Enqueue the refresh job using the injected pipeline
    const jobId = await pipeline.enqueueRefreshJob(library, refreshVersion);

    // Conditionally wait for completion
    if (waitForCompletion) {
      try {
        await pipeline.waitForJobCompletion(jobId);
        // Fetch final job state to get status and potentially final page count
        const finalJob = await pipeline.getJob(jobId);
        const finalPagesRefreshed = finalJob?.progress?.pagesScraped ?? 0; // Get count from final job state
        logger.debug(
          `Refresh job ${jobId} finished with status ${finalJob?.status}. Pages refreshed: ${finalPagesRefreshed}`,
        );
        return {
          pagesRefreshed: finalPagesRefreshed,
        };
      } catch (error) {
        logger.error(`❌ Refresh job ${jobId} failed or was cancelled: ${error}`);
        throw error; // Re-throw so the caller knows it failed
      }
    }

    // If not waiting, return the job ID immediately
    return { jobId };
  }
}
