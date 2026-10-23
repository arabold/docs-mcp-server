import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { PipelineJob } from "../pipeline/types";
import { PipelineJobStatus } from "../pipeline/types";
import { RefreshVersionTool } from "./RefreshVersionTool";

describe("RefreshVersionTool", () => {
  let mockPipeline: IPipeline;
  let refreshTool: RefreshVersionTool;

  const MOCK_JOB_ID = "refresh-job-123";

  beforeEach(() => {
    vi.resetAllMocks();

    mockPipeline = {
      enqueueRefreshJob: vi.fn().mockResolvedValue(MOCK_JOB_ID),
      waitForJobCompletion: vi.fn().mockResolvedValue(undefined),
      getJob: vi.fn().mockResolvedValue({
        id: MOCK_JOB_ID,
        status: PipelineJobStatus.COMPLETED,
        progress: { pagesScraped: 5 },
      } as Partial<PipelineJob>),
    } as unknown as IPipeline;

    refreshTool = new RefreshVersionTool(mockPipeline);
  });

  // Version labels are normalized by normalizeVersionLabel (src/store/types.test.ts);
  // test/version-resolution-e2e.test.ts checks this tool applies it.
  it("should report the job id before waiting for the job", async () => {
    const onJobEnqueued = vi.fn(() => {
      expect(mockPipeline.waitForJobCompletion).not.toHaveBeenCalled();
    });

    await refreshTool.execute({ library: "test-lib", onJobEnqueued });

    expect(onJobEnqueued).toHaveBeenCalledWith(MOCK_JOB_ID);
    expect(mockPipeline.waitForJobCompletion).toHaveBeenCalledTimes(1);
  });

  it("should return the job id without waiting when waitForCompletion is false", async () => {
    const result = await refreshTool.execute({
      library: "test-lib",
      version: "stable",
      waitForCompletion: false,
    });

    expect(result).toEqual({ jobId: MOCK_JOB_ID });
    expect(mockPipeline.waitForJobCompletion).not.toHaveBeenCalled();
  });
});
