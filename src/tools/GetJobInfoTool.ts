import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { PipelineJobStatus } from "../pipeline/types";
import type { VersionStatus } from "../store/types";

/**
 * Input parameters for the GetJobInfoTool.
 */
export interface GetJobInfoInput {
  /** The ID of the job to retrieve info for. */
  jobId: string;
}

/**
 * Simplified information about a pipeline job for external use.
 */
export interface JobInfo {
  id: string;
  library: string;
  version: string | null;
  status: PipelineJobStatus; // Pipeline status (for compatibility)
  dbStatus?: VersionStatus; // Database status (enhanced)
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  // Progress information from database
  progress?: {
    pages: number;
    totalPages: number;
    totalDiscovered: number;
  };
  // Additional database fields
  updatedAt?: string;
  errorMessage?: string; // Database error message
}

/**
 * Response structure for the GetJobInfoTool.
 */
export interface GetJobInfoToolResponse {
  job: JobInfo | null;
}

/**
 * Tool for retrieving simplified information about a specific pipeline job.
 */
export class GetJobInfoTool {
  private pipeline: IPipeline;

  /**
   * Creates an instance of GetJobInfoTool.
   * @param pipeline The pipeline instance.
   */
  constructor(pipeline: IPipeline) {
    this.pipeline = pipeline;
  }

  /**
   * Executes the tool to retrieve simplified info for a specific job using enhanced PipelineJob interface.
   * @param input - The input parameters, containing the jobId.
   * @returns A promise that resolves with the simplified job info or null if not found.
   */
  async execute(input: GetJobInfoInput): Promise<GetJobInfoToolResponse> {
    const job = await this.pipeline.getJob(input.jobId);

    if (!job) {
      // Return null in the result if job not found
      return { job: null };
    }

    // Transform the job into a simplified object using enhanced PipelineJob interface
    const jobInfo: JobInfo = {
      id: job.id,
      library: job.library,
      version: job.version,
      status: job.status,
      dbStatus: job.versionStatus,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      error: job.error?.message ?? null,
      progress:
        job.progressMaxPages && job.progressMaxPages > 0
          ? {
              pages: job.progressPages || 0,
              totalPages: job.progressMaxPages,
              totalDiscovered: job.progress?.totalDiscovered || job.progressMaxPages,
            }
          : undefined,
      updatedAt: job.updatedAt?.toISOString(),
      errorMessage: job.errorMessage ?? undefined,
    };

    return { job: jobInfo };
  }
}
