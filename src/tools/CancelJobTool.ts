import type { IPipeline } from "../pipeline/trpc/interfaces";
import { PipelineJobStatus } from "../pipeline/types";
import { logger } from "../utils/logger";

/**
 * Input parameters for the CancelJobTool.
 */
export interface CancelJobInput {
  /** The ID of the job to cancel. */
  jobId: string;
}

/**
 * Output result for the CancelJobTool.
 */
export interface CancelJobResult {
  /** A message indicating the outcome of the cancellation attempt. */
  message: string;
  /** Indicates if the cancellation request was successfully initiated or if the job was already finished/cancelled. */
  success: boolean;
}

/**
 * Tool for attempting to cancel a pipeline job.
 */
export class CancelJobTool {
  private pipeline: IPipeline;

  /**
   * Creates an instance of CancelJobTool.
   * @param pipeline The pipeline instance.
   */
  constructor(pipeline: IPipeline) {
    this.pipeline = pipeline;
  }

  /**
   * Executes the tool to attempt cancellation of a specific job.
   * @param input - The input parameters, containing the jobId.
   * @returns A promise that resolves with the outcome message.
   */
  async execute(input: CancelJobInput): Promise<CancelJobResult> {
    try {
      // Retrieve the job first to check its status before attempting cancellation
      const job = await this.pipeline.getJob(input.jobId);

      if (!job) {
        logger.warn(`❓ [CancelJobTool] Job not found: ${input.jobId}`);
        return {
          message: `Job with ID ${input.jobId} not found.`,
          success: false,
        };
      }

      // Check if the job is already in a final state
      if (
        job.status === PipelineJobStatus.COMPLETED || // Use enum member
        job.status === PipelineJobStatus.FAILED || // Use enum member
        job.status === PipelineJobStatus.CANCELLED // Use enum member
      ) {
        logger.debug(`Job ${input.jobId} is already in a final state: ${job.status}.`);
        return {
          message: `Job ${input.jobId} is already ${job.status}. No action taken.`,
          success: true, // Considered success as no cancellation needed
        };
      }

      // Attempt cancellation
      await this.pipeline.cancelJob(input.jobId);

      // Re-fetch the job to confirm status change (or check status directly if cancelJob returned it)
      // PipelineManager.cancelJob doesn't return status, so re-fetch is needed for confirmation.
      const updatedJob = await this.pipeline.getJob(input.jobId);
      const finalStatus = updatedJob?.status ?? "UNKNOWN (job disappeared?)";

      logger.debug(
        `Cancellation requested for job ${input.jobId}. Current status: ${finalStatus}`,
      );
      return {
        message: `Cancellation requested for job ${input.jobId}. Current status: ${finalStatus}.`,
        success: true,
      };
    } catch (error) {
      logger.error(`❌ Error cancelling job ${input.jobId}: ${error}`);
      return {
        message: `Failed to cancel job ${input.jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        success: false,
      };
    }
  }
}
