import type { IPipeline } from "../pipeline/trpc/interfaces";
import { PipelineJobStatus } from "../pipeline/types";
import { logger } from "../utils/logger";
import { ToolError, ValidationError } from "./errors";

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
  /** The final status of the job after cancellation attempt. */
  finalStatus: string;
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
   * @throws {ValidationError} If the jobId is invalid.
   * @throws {ToolError} If the job is not found or cancellation fails.
   */
  async execute(input: CancelJobInput): Promise<CancelJobResult> {
    // Validate input
    if (!input.jobId || typeof input.jobId !== "string" || input.jobId.trim() === "") {
      throw new ValidationError(
        "Job ID is required and must be a non-empty string.",
        this.constructor.name,
      );
    }

    try {
      // Retrieve the job first to check its status before attempting cancellation
      const job = await this.pipeline.getJob(input.jobId);

      if (!job) {
        logger.warn(`❓ [CancelJobTool] Job not found: ${input.jobId}`);
        throw new ToolError(
          `Job with ID ${input.jobId} not found.`,
          this.constructor.name,
        );
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
          finalStatus: job.status,
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
        finalStatus,
      };
    } catch (error) {
      logger.error(`❌ Error cancelling job ${input.jobId}: ${error}`);
      throw new ToolError(
        `Failed to cancel job ${input.jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        this.constructor.name,
      );
    }
  }
}
