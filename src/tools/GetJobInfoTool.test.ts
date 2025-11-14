import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineManager } from "../pipeline/PipelineManager";
import { type PipelineJob, PipelineJobStatus } from "../pipeline/types";
import { ToolError } from "./errors";
import { GetJobInfoTool } from "./GetJobInfoTool"; // Updated import

// Mock dependencies
vi.mock("../pipeline/PipelineManager");

describe("GetJobInfoTool", () => {
  // Updated describe block
  let mockManagerInstance: Partial<PipelineManager>;
  let getJobInfoTool: GetJobInfoTool; // Updated variable name

  const MOCK_JOB_ID_FOUND = "job-found-123";
  const MOCK_JOB_ID_NOT_FOUND = "job-not-found-456";

  const mockJob: PipelineJob = {
    id: MOCK_JOB_ID_FOUND,
    library: "lib-a",
    version: "1.0.0",
    status: PipelineJobStatus.RUNNING,
    createdAt: new Date("2023-01-01T10:00:00Z"),
    startedAt: new Date("2023-01-01T10:05:00Z"),
    progress: null,
    error: null,
    finishedAt: null,
    sourceUrl: "url1",
    scraperOptions: null,
  };

  beforeEach(() => {
    vi.resetAllMocks();

    // Define the mock implementation for the manager instance
    mockManagerInstance = {
      // Mock getJob to return the job if ID matches, otherwise undefined
      getJob: vi.fn().mockImplementation(async (jobId: string) => {
        if (jobId === MOCK_JOB_ID_FOUND) {
          return mockJob;
        }
        return undefined; // Simulate job not found
      }),
    };

    // Instantiate the tool with the correctly typed mock instance
    getJobInfoTool = new GetJobInfoTool(mockManagerInstance as PipelineManager); // Updated instantiation
  });

  it("should call manager.getJob with the provided jobId", async () => {
    await getJobInfoTool.execute({ jobId: MOCK_JOB_ID_FOUND }); // Updated tool call
    expect(mockManagerInstance.getJob).toHaveBeenCalledWith(MOCK_JOB_ID_FOUND);
  });

  it("should return the job details if the job is found", async () => {
    const result = await getJobInfoTool.execute({ jobId: MOCK_JOB_ID_FOUND }); // Updated tool call

    expect(result.job).not.toBeNull();
    // Check properties of the simplified JobInfo object
    expect(result.job?.id).toBe(mockJob.id);
    expect(result.job?.library).toBe(mockJob.library);
    expect(result.job?.version).toBe(mockJob.version);
    expect(result.job?.status).toBe(mockJob.status);
    expect(result.job?.createdAt).toBe(mockJob.createdAt.toISOString());
    expect(result.job?.startedAt).toBe(mockJob.startedAt?.toISOString());
    expect(result.job?.finishedAt).toBeNull(); // Based on mockJob
    expect(result.job?.error).toBeNull(); // Based on mockJob
  });

  it("should throw ToolError if the job is not found", async () => {
    await expect(
      getJobInfoTool.execute({ jobId: MOCK_JOB_ID_NOT_FOUND }),
    ).rejects.toThrow(ToolError);
    await expect(
      getJobInfoTool.execute({ jobId: MOCK_JOB_ID_NOT_FOUND }),
    ).rejects.toThrow("not found");
    expect(mockManagerInstance.getJob).toHaveBeenCalledWith(MOCK_JOB_ID_NOT_FOUND);
  });
});
