import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { PipelineJob, PipelineJobStatus } from "../pipeline/types";
import type { JobInfo } from "./GetJobInfoTool"; // Import JobInfo

/**
 * Input parameters for the ListJobsTool.
 */
export interface ListJobsInput {
  /** Optional status to filter jobs by. */
  status?: PipelineJobStatus;
}

/**
 * Response structure for the ListJobsTool.
 */
export interface ListJobsToolResponse {
  jobs: JobInfo[];
}

/**
 * Tool for listing pipeline jobs managed by the pipeline.
 * Allows filtering jobs by their status.
 */
export class ListJobsTool {
  private pipeline: IPipeline;

  /**
   * Creates an instance of ListJobsTool.
   * @param pipeline The pipeline instance.
   */
  constructor(pipeline: IPipeline) {
    this.pipeline = pipeline;
  }

  /**
   * Executes the tool to retrieve a list of pipeline jobs using single source of truth.
   * @param input - The input parameters, optionally including a status filter.
   * @returns A promise that resolves with the list of simplified job objects.
   */
  async execute(input: ListJobsInput): Promise<ListJobsToolResponse> {
    const jobs = await this.pipeline.getJobs(input.status);

    // Transform jobs into simplified objects using enhanced PipelineJob interface
    const simplifiedJobs: JobInfo[] = jobs.map((job: PipelineJob): JobInfo => {
      return {
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
    });

    return { jobs: simplifiedJobs };
  }
}
