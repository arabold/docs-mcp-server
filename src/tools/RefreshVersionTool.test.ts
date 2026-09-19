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

  it.each([
    { input: "1.2.3", expected: "1.2.3" },
    { input: "1.20", expected: "1.20" }, // Verbatim - not coerced to 1.20.0
    { input: "1", expected: "1" }, // Verbatim - not coerced to 1.0.0
    { input: " 1.2.3 ", expected: "1.2.3" }, // Trimmed
    { input: "V2.0.0", expected: "v2.0.0" }, // Lowercased
    { input: null, expected: null }, // Unversioned
    { input: undefined, expected: null }, // Unversioned
    { input: "", expected: null }, // Unversioned
    { input: "   ", expected: null }, // Unversioned
  ])(
    "should normalize version input '$input' to '$expected'",
    async ({ input, expected }) => {
      await refreshTool.execute({ library: "test-lib", version: input });

      expect(mockPipeline.enqueueRefreshJob).toHaveBeenCalledWith("test-lib", expected, {
        preserveHashes: undefined,
      });
    },
  );

  it.each(["latest", "stable", "1.x", "main", "release-2024"])(
    "should refresh the non-semver label '%s' rather than rejecting it",
    async (label) => {
      // These labels used to raise "Invalid version format for refreshing".
      // A version label is not required to be a semantic version.
      await expect(
        refreshTool.execute({ library: "test-lib", version: label }),
      ).resolves.toEqual({ pagesRefreshed: 5 });

      expect(mockPipeline.enqueueRefreshJob).toHaveBeenCalledWith("test-lib", label, {
        preserveHashes: undefined,
      });
    },
  );

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
