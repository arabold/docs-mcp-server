import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { PipelineManager } from "../pipeline/PipelineManager";
import { type PipelineJob, PipelineJobStatus } from "../pipeline/types";
import { CancelJobTool } from "./CancelJobTool";

// Mock dependencies
vi.mock("../pipeline/PipelineManager");
vi.mock("../utils/logger");

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

  it("should call manager.getJob with the provided jobId", async () => {
    await cancelJobTool.execute({ jobId: MOCK_JOB_ID_QUEUED });
    expect(mockManagerInstance.getJob).toHaveBeenCalledWith(MOCK_JOB_ID_QUEUED);
  });

  it("should return success: false if job is not found", async () => {
    const result = await cancelJobTool.execute({ jobId: MOCK_JOB_ID_NOT_FOUND });
    expect(mockManagerInstance.getJob).toHaveBeenCalledWith(MOCK_JOB_ID_NOT_FOUND);
    expect(mockManagerInstance.cancelJob).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it.each([
    { id: MOCK_JOB_ID_COMPLETED, status: PipelineJobStatus.COMPLETED },
    { id: MOCK_JOB_ID_FAILED, status: PipelineJobStatus.FAILED },
    { id: MOCK_JOB_ID_CANCELLED, status: PipelineJobStatus.CANCELLED },
  ])(
    "should return success: true and not call cancelJob if job is already $status",
    async ({ id, status }) => {
      const result = await cancelJobTool.execute({ jobId: id });
      expect(mockManagerInstance.getJob).toHaveBeenCalledWith(id);
      expect(mockManagerInstance.cancelJob).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.message).toContain(`already ${status}`);
    },
  );

  it.each([
    { id: MOCK_JOB_ID_QUEUED, status: PipelineJobStatus.QUEUED },
    { id: MOCK_JOB_ID_RUNNING, status: PipelineJobStatus.RUNNING },
  ])(
    "should call cancelJob and return success: true if job is $status",
    async ({ id }) => {
      // Mock getJob to return the job again after cancellation attempt for status check
      (mockManagerInstance.getJob as Mock)
        .mockResolvedValueOnce(mockJobsMap.get(id)) // First call finds the job
        .mockResolvedValueOnce({
          ...mockJobsMap.get(id),
          status: PipelineJobStatus.CANCELLING,
        }); // Second call shows cancelling status

      const result = await cancelJobTool.execute({ jobId: id });

      expect(mockManagerInstance.getJob).toHaveBeenCalledWith(id);
      expect(mockManagerInstance.cancelJob).toHaveBeenCalledWith(id);
      expect(result.success).toBe(true);
      expect(result.message).toContain("Cancellation requested");
      expect(result.message).toContain(PipelineJobStatus.CANCELLING); // Check updated status in message
    },
  );

  it("should return success: false if cancelJob throws an error", async () => {
    const cancelError = new Error("Cancellation failed");
    (mockManagerInstance.cancelJob as Mock).mockRejectedValue(cancelError);

    const result = await cancelJobTool.execute({ jobId: MOCK_JOB_ID_RUNNING });

    expect(mockManagerInstance.getJob).toHaveBeenCalledWith(MOCK_JOB_ID_RUNNING);
    expect(mockManagerInstance.cancelJob).toHaveBeenCalledWith(MOCK_JOB_ID_RUNNING);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Failed to cancel job");
    expect(result.message).toContain(cancelError.message);
  });
});
