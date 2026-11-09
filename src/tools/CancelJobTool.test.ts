import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { PipelineManager } from "../pipeline/PipelineManager";
import { type PipelineJob, PipelineJobStatus } from "../pipeline/types";
import { CancelJobTool } from "./CancelJobTool";
import { ToolError } from "./errors";

// Mock dependencies
vi.mock("../pipeline/PipelineManager");

describe("CancelJobTool", () => {
  let mockManagerInstance: Partial<PipelineManager>;
  let cancelJobTool: CancelJobTool;

  const MOCK_JOB_ID_QUEUED = "job-queued-1";
  const MOCK_JOB_ID_RUNNING = "job-running-2";
  const MOCK_JOB_ID_COMPLETED = "job-completed-3";
  const MOCK_JOB_ID_FAILED = "job-failed-4";
  const MOCK_JOB_ID_CANCELLED = "job-cancelled-5";
  const MOCK_JOB_ID_NOT_FOUND = "job-not-found-6";

  const createMockJob = (id: string, status: PipelineJobStatus): PipelineJob => ({
    id,
    library: "lib-a",
    version: "1.0.0",
    status,
    createdAt: new Date("2023-01-01T10:00:00Z"),
    progress: null,
    error: status === PipelineJobStatus.FAILED ? new Error("Job failed") : null,
    startedAt:
      status !== PipelineJobStatus.QUEUED ? new Date("2023-01-01T10:05:00Z") : null,
    finishedAt:
      status === PipelineJobStatus.COMPLETED ||
      status === PipelineJobStatus.FAILED ||
      status === PipelineJobStatus.CANCELLED
        ? new Date("2023-01-01T10:15:00Z")
        : null,
    sourceUrl: "url1",
    scraperOptions: null,
  });

  const mockJobsMap = new Map<string, PipelineJob>([
    [MOCK_JOB_ID_QUEUED, createMockJob(MOCK_JOB_ID_QUEUED, PipelineJobStatus.QUEUED)],
    [MOCK_JOB_ID_RUNNING, createMockJob(MOCK_JOB_ID_RUNNING, PipelineJobStatus.RUNNING)],
    [
      MOCK_JOB_ID_COMPLETED,
      createMockJob(MOCK_JOB_ID_COMPLETED, PipelineJobStatus.COMPLETED),
    ],
    [MOCK_JOB_ID_FAILED, createMockJob(MOCK_JOB_ID_FAILED, PipelineJobStatus.FAILED)],
    [
      MOCK_JOB_ID_CANCELLED,
      createMockJob(MOCK_JOB_ID_CANCELLED, PipelineJobStatus.CANCELLED),
    ],
  ]);

  beforeEach(() => {
    vi.resetAllMocks();

    // Define the mock implementation for the manager instance
    mockManagerInstance = {
      getJob: vi.fn().mockImplementation(async (jobId: string) => mockJobsMap.get(jobId)),
      cancelJob: vi.fn().mockResolvedValue(undefined), // Default success for cancelJob
    };

    // Instantiate the tool with the correctly typed mock instance
    cancelJobTool = new CancelJobTool(mockManagerInstance as PipelineManager);
  });

  it("should throw ToolError if job is not found", async () => {
    await expect(cancelJobTool.execute({ jobId: MOCK_JOB_ID_NOT_FOUND })).rejects.toThrow(
      new ToolError(
        `Failed to cancel job ${MOCK_JOB_ID_NOT_FOUND}: Job with ID ${MOCK_JOB_ID_NOT_FOUND} not found.`,
        "CancelJobTool",
      ),
    );
    expect(mockManagerInstance.cancelJob).not.toHaveBeenCalled();
  });

  it("leaves a job that has already ended alone and reports its status", async () => {
    const ended = [
      { id: MOCK_JOB_ID_COMPLETED, status: PipelineJobStatus.COMPLETED },
      { id: MOCK_JOB_ID_FAILED, status: PipelineJobStatus.FAILED },
      { id: MOCK_JOB_ID_CANCELLED, status: PipelineJobStatus.CANCELLED },
    ];

    for (const { id, status } of ended) {
      const result = await cancelJobTool.execute({ jobId: id });
      expect.soft(result, status).toEqual({
        message: `Job ${id} is already ${status}. No action taken.`,
        finalStatus: status,
      });
    }
    expect(mockManagerInstance.cancelJob).not.toHaveBeenCalled();
  });

  it("cancels a queued or running job and reports the status it moved to", async () => {
    const active = [
      { id: MOCK_JOB_ID_QUEUED, status: PipelineJobStatus.QUEUED },
      { id: MOCK_JOB_ID_RUNNING, status: PipelineJobStatus.RUNNING },
    ];

    for (const { id, status } of active) {
      (mockManagerInstance.getJob as Mock)
        .mockResolvedValueOnce(mockJobsMap.get(id)) // Found before cancelling
        .mockResolvedValueOnce({
          ...mockJobsMap.get(id),
          status: PipelineJobStatus.CANCELLING,
        });

      const result = await cancelJobTool.execute({ jobId: id });

      expect.soft(mockManagerInstance.cancelJob, status).toHaveBeenLastCalledWith(id);
      expect.soft(result, status).toEqual({
        message: `Cancellation requested for job ${id}. Current status: ${PipelineJobStatus.CANCELLING}.`,
        finalStatus: PipelineJobStatus.CANCELLING,
      });
    }
  });

  it("should throw ToolError if cancelJob throws an error", async () => {
    (mockManagerInstance.cancelJob as Mock).mockRejectedValue(
      new Error("Cancellation failed"),
    );

    await expect(cancelJobTool.execute({ jobId: MOCK_JOB_ID_RUNNING })).rejects.toThrow(
      new ToolError(
        `Failed to cancel job ${MOCK_JOB_ID_RUNNING}: Cancellation failed`,
        "CancelJobTool",
      ),
    );
  });
});
