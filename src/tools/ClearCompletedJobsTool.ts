import type { IPipeline } from "../pipeline/trpc/interfaces";
import { logger } from "../utils/logger";

/**
 * Input parameters for the ClearCompletedJobsTool.
 */
// biome-ignore lint/suspicious/noEmptyInterface: No input parameters needed for this tool
export interface ClearCompletedJobsInput {
  // No input parameters needed for this tool
}

/**
 * Output result for the ClearCompletedJobsTool.
 */
export interface ClearCompletedJobsResult {
  /** A message indicating the outcome of the clear operation. */
  message: string;
  /** Indicates if the clear operation was successful. */
  success: boolean;
  /** The number of jobs that were cleared. */
  clearedCount: number;
}

/**
 * Tool for clearing all completed, cancelled, and failed jobs from the pipeline.
 * This helps keep the job queue clean by removing jobs that are no longer active.
 */
export class ClearCompletedJobsTool {
  private pipeline: IPipeline;

  /**
   * Creates an instance of ClearCompletedJobsTool.
   * @param pipeline The pipeline instance.
   */
  constructor(pipeline: IPipeline) {
    this.pipeline = pipeline;
  }

  /**
   * Executes the tool to clear all completed jobs from the pipeline.
   * @param input - The input parameters (currently unused).
   * @returns A promise that resolves with the outcome of the clear operation.
   */
  async execute(_input: ClearCompletedJobsInput): Promise<ClearCompletedJobsResult> {
    try {
      const clearedCount = await this.pipeline.clearCompletedJobs();

      const message =
        clearedCount > 0
          ? `Successfully cleared ${clearedCount} completed job${clearedCount === 1 ? "" : "s"} from the queue.`
          : "No completed jobs to clear.";

      logger.debug(message);

      return {
        message,
        success: true,
        clearedCount,
      };
    } catch (error) {
      const errorMessage = `Failed to clear completed jobs: ${
        error instanceof Error ? error.message : String(error)
      }`;

      logger.error(`❌ ${errorMessage}`);

      return {
        message: errorMessage,
        success: false,
        clearedCount: 0,
      };
    }
  }
}
